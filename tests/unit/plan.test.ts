import { describe, expect, it } from 'vitest'
import { splitCell, splitPlan, type PlanCell } from '@/lib/domain/plan'
import type { ISODate } from '@/lib/domain/types'

/**
 * Every case here is a scenario the old rule got wrong. The old rule asked "did they log
 * anything?" and released the whole day on a yes, held the whole day forever on a no.
 */
const ASOF: ISODate = '2026-09-03'
const H = (hours: number) => hours * 60

const PAST: ISODate = '2026-08-26'
const TODAY: ISODate = ASOF
const FUTURE: ISODate = '2026-09-10'

function cell(over: Partial<PlanCell> = {}): PlanCell {
  return {
    key: 'design',
    date: FUTURE,
    confirmedMinutes: H(8),
    tentativeMinutes: 0,
    loggedMinutes: 0,
    ...over,
  }
}

describe('delivered work supersedes the plan minute for minute', () => {
  it('leaves 7h59m owed when one minute is logged against an 8h day', () => {
    // The give-away: a token entry used to clear the entire day.
    const split = splitCell(cell({ loggedMinutes: 1 }), ASOF)
    expect(split.committedMinutes).toBe(H(8) - 1)
    expect(split.staleMinutes).toBe(0)
  })

  it('leaves 4h owed when half the day is logged', () => {
    expect(splitCell(cell({ loggedMinutes: H(4) }), ASOF).committedMinutes).toBe(H(4))
  })

  it('leaves 2h owed on a normal 6h-of-8h day', () => {
    expect(splitCell(cell({ loggedMinutes: H(6) }), ASOF).committedMinutes).toBe(H(2))
  })

  it('owes nothing once the day is fully delivered', () => {
    expect(splitCell(cell({ loggedMinutes: H(8) }), ASOF).committedMinutes).toBe(0)
  })

  it('floors at zero on overtime rather than inventing negative capacity', () => {
    const split = splitCell(cell({ loggedMinutes: H(12) }), ASOF)
    expect(split.committedMinutes).toBe(0)
    expect(split.staleMinutes).toBe(0)
  })
})

describe('two bookings on one day are netted once, not once each', () => {
  it('keeps 8h owed when 16h is booked and 8h delivered', () => {
    // The caller sums both bookings into the cell first. Netting per booking would give
    // max(8-8,0) + max(8-8,0) = 0, and 8h of plan would vanish.
    const split = splitCell(
      cell({ date: PAST, confirmedMinutes: H(16), loggedMinutes: H(8) }),
      ASOF,
    )
    expect(split.staleMinutes).toBe(H(8))
  })
})

describe('one person cannot cancel another person plan', () => {
  it('keeps the second member shortfall when the first logs overtime', () => {
    // Alice and Bob are both booked 8h on the same role and day. Alice logs 16h.
    // Cells are per member, so Alice overtime cannot reach Bob plan.
    const cells: PlanCell[] = [
      cell({ key: 'design', date: FUTURE, confirmedMinutes: H(8), loggedMinutes: H(16) }),
      cell({ key: 'design', date: FUTURE, confirmedMinutes: H(8), loggedMinutes: 0 }),
    ]
    const totals = splitPlan(cells, ASOF)
    expect(totals.get('design')?.committedMinutes).toBe(H(8))
  })
})

