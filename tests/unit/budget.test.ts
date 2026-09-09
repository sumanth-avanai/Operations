import { describe, expect, it } from 'vitest'
import { budgetBand, rollUpBudgets, roleBudget } from '@/lib/domain/budget'

const RATE = 12_000 // 120.00 / hour

describe('roleBudget', () => {
  it('prices delivered work from logged minutes at the role rate', () => {
    const b = roleBudget({
      budgetCents: 1_200_000, // 12,000.00 = 100 hours
      rateCents: RATE,
      invoicedCents: 0,
      unbilledMinutes: 60 * 20, // 20 hours
      committedMinutes: 0,
    })
    expect(b.deliveredCents).toBe(240_000)
    expect(b.remainingCents).toBe(960_000)
    expect(b.deliveredPct).toBe(20)
    expect(b.overBudget).toBe(false)
  })

  it('keeps invoiced work at its frozen amount and re-prices only unbilled work', () => {
    const frozenAtOldRate = 100_000 // 10h invoiced when the rate was 100.00
    const b = roleBudget({
      budgetCents: 1_200_000,
      rateCents: RATE, // rate has since risen to 120.00
      invoicedCents: frozenAtOldRate,
      unbilledMinutes: 60 * 10,
      committedMinutes: 0,
    })
    // 100,000 frozen + 10h x 120.00
    expect(b.deliveredCents).toBe(100_000 + 120_000)
  })

  it('counts confirmed bookings as committed, not delivered', () => {
    const b = roleBudget({
      budgetCents: 1_200_000,
      rateCents: RATE,
      invoicedCents: 0,
      unbilledMinutes: 60 * 20,
      committedMinutes: 60 * 30,
    })
    expect(b.deliveredCents).toBe(240_000)
    expect(b.committedCents).toBe(360_000)
    expect(b.remainingCents).toBe(600_000)
    expect(b.consumedPct).toBe(50)
  })

  it('excludes tentative bookings from committed spend', () => {
    const b = roleBudget({
      budgetCents: 1_200_000,
      rateCents: RATE,
      invoicedCents: 0,
      unbilledMinutes: 0,
      committedMinutes: 0,
      tentativeMinutes: 60 * 40,
    })
    expect(b.committedCents).toBe(0)
    expect(b.tentativeCents).toBe(480_000)
    expect(b.remainingCents).toBe(1_200_000)
  })

  it('never double counts a booking that has already been delivered', () => {
    // The caller passes committedMinutes already net of delivered days, which is the
    // contract this module relies on. Delivered 30h, plan was 30h, nothing left over.
    const b = roleBudget({
      budgetCents: 1_200_000,
      rateCents: RATE,
      invoicedCents: 0,
      unbilledMinutes: 60 * 30,
      committedMinutes: 0,
    })
    expect(b.deliveredCents + b.committedCents).toBe(360_000)
  })

  it('distinguishes over-delivered from over-committed', () => {
    const overDelivered = roleBudget({
      budgetCents: 100_000,
      rateCents: RATE,
      invoicedCents: 0,
      unbilledMinutes: 60 * 10, // 1,200.00 delivered against 1,000.00 budget
      committedMinutes: 0,
    })
    expect(overDelivered.overBudget).toBe(true)
    expect(overDelivered.overCommitted).toBe(false)
    expect(overDelivered.remainingCents).toBeLessThan(0)
    expect(budgetBand(overDelivered)).toBe('over')

    const overCommitted = roleBudget({
      budgetCents: 100_000,
      rateCents: RATE,
      invoicedCents: 0,
      unbilledMinutes: 0,
      committedMinutes: 60 * 10,
    })
    expect(overCommitted.overBudget).toBe(false)
    expect(overCommitted.overCommitted).toBe(true)
    expect(budgetBand(overCommitted)).toBe('exhausted')
  })

  it('reports no budget rather than dividing by zero', () => {
    const b = roleBudget({
      budgetCents: 0,
      rateCents: RATE,
      invoicedCents: 0,
      unbilledMinutes: 60,
      committedMinutes: 0,
    })
    expect(b.deliveredPct).toBeNull()
    expect(b.consumedPct).toBeNull()
    expect(budgetBand(b)).toBe('none')
  })

  it('flags a role as tight once 85% is consumed', () => {
    const b = roleBudget({
      budgetCents: 1_000_000,
      rateCents: RATE,
      invoicedCents: 900_000,
      unbilledMinutes: 0,
      committedMinutes: 0,
    })
    expect(budgetBand(b)).toBe('tight')
  })
})

describe('rollUpBudgets', () => {
  it("makes a project's budget the sum of its roles", () => {
    const design = roleBudget({
      budgetCents: 500_000,
      rateCents: 11_000,
      invoicedCents: 110_000,
      unbilledMinutes: 60 * 5,
      committedMinutes: 60 * 10,
    })
    const dev = roleBudget({
      budgetCents: 900_000,
      rateCents: 13_500,
      invoicedCents: 0,
      unbilledMinutes: 60 * 20,
      committedMinutes: 0,
    })
    const total = rollUpBudgets([design, dev])
    expect(total.budgetCents).toBe(1_400_000)
    expect(total.deliveredCents).toBe(design.deliveredCents + dev.deliveredCents)
    expect(total.committedCents).toBe(design.committedCents + dev.committedCents)
    expect(total.remainingCents).toBe(
      total.budgetCents - total.deliveredCents - total.committedCents,
    )
  })

  it('is empty-safe', () => {
    const total = rollUpBudgets([])
    expect(total.budgetCents).toBe(0)
    expect(total.remainingCents).toBe(0)
    expect(total.consumedPct).toBeNull()
    expect(total.overBudget).toBe(false)
  })
})
