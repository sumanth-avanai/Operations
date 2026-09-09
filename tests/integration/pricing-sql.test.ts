/**
 * Proves the SQL price and the TypeScript price are the same function.
 *
 * Money is aggregated in Postgres and derived per row in TypeScript. Two
 * implementations of one formula is a correctness risk, so this file runs both over the
 * whole legal input space against a real database and asserts they never differ — and
 * pins down the two hazards that made the SQL version wrong before: int4 overflow on the
 * multiply, and int4 overflow on the sum.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { eq, sql } from 'drizzle-orm'
import * as schema from '@/lib/db/schema'
import { MAX_RATE_CENTS } from '@/lib/db/schema'
import { priceCents, toNumber } from '@/lib/db/sql-money'
import { amountCents } from '@/lib/domain/money'

let client: PGlite
let db: PgliteDatabase<typeof schema>
let dataDir: string

beforeAll(async () => {
  dataDir = path.join(os.tmpdir(), `aops-pricing-${Date.now()}`)
  fs.mkdirSync(dataDir, { recursive: true })
  client = await PGlite.create({ dataDir })
  db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'drizzle') })
}, 120_000)

afterAll(async () => {
  await client?.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

const RATES = [
  0, 1, 2, 7, 29, 30, 31, 59, 60, 61, 100, 333, 999, 1000, 3333, 9999,
  12_000, 12_500, 13_500, 16_500, 99_999, 123_456, 1_000_000, 12_345_678, MAX_RATE_CENTS,
]

describe('the SQL price equals the TypeScript price', () => {
  it('agrees for every minute of a day at every representative rate', async () => {
    // The CTEs are named `te` and `pr` so the expression under test is byte-for-byte the
    // one the application runs.
    const res = await db.execute<{ minutes: number; rate_cents: string | number; cents: string | number }>(sql`
      with te(minutes) as (select generate_series(0, 1440)),
           pr(rate_cents) as (select unnest(${sql.raw(`array[${RATES.join(',')}]::bigint[]`)}))
      select te.minutes, pr.rate_cents, ${priceCents()} as cents
      from te cross join pr
    `)
    const rows = res.rows as unknown as { minutes: number; rate_cents: string | number; cents: string | number }[]
    expect(rows.length).toBe(1441 * RATES.length)

    const mismatches: string[] = []
    for (const row of rows) {
      const minutes = toNumber(row.minutes)
      const rate = toNumber(row.rate_cents)
      const fromSql = toNumber(row.cents)
      const fromTs = amountCents(minutes, rate)
      if (fromSql !== fromTs) mismatches.push(`${minutes}m @ ${rate}: sql ${fromSql} ≠ ts ${fromTs}`)
    }
    expect(mismatches.slice(0, 10)).toEqual([])
  })

  it('agrees on the exact-half cases, which is where two roundings usually diverge', async () => {
    // Postgres round() on numeric goes half away from zero; Math.round goes half up.
    // For non-negative values those are the same rule, and both inputs are constrained
    // non-negative — this asserts it rather than assuming it.
    const res = await db.execute<{ minutes: number; rate_cents: string | number; cents: string | number }>(sql`
      with te(minutes) as (select generate_series(1, 1440)),
           pr(rate_cents) as (select unnest(array[1,7,29,31,59,61,333,999,3333]::bigint[]))
      select te.minutes, pr.rate_cents, ${priceCents()} as cents
      from te cross join pr
      where (te.minutes * pr.rate_cents) % 60 = 30
    `)
    const rows = res.rows as unknown as { minutes: number; rate_cents: string | number; cents: string | number }[]
    expect(rows.length).toBeGreaterThan(100)
    for (const row of rows) {
      const minutes = toNumber(row.minutes)
      const rate = toNumber(row.rate_cents)
      expect(toNumber(row.cents)).toBe(amountCents(minutes, rate))
      // and both rounded up, not down
      expect(toNumber(row.cents)).toBe(Math.floor((minutes * rate) / 60) + 1)
    }
  })

  it('sums per row exactly like the TypeScript side does', async () => {
    const res = await db.execute<{ total: string | number }>(sql`
      with te(minutes) as (select unnest(array[7,7,7,7,7,7,7,7,7,7])),
           pr(rate_cents) as (select 3333::bigint)
      select coalesce(sum(${priceCents()}), 0)::bigint as total
      from te cross join pr
    `)
    const fromSql = toNumber((res.rows as unknown as { total: string | number }[])[0]!.total)
    const fromTs = Array.from({ length: 10 }, () => amountCents(7, 3333)).reduce((a, b) => a + b, 0)
    expect(fromSql).toBe(fromTs)
    expect(fromSql).toBe(3890)
  })
})

describe('the numeric hazards that made this wrong before', () => {
  it('would overflow int4 without the numeric cast — the cast is load-bearing', async () => {
    // This is the expression the code used to run. At a high rate it raises rather than
    // returning a wrong number, but it takes the request down either way.
    await expect(
      db.execute(sql`select round(1440 * 100000000 / 60.0) as cents`),
    ).rejects.toThrow()

    // The expression the code runs now handles it exactly.
    const res = await db.execute<{ cents: string | number }>(sql`
      with te(minutes) as (select 1440), pr(rate_cents) as (select 100000000::bigint)
      select ${priceCents()} as cents from te cross join pr
    `)
    const cents = toNumber((res.rows as unknown as { cents: string | number }[])[0]!.cents)
    expect(cents).toBe(amountCents(1440, 100_000_000))
    expect(cents).toBe(2_400_000_000)
  })

  it('would overflow int4 on the sum — bigint aggregates are load-bearing too', async () => {
    // 2,147,483,647 cents is 21.47M in the workspace currency: a real yearly total.
    await expect(
      db.execute(sql`select sum(x)::int as total from (select 2000000000::bigint as x union all select 2000000000) s`),
    ).rejects.toThrow()

    const res = await db.execute<{ total: string | number }>(sql`
      select coalesce(sum(x), 0)::bigint as total
      from (select 2000000000::bigint as x union all select 2000000000) s
    `)
    expect(toNumber((res.rows as unknown as { total: string | number }[])[0]!.total)).toBe(4_000_000_000)
  })

  it('stores and reads a rate far above the old int4 ceiling', async () => {
    const [calendar] = await db
      .insert(schema.holidayCalendars)
      .values({ name: 'Pricing test' })
      .returning({ id: schema.holidayCalendars.id })
    const [client_] = await db
      .insert(schema.clients)
      .values({ name: 'Pricing Test Client' })
      .returning({ id: schema.clients.id })
    const [project] = await db
      .insert(schema.projects)
      .values({ clientId: client_!.id, name: 'Pricing Test Project', billable: true })
      .returning({ id: schema.projects.id })

    // 500,000.00 per hour, and a budget of 5,000,000,000.00 — both impossible under int4.
    const [role] = await db
      .insert(schema.projectRoles)
      .values({
        projectId: project!.id,
        name: 'Very Expensive',
        rateCents: 50_000_000,
        budgetCents: 500_000_000_000,
      })
      .returning({ id: schema.projectRoles.id })

    const stored = await db
      .select({ rateCents: schema.projectRoles.rateCents, budgetCents: schema.projectRoles.budgetCents })
      .from(schema.projectRoles)
      .where(eq(schema.projectRoles.id, role!.id))

    // bigint columns must arrive as exact JS numbers, not strings.
    expect(typeof stored[0]!.rateCents).toBe('number')
    expect(stored[0]!.rateCents).toBe(50_000_000)
    expect(stored[0]!.budgetCents).toBe(500_000_000_000)
    expect(Number.isSafeInteger(stored[0]!.budgetCents)).toBe(true)

    void calendar
  })

  it('refuses a rate outside the bounded range', async () => {
    const [client_] = await db
      .insert(schema.clients)
      .values({ name: 'Range Test Client' })
      .returning({ id: schema.clients.id })
    const [project] = await db
      .insert(schema.projects)
      .values({ clientId: client_!.id, name: 'Range Test Project' })
      .returning({ id: schema.projects.id })

    await expect(
      db.insert(schema.projectRoles).values({
        projectId: project!.id,
        name: 'Absurd',
        rateCents: MAX_RATE_CENTS + 1,
      }),
    ).rejects.toThrow()

    await expect(
      db.insert(schema.projectRoles).values({
        projectId: project!.id,
        name: 'Negative',
        rateCents: -1,
      }),
    ).rejects.toThrow()
  })

  it('keeps every reachable total exact in JavaScript', async () => {
    // The worst case the schema permits, a million times over.
    const worst = amountCents(1440, MAX_RATE_CENTS)
    const res = await db.execute<{ total: string | number }>(sql`
      select (${worst}::bigint * 1000000)::bigint as total
    `)
    const total = toNumber((res.rows as unknown as { total: string | number }[])[0]!.total)
    expect(Number.isSafeInteger(total)).toBe(true)
    expect(total).toBe(worst * 1_000_000)
  })
})
