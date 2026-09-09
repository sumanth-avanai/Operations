/**
 * Boots a throwaway PGlite database, applies the real migrations, runs the real seed,
 * and asserts the demo workspace obeys the product's own integrity rules.
 *
 * This is the test that proves the schema, the migrations, the capacity gate and the
 * billing identity all agree with each other.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import * as schema from '@/lib/db/schema'
import { ensureSeed } from '@/lib/db/seed'
import { dayAvailability, type LeaveSpan } from '@/lib/domain/capacity'
import { amountCents } from '@/lib/domain/money'
import { splitBalances, billingSplit } from '@/lib/domain/billing'

let client: PGlite
let db: PgliteDatabase<typeof schema>
let dataDir: string

beforeAll(async () => {
  dataDir = path.join(os.tmpdir(), `aops-test-${Date.now()}`)
  fs.mkdirSync(dataDir, { recursive: true })
  client = await PGlite.create({ dataDir })
  db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'drizzle') })
  await ensureSeed(db)
}, 120_000)

afterAll(async () => {
  await client?.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('migrations', () => {
  it('creates every table the schema declares', async () => {
    const res = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    )
    const names = (res.rows as unknown as { table_name: string }[]).map((r) => r.table_name)
    for (const expected of [
      'bookings', 'clients', 'holiday_calendars', 'holidays', 'invoices', 'leave', 'members',
      'notifications', 'project_health_updates', 'project_roles', 'projects', 'role_assignments',
      'saved_views', 'time_entries', 'workspace_settings',
    ]) {
      expect(names, expected).toContain(expected)
    }
  })

  it('enforces the single-row workspace settings constraint', async () => {
    await expect(
      db.insert(schema.workspaceSettings).values({
        id: 'second',
        agencyName: 'Nope',
        passwordHash: 'x',
        passwordSalt: 'y',
      }),
    ).rejects.toThrow()
  })

  it('rejects a zero-minute time entry', async () => {
    const [member] = await db.select().from(schema.members).limit(1)
    const [role] = await db.select().from(schema.projectRoles).limit(1)
    await expect(
      db.insert(schema.timeEntries).values({
        memberId: member!.id,
        projectRoleId: role!.id,
        entryDate: '2020-01-02',
        minutes: 0,
      }),
    ).rejects.toThrow()
  })

  it('refuses an invoiced amount without an invoice', async () => {
    const [member] = await db.select().from(schema.members).limit(1)
    const [role] = await db.select().from(schema.projectRoles).limit(1)
    await expect(
      db.insert(schema.timeEntries).values({
        memberId: member!.id,
        projectRoleId: role!.id,
        entryDate: '2020-01-03',
        minutes: 60,
        invoicedAmountCents: 1000,
      }),
    ).rejects.toThrow()
  })
})

describe('seed is idempotent', () => {
  it('does nothing on a second run', async () => {
    const before = await db.execute<{ n: number }>(sql`select count(*)::int as n from time_entries`)
    await ensureSeed(db)
    const after = await db.execute<{ n: number }>(sql`select count(*)::int as n from time_entries`)
    expect((after.rows as unknown as { n: number }[])[0]!.n).toBe(
      (before.rows as unknown as { n: number }[])[0]!.n,
    )
  })
})

describe('the demo agency has enough substance to exercise every panel', () => {
  it('seeds the expected shape', async () => {
    const count = async (table: string) => {
      const res = await db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table}`))
      return (res.rows as unknown as { n: number }[])[0]!.n
    }
    expect(await count('members')).toBe(11)
    expect(await count('clients')).toBe(4)
    expect(await count('projects')).toBe(8)
    expect(await count('project_roles')).toBeGreaterThanOrEqual(20)
    expect(await count('holiday_calendars')).toBe(2)
    expect(await count('holidays')).toBeGreaterThan(40)
    expect(await count('leave')).toBe(6)
    expect(await count('bookings')).toBe(12)
    expect(await count('invoices')).toBe(2)
    expect(await count('project_health_updates')).toBeGreaterThan(10)
    // Three months of history for eleven people is a real dataset, not a stub.
    expect(await count('time_entries')).toBeGreaterThan(500)
  })

  it('covers all four leave types', async () => {
    const rows = await db.selectDistinct({ t: schema.leaveRecords.leaveType }).from(schema.leaveRecords)
    expect(rows.map((r) => r.t).sort()).toEqual(['other', 'sick', 'unpaid', 'vacation'])
  })

  it('has both tentative and confirmed bookings', async () => {
    const rows = await db.selectDistinct({ s: schema.bookings.status }).from(schema.bookings)
    expect(rows.map((r) => r.s).sort()).toEqual(['confirmed', 'tentative'])
  })

  it('has billable and non-billable projects', async () => {
    const rows = await db.selectDistinct({ b: schema.projects.billable }).from(schema.projects)
    expect(rows).toHaveLength(2)
  })

  it('has a contract that ends and one that started recently', async () => {
    const ending = await db.select().from(schema.members).where(isNotNull(schema.members.contractEnd))
    expect(ending.length).toBeGreaterThanOrEqual(1)
    const all = await db.select().from(schema.members)
    const starts = all.map((m) => m.contractStart).sort()
    expect(starts[starts.length - 1]).not.toBe(starts[0])
  })

  it('has part-time working patterns, not just full weeks', async () => {
    const all = await db.select({ w: schema.members.workingMinutes }).from(schema.members)
    const weekly = all.map((m) => Object.values(m.w).reduce((a, b) => a + b, 0))
    expect(Math.min(...weekly)).toBeLessThan(2400)
    expect(Math.max(...weekly)).toBe(2400)
  })

  it('has both portal and internal time entries', async () => {
    const rows = await db.selectDistinct({ s: schema.timeEntries.source }).from(schema.timeEntries)
    expect(rows.map((r) => r.s).sort()).toEqual(['internal', 'portal'])
  })

  it('gives every member a unique, unguessable portal token', async () => {
    const rows = await db.select({ t: schema.members.portalToken }).from(schema.members)
    expect(new Set(rows.map((r) => r.t)).size).toBe(rows.length)
    for (const row of rows) expect(row.t.length).toBeGreaterThanOrEqual(30)
  })
})

describe('seeded history obeys the capacity gate', () => {
  it('never logs time on a holiday, leave day, non-working day, or outside a contract', async () => {
    const memberRows = await db.select().from(schema.members)
    const leaveRows = await db.select().from(schema.leaveRecords)
    const holidayRows = await db.select().from(schema.holidays)
    const entryRows = await db
      .select({
        memberId: schema.timeEntries.memberId,
        entryDate: schema.timeEntries.entryDate,
        minutes: schema.timeEntries.minutes,
      })
      .from(schema.timeEntries)

    const holidaysByCalendar = new Map<string, Map<string, string>>()
    for (const h of holidayRows) {
      const map = holidaysByCalendar.get(h.calendarId) ?? new Map<string, string>()
      map.set(h.holidayDate, h.name)
      holidaysByCalendar.set(h.calendarId, map)
    }
    const leaveByMember = new Map<string, LeaveSpan[]>()
    for (const l of leaveRows) {
      const list = leaveByMember.get(l.memberId) ?? []
      list.push({
        leaveType: l.leaveType,
        startDate: l.startDate,
        endDate: l.endDate,
        portion: l.portion,
      })
      leaveByMember.set(l.memberId, list)
    }
    const memberById = new Map(memberRows.map((m) => [m.id, m]))

    const violations: string[] = []
    for (const entry of entryRows) {
      const member = memberById.get(entry.memberId)!
      const holidays = member.holidayCalendarId
        ? (holidaysByCalendar.get(member.holidayCalendarId) ?? new Map())
        : new Map()
      const availability = dayAvailability(
        {
          workingMinutes: member.workingMinutes,
          contractStart: member.contractStart,
          contractEnd: member.contractEnd,
        },
        entry.entryDate,
        holidays,
        leaveByMember.get(member.id) ?? [],
      )
      if (availability.minutes <= 0) {
        violations.push(`${member.name} ${entry.entryDate} (${availability.reason})`)
      }
    }
    expect(violations.slice(0, 10)).toEqual([])
  })

  it('keeps one row per member, role and day', async () => {
    const res = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from (
            select member_id, project_role_id, entry_date
            from time_entries group by 1,2,3 having count(*) > 1
          ) dupes`,
    )
    expect((res.rows as unknown as { n: number }[])[0]!.n).toBe(0)
  })
})

describe('the billing identity holds on seeded data', () => {
  it('logged equals invoiced plus unbilled across all billable work', async () => {
    const rows = await db
      .select({
        minutes: schema.timeEntries.minutes,
        invoiceId: schema.timeEntries.invoiceId,
        invoicedAmountCents: schema.timeEntries.invoicedAmountCents,
        rateCents: schema.projectRoles.rateCents,
      })
      .from(schema.timeEntries)
      .innerJoin(schema.projectRoles, eq(schema.projectRoles.id, schema.timeEntries.projectRoleId))
      .innerJoin(schema.projects, eq(schema.projects.id, schema.projectRoles.projectId))
      .where(eq(schema.projects.billable, true))

    let invoicedCents = 0
    let invoicedMinutes = 0
    let unbilledCents = 0
    let unbilledMinutes = 0
    for (const row of rows) {
      if (row.invoiceId) {
        invoicedCents += row.invoicedAmountCents ?? 0
        invoicedMinutes += row.minutes
      } else {
        unbilledCents += amountCents(row.minutes, row.rateCents)
        unbilledMinutes += row.minutes
      }
    }
    const split = {
      invoicedCents, invoicedMinutes, unbilledCents, unbilledMinutes,
      loggedCents: invoicedCents + unbilledCents,
      loggedMinutes: invoicedMinutes + unbilledMinutes,
    }
    expect(splitBalances(split)).toBe(true)
    expect(split.invoicedCents).toBeGreaterThan(0)
    expect(split.unbilledCents).toBeGreaterThan(0)
  })

  it("matches each invoice's stored total to the entries it billed", async () => {
    const invoiceRows = await db.select().from(schema.invoices)
    expect(invoiceRows.length).toBe(2)
    for (const invoice of invoiceRows) {
      const res = await db.execute<{ total: number; n: number }>(
        sql`select coalesce(sum(invoiced_amount_cents),0)::int as total, count(*)::int as n
            from time_entries where invoice_id = ${invoice.id}`,
      )
      const row = (res.rows as unknown as { total: number; n: number }[])[0]!
      expect(row.n).toBeGreaterThan(0)
      expect(row.total).toBe(invoice.amountCents)
    }
  })

  it('freezes invoiced amounts so a rate change cannot move them', async () => {
    const [entry] = await db
      .select({
        id: schema.timeEntries.id,
        minutes: schema.timeEntries.minutes,
        frozen: schema.timeEntries.invoicedAmountCents,
        roleId: schema.projectRoles.id,
        rateCents: schema.projectRoles.rateCents,
      })
      .from(schema.timeEntries)
      .innerJoin(schema.projectRoles, eq(schema.projectRoles.id, schema.timeEntries.projectRoleId))
      .where(isNotNull(schema.timeEntries.invoiceId))
      .limit(1)

    expect(entry!.frozen).toBe(amountCents(entry!.minutes, entry!.rateCents))

    await db
      .update(schema.projectRoles)
      .set({ rateCents: entry!.rateCents * 2 })
      .where(eq(schema.projectRoles.id, entry!.roleId))

    const [after] = await db
      .select({ frozen: schema.timeEntries.invoicedAmountCents })
      .from(schema.timeEntries)
      .where(eq(schema.timeEntries.id, entry!.id))
    expect(after!.frozen).toBe(entry!.frozen)

    // and the unbilled side of the same role DOES re-price
    const unbilled = await db
      .select({ minutes: schema.timeEntries.minutes })
      .from(schema.timeEntries)
      .where(and(eq(schema.timeEntries.projectRoleId, entry!.roleId), isNull(schema.timeEntries.invoiceId)))
    const before = billingSplit({
      invoicedCents: 0, invoicedMinutes: 0,
      unbilledMinutes: unbilled.reduce((a, r) => a + r.minutes, 0),
      rateCents: entry!.rateCents,
    })
    const doubled = billingSplit({
      invoicedCents: 0, invoicedMinutes: 0,
      unbilledMinutes: unbilled.reduce((a, r) => a + r.minutes, 0),
      rateCents: entry!.rateCents * 2,
    })
    if (before.unbilledMinutes > 0) expect(doubled.unbilledCents).toBeGreaterThan(before.unbilledCents)

    await db
      .update(schema.projectRoles)
      .set({ rateCents: entry!.rateCents })
      .where(eq(schema.projectRoles.id, entry!.roleId))
  })

  it('excludes non-billable projects from billable figures', async () => {
    const res = await db.execute<{ n: number }>(
      sql`select count(*)::int as n
          from time_entries te
          join project_roles pr on pr.id = te.project_role_id
          join projects p on p.id = pr.project_id
          where p.billable = false and te.invoice_id is not null`,
    )
    expect((res.rows as unknown as { n: number }[])[0]!.n).toBe(0)
  })
})
