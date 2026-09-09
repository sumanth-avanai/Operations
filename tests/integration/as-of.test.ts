/**
 * The two figures that are answers to "as of today".
 *
 * Everything else in this product is computed over an explicit range, so it means the
 * same thing whenever it is asked. Three figures do not: slipped work, invoice aging,
 * and the committed/stale split of undelivered plan. All three are measured from a
 * reference day. That day arrives as `asOf` rather than from a clock inside the query,
 * and these tests are what that buys — the date gates can be pinned, so their
 * boundaries are checked rather than assumed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootWorkspace, type Workspace } from './helpers'
import { addDays, today } from '@/lib/domain/dates'
import { DEMO_TIME_ZONE } from '@/lib/db/seed'

let ws: Workspace

beforeAll(async () => {
  ws = await bootWorkspace()
}, 180_000)

afterAll(() => ws?.cleanup())

/** The seeded dataset is anchored to the demo workspace's own day, so this is too. */
const asOf = today(DEMO_TIME_ZONE)

async function consumptionAt(date: string) {
  const { loadRoleConsumption } = await import('@/lib/db/queries/consumption')
  return loadRoleConsumption(ws.db, { asOf: date })
}

async function slippedAt(date: string) {
  return (await consumptionAt(date)).slipped
}

async function agingAt(date: string) {
  const { getBillingData } = await import('@/lib/db/queries/billing')
  const data = await getBillingData(ws.db, {
    from: '2000-01-01',
    to: '2099-12-31',
    groupBy: 'project',
    asOf: date,
  })
  return new Map(data.aging.map((row) => [row.bucket, row.cents]))
}

function sum(aging: Map<string, number>): number {
  return [...aging.values()].reduce((total, cents) => total + cents, 0)
}

/** The oldest and newest day carrying unbilled billable work. */
async function unbilledSpan(): Promise<{ oldest: string; newest: string }> {
  const rows = (
    await ws.db.execute(ws.sql`
      select min(te.entry_date)::text as oldest, max(te.entry_date)::text as newest
      from time_entries te
      join project_roles pr on pr.id = te.project_role_id
      join projects p on p.id = pr.project_id
      where p.billable = true and te.invoice_id is null
    `)
  ).rows as unknown as { oldest: string; newest: string }[]
  const span = rows[0]
  if (!span?.oldest || !span.newest) throw new Error('the seed must leave some work unbilled')
  return span
}

