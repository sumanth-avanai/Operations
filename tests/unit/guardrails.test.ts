import { describe, expect, it } from 'vitest'
import {
  compactWarnings, holidayConflictWarning, nonBillableWarning, overCapacityWarning,
  overCommitmentWarning, rateChangeWarning, slippedWorkWarning, summarizeDayWarnings,
} from '@/lib/domain/guardrails'
import { utilization, utilizationBand, loadBand } from '@/lib/domain/utilization'

describe('overCapacityWarning', () => {
  it('fires when the day is over capacity and names the overage', () => {
    const w = overCapacityWarning({ date: '2026-09-17', usedMinutes: 600, availableMinutes: 480 })
    expect(w).not.toBeNull()
    expect(w?.code).toBe('over_capacity')
    expect(w?.date).toBe('2026-09-17')
    expect(w?.message).toContain('10')
    expect(w?.message).toContain('8')
    expect(w?.message).toContain('2')
  })

  it('stays quiet at exactly capacity and below', () => {
    expect(overCapacityWarning({ date: '2026-09-17', usedMinutes: 480, availableMinutes: 480 })).toBeNull()
    expect(overCapacityWarning({ date: '2026-09-17', usedMinutes: 60, availableMinutes: 480 })).toBeNull()
    expect(overCapacityWarning({ date: '2026-09-17', usedMinutes: 0, availableMinutes: 0 })).toBeNull()
  })

  it('says something meaningful for a day with no capacity at all', () => {
    const w = overCapacityWarning({ date: '2026-09-19', usedMinutes: 120, availableMinutes: 0 })
    expect(w?.message).toContain('no capacity')
  })
})

describe('overCommitmentWarning', () => {
  const base = { roleName: 'Senior Designer', projectName: 'Website Rebuild', currency: 'EUR' }

  it('fires when a booking exceeds the remaining budget and states the overage', () => {
    const w = overCommitmentWarning({ ...base, proposalCents: 500_000, remainingCents: 100_000 })
    expect(w?.code).toBe('over_commitment')
    expect(w?.message).toContain('Senior Designer')
    expect(w?.message).toContain('Website Rebuild')
    expect(w?.message).toContain('4,000') // the 4,000.00 overage
  })

  it('stays quiet when the booking fits exactly', () => {
    expect(overCommitmentWarning({ ...base, proposalCents: 100_000, remainingCents: 100_000 })).toBeNull()
  })

  it('handles an already-exhausted budget without saying "minus"', () => {
    const w = overCommitmentWarning({ ...base, proposalCents: 50_000, remainingCents: -20_000 })
    expect(w?.message).toContain('nothing')
  })
})

describe('slippedWorkWarning', () => {
  const base = { memberName: 'Mara Lindqvist', projectName: 'Loyalty App', endDate: '2026-08-28' }

  it('fires when planned work was not fully delivered', () => {
    const w = slippedWorkWarning({ ...base, bookedMinutes: 2400, loggedMinutes: 1200 })
    expect(w?.code).toBe('slipped_work')
    expect(w?.message).toContain('20') // 20h shortfall
    expect(w?.message).toContain('Mara Lindqvist')
  })

  it('stays quiet when the work was delivered or over-delivered', () => {
    expect(slippedWorkWarning({ ...base, bookedMinutes: 2400, loggedMinutes: 2400 })).toBeNull()
    expect(slippedWorkWarning({ ...base, bookedMinutes: 2400, loggedMinutes: 3000 })).toBeNull()
  })
})