describe('the split at asOf', () => {
  it('charges a day that has not arrived yet', () => {
    const split = splitCell(cell({ date: FUTURE }), ASOF)
    expect(split.committedMinutes).toBe(H(8))
    expect(split.staleMinutes).toBe(0)
  })

  it('charges today itself, which is still live', () => {
    const split = splitCell(cell({ date: TODAY }), ASOF)
    expect(split.committedMinutes).toBe(H(8))
    expect(split.staleMinutes).toBe(0)
  })

  it('stops charging a day once it is gone, and reports it instead', () => {
    // This is the locked-hours bug: an undelivered past day used to consume budget for
    // as long as the booking existed, with no way to release it.
    const split = splitCell(cell({ date: PAST }), ASOF)
    expect(split.committedMinutes).toBe(0)
    expect(split.staleMinutes).toBe(H(8))
  })

  it('splits a booking that straddles asOf without losing or inventing minutes', () => {
    const cells: PlanCell[] = [
      cell({ date: '2026-08-31' }),
      cell({ date: '2026-09-01' }),
      cell({ date: '2026-09-02' }),
      cell({ date: TODAY }),
      cell({ date: '2026-09-04' }),
    ]
    const totals = splitPlan(cells, ASOF)
    expect(totals.get('design')?.staleMinutes).toBe(H(24))
    expect(totals.get('design')?.committedMinutes).toBe(H(16))
  })

  it('releases budget as time passes and never re-charges it', () => {
    const week: PlanCell[] = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'].map((date) =>
      cell({ date: date as ISODate }),
    )
    let previousCommitted = Number.POSITIVE_INFINITY
    let previousStale = -1
    for (const asOf of ['2026-08-01', '2026-09-02', '2026-09-04', '2026-10-01'] as ISODate[]) {
      const totals = splitPlan(week, asOf).get('design')
      const committed = totals?.committedMinutes ?? 0
      const stale = totals?.staleMinutes ?? 0
      expect(committed + stale, `total owed at ${asOf}`).toBe(H(32))
      expect(committed, `committed at ${asOf}`).toBeLessThanOrEqual(previousCommitted)
      expect(stale, `stale at ${asOf}`).toBeGreaterThanOrEqual(previousStale)
      previousCommitted = committed
      previousStale = stale
    }
  })
})

describe('tentative plan', () => {
  it('is tracked as pipeline while its day is still ahead', () => {
    const split = splitCell(
      cell({ date: FUTURE, confirmedMinutes: 0, tentativeMinutes: H(8) }),
      ASOF,
    )
    expect(split.tentativeMinutes).toBe(H(8))
    expect(split.committedMinutes).toBe(0)
  })

  it('is not pipeline once its day has passed undelivered', () => {
    const split = splitCell(
      cell({ date: PAST, confirmedMinutes: 0, tentativeMinutes: H(8) }),
      ASOF,
    )
    expect(split.tentativeMinutes).toBe(0)
    expect(split.staleMinutes).toBe(0)
  })

  it('lets confirmed plan absorb the day delivery before tentative can', () => {
    // 8h confirmed + 8h tentative, 10h logged: confirmed is fully covered, and only the
    // 2h left over supersedes tentative.
    const split = splitCell(
      cell({ date: FUTURE, confirmedMinutes: H(8), tentativeMinutes: H(8), loggedMinutes: H(10) }),
      ASOF,
    )
    expect(split.committedMinutes).toBe(0)
    expect(split.tentativeMinutes).toBe(H(6))
  })
})

describe('splitPlan bookkeeping', () => {
  it('groups by key and keeps roles apart', () => {
    const totals = splitPlan(
      [
        cell({ key: 'design', confirmedMinutes: H(8) }),
        cell({ key: 'design', confirmedMinutes: H(4) }),
        cell({ key: 'build', confirmedMinutes: H(2) }),
      ],
      ASOF,
    )
    expect(totals.get('design')?.committedMinutes).toBe(H(12))
    expect(totals.get('build')?.committedMinutes).toBe(H(2))
  })

  it('omits a key whose plan is fully delivered, so an empty map means a clean plan', () => {
    const totals = splitPlan([cell({ loggedMinutes: H(8) })], ASOF)
    expect(totals.size).toBe(0)
  })

  it('never mutates the caller cells', () => {
    const cells = [cell({ loggedMinutes: H(3) })]
    const before = structuredClone(cells)
    splitPlan(cells, ASOF)
    expect(cells).toEqual(before)
  })
})