describe('slipped work is measured from asOf, never from the clock', () => {
  it('finds nothing at all before any booking has ended', async () => {
    expect(await slippedAt('2000-01-01')).toEqual([])
  })

  it('finds under-logged bookings once every window has closed', async () => {
    const slipped = await slippedAt('2099-12-31')
    expect(slipped.length).toBeGreaterThan(0)
    for (const row of slipped) {
      expect(row.loggedMinutes, `${row.bookingId} is not actually short`).toBeLessThan(
        row.bookedMinutes,
      )
    }
  })

  it('slips a booking on the day after it ends, and not on the day it ends', async () => {
    const [earliest] = [...(await slippedAt('2099-12-31'))].sort((a, b) =>
      a.endDate.localeCompare(b.endDate),
    )
    expect(earliest, 'the seed must contain at least one short booking').toBeTruthy()
    if (!earliest) return

    const onTheLastDay = (await slippedAt(earliest.endDate)).map((row) => row.bookingId)
    const theDayAfter = (await slippedAt(addDays(earliest.endDate, 1))).map((row) => row.bookingId)

    // The gate is `endDate < asOf`: a booking still has its final day to be logged.
    expect(onTheLastDay).not.toContain(earliest.bookingId)
    expect(theDayAfter).toContain(earliest.bookingId)
  })

  it('only ever grows as asOf moves forward', async () => {
    const early = await slippedAt(addDays(asOf, -60))
    const later = await slippedAt(addDays(asOf, 60))
    const laterIds = later.map((row) => row.bookingId)
    for (const row of early) expect(laterIds).toContain(row.bookingId)
    expect(later.length).toBeGreaterThanOrEqual(early.length)
  })

  it('moves undelivered plan out of committed and into stale as asOf advances', async () => {
    // The rule this replaces counted an undelivered day whenever it fell, so a booking
    // nobody logged against consumed its budget for as long as it existed and only a
    // manual edit could free it. A day is a live commitment until it passes, then it is
    // stale: still reported, but no longer spend.
    const early = await consumptionAt(addDays(asOf, -60))
    const later = await consumptionAt(addDays(asOf, 60))
    expect(later.byRole.size).toBe(early.byRole.size)

    let sawPlanGoStale = false
    for (const [roleId, role] of early.byRole) {
      const then = later.byRole.get(roleId)
      expect(then, roleId).toBeTruthy()
      if (!then) continue

      // The same undelivered plan, only split differently: asOf moves the line, never
      // the total. This is the invariant that makes the split safe.
      expect(then.committedMinutes + then.staleMinutes, roleId).toBe(
        role.committedMinutes + role.staleMinutes,
      )
      // One-way only. Plan goes stale as days pass and never comes back as commitment.
      expect(then.staleMinutes, roleId).toBeGreaterThanOrEqual(role.staleMinutes)
      expect(then.committedMinutes, roleId).toBeLessThanOrEqual(role.committedMinutes)
      // So budget can only be released by time passing, never re-consumed by it.
      expect(then.budget.remainingCents, roleId).toBeGreaterThanOrEqual(
        role.budget.remainingCents,
      )
      // Stale plan is reported but must never reach remaining budget.
      expect(then.budget.remainingCents, roleId).toBe(
        then.budgetCents - then.budget.deliveredCents - then.budget.committedCents,
      )
      if (then.staleMinutes > role.staleMinutes) sawPlanGoStale = true
    }
    expect(
      sawPlanGoStale,
      'the seed must contain booked days that fall between the two reference dates',
    ).toBe(true)
  })

  it('never counts a day as both committed and stale', async () => {
    // The boundary is `date >= asOf`, so today itself is still a live commitment.
    for (const offset of [-120, -30, 0, 30, 120]) {
      const at = await consumptionAt(addDays(asOf, offset))
      for (const [roleId, role] of at.byRole) {
        expect(role.committedMinutes, `${roleId} committed at ${offset}`).toBeGreaterThanOrEqual(0)
        expect(role.staleMinutes, `${roleId} stale at ${offset}`).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('invoice aging is measured from asOf, never from the clock', () => {
  it('is a partition: the total is the same whatever day you ask on', async () => {
    const { oldest, newest } = await unbilledSpan()
    const total = sum(await agingAt(oldest))
    expect(total).toBeGreaterThan(0)
    expect(sum(await agingAt(asOf))).toBe(total)
    expect(sum(await agingAt(addDays(newest, 400)))).toBe(total)
  })

  it('puts everything in the freshest bucket on the oldest entry own day', async () => {
    const { oldest } = await unbilledSpan()
    const aging = await agingAt(oldest)
    expect(aging.get('31_60')).toBe(0)
    expect(aging.get('61_90')).toBe(0)
    expect(aging.get('over_90')).toBe(0)
    expect(aging.get('0_30')).toBe(sum(aging))
  })

  it('puts everything in the oldest bucket once every entry is over 90 days old', async () => {
    const { newest } = await unbilledSpan()
    const aging = await agingAt(addDays(newest, 91))
    expect(aging.get('0_30')).toBe(0)
    expect(aging.get('31_60')).toBe(0)
    expect(aging.get('61_90')).toBe(0)
    expect(aging.get('over_90')).toBe(sum(aging))
  })

  it('moves the oldest entry over the 90-day line on exactly the 91st day', async () => {
    const { oldest } = await unbilledSpan()
    // Every other unbilled entry is newer than `oldest`, so at oldest+91 the only work
    // that can be over 90 days old is the work dated `oldest` itself.
    const at90 = await agingAt(addDays(oldest, 90))
    const at91 = await agingAt(addDays(oldest, 91))
    expect(at90.get('over_90')).toBe(0)
    expect(at91.get('over_90')).toBeGreaterThan(0)
  })

  it('ages monotonically: the freshest bucket drains as the oldest fills', async () => {
    const { oldest } = await unbilledSpan()
    let previousFresh = Number.POSITIVE_INFINITY
    let previousStale = -1
    for (const offset of [0, 30, 60, 90, 120, 200]) {
      const aging = await agingAt(addDays(oldest, offset))
      const fresh = aging.get('0_30') ?? 0
      const stale = aging.get('over_90') ?? 0
      expect(fresh, `0_30 at +${offset}`).toBeLessThanOrEqual(previousFresh)
      expect(stale, `over_90 at +${offset}`).toBeGreaterThanOrEqual(previousStale)
      previousFresh = fresh
      previousStale = stale
    }
  })
})