describe('nonBillableWarning and rateChangeWarning', () => {
  it('warns about revenue leaving the billing view', () => {
    const w = nonBillableWarning({ projectName: 'Internal Tooling', unbilledCents: 250_000, currency: 'EUR' })
    expect(w?.message).toContain('2,500')
    expect(nonBillableWarning({ projectName: 'X', unbilledCents: 0, currency: 'EUR' })).toBeNull()
  })

  it('warns in both directions about a rate change, and not at all when unchanged', () => {
    const up = rateChangeWarning({ roleName: 'Dev', beforeCents: 100_000, afterCents: 120_000, currency: 'EUR' })
    expect(up?.message).toContain('increases')
    const down = rateChangeWarning({ roleName: 'Dev', beforeCents: 120_000, afterCents: 100_000, currency: 'EUR' })
    expect(down?.message).toContain('decreases')
    expect(rateChangeWarning({ roleName: 'Dev', beforeCents: 100_000, afterCents: 100_000, currency: 'EUR' })).toBeNull()
  })
})

describe('holidayConflictWarning', () => {
  it('preserves hours and names who logged them', () => {
    const w = holidayConflictWarning({
      date: '2026-10-03', holidayName: 'German Unity Day',
      members: ['Ada', 'Bo', 'Cy', 'Dee', 'Eve'], minutes: 960,
    })
    expect(w?.message).toContain('German Unity Day')
    expect(w?.message).toContain('2 more')
    expect(w?.message).toContain('kept')
  })

  it('stays quiet when nothing was logged', () => {
    expect(holidayConflictWarning({ date: '2026-10-03', holidayName: 'X', members: [], minutes: 0 })).toBeNull()
  })
})

describe('warning helpers', () => {
  it('drops nulls', () => {
    expect(compactWarnings([null, { code: 'over_capacity', message: 'a' }, null])).toHaveLength(1)
  })

  it('collapses a flood of per-day warnings into one readable line', () => {
    const many = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'].map((date) => ({
      code: 'over_capacity' as const, message: 'over', date,
    }))
    const summarized = summarizeDayWarnings([...many, { code: 'slipped_work', message: 'slip' }])
    expect(summarized).toHaveLength(2)
    expect(summarized.find((w) => w.code === 'over_capacity')?.message).toContain('5 days')
  })

  it('leaves a short list alone', () => {
    const few = [{ code: 'over_capacity' as const, message: 'over', date: '2026-09-14' }]
    expect(summarizeDayWarnings(few)).toHaveLength(1)
  })
})

describe('utilization', () => {
  it('divides billable work by availability, not by a fixed week', () => {
    const u = utilization({
      billableMinutes: 60 * 30, loggedMinutes: 60 * 36, availableMinutes: 60 * 40, targetPct: 75,
    })
    expect(u.pct).toBe(75)
    expect(u.billablePct).toBe(83)
    expect(u.variancePct).toBe(0)
    expect(u.band).toBe('on_target')
  })

  it('reports unknown rather than zero when there is no availability', () => {
    const u = utilization({ billableMinutes: 0, loggedMinutes: 0, availableMinutes: 0, targetPct: 75 })
    expect(u.pct).toBeNull()
    expect(u.variancePct).toBeNull()
    expect(u.band).toBe('unknown')
  })

  it('bands against the target with a five point tolerance', () => {
    expect(utilizationBand(71, 75)).toBe('on_target')
    expect(utilizationBand(69, 75)).toBe('under')
    expect(utilizationBand(101, 75)).toBe('over')
    expect(utilizationBand(0, 75)).toBe('idle')
    expect(utilizationBand(40, null)).toBe('on_target')
    expect(utilizationBand(null, 75)).toBe('unknown')
  })
})

describe('loadBand', () => {
  it('grades a day from free to over capacity', () => {
    expect(loadBand(0, 480)).toBe('empty')
    expect(loadBand(120, 480)).toBe('light')
    expect(loadBand(300, 480)).toBe('healthy')
    expect(loadBand(470, 480)).toBe('full')
    expect(loadBand(600, 480)).toBe('over')
  })

  it('treats any booking on a zero-capacity day as over', () => {
    expect(loadBand(60, 0)).toBe('over')
    expect(loadBand(0, 0)).toBe('empty')
  })
})
