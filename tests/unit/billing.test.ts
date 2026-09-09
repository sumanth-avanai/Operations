import { describe, expect, it } from 'vitest'
import {
  AGING_LABELS, agingBucket, billingSplit, splitBalances, splitFromParts, sumSplits,
} from '@/lib/domain/billing'

describe('billingSplit', () => {
  it('defines logged as invoiced plus unbilled, so it cannot disagree', () => {
    const s = billingSplit({
      invoicedCents: 300_000,
      invoicedMinutes: 60 * 25,
      unbilledMinutes: 60 * 10,
      rateCents: 12_000,
    })
    expect(s.unbilledCents).toBe(120_000)
    expect(s.loggedCents).toBe(420_000)
    expect(s.loggedMinutes).toBe(60 * 35)
    expect(splitBalances(s)).toBe(true)
  })

  it('re-prices unbilled work when the rate changes but leaves invoiced work frozen', () => {
    const before = billingSplit({
      invoicedCents: 100_000,
      invoicedMinutes: 600,
      unbilledMinutes: 600,
      rateCents: 10_000,
    })
    const after = billingSplit({
      invoicedCents: 100_000,
      invoicedMinutes: 600,
      unbilledMinutes: 600,
      rateCents: 12_000,
    })
    expect(before.unbilledCents).toBe(100_000)
    expect(after.unbilledCents).toBe(120_000)
    expect(after.invoicedCents).toBe(before.invoicedCents)
    expect(after.loggedCents - before.loggedCents).toBe(20_000)
  })

  it('is zero-safe', () => {
    const s = billingSplit({ invoicedCents: 0, invoicedMinutes: 0, unbilledMinutes: 0, rateCents: 12_000 })
    expect(s.loggedCents).toBe(0)
    expect(splitBalances(s)).toBe(true)
  })
})

describe('sumSplits', () => {
  it('keeps the identity intact when roles at different rates are combined', () => {
    const design = billingSplit({
      invoicedCents: 55_000, invoicedMinutes: 300, unbilledMinutes: 450, rateCents: 11_000,
    })
    const dev = billingSplit({
      invoicedCents: 0, invoicedMinutes: 0, unbilledMinutes: 480, rateCents: 13_500,
    })
    const pm = billingSplit({
      invoicedCents: 20_000, invoicedMinutes: 120, unbilledMinutes: 0, rateCents: 10_000,
    })
    const total = sumSplits([design, dev, pm])
    expect(total.invoicedCents).toBe(75_000)
    expect(total.unbilledCents).toBe(design.unbilledCents + dev.unbilledCents)
    expect(total.loggedCents).toBe(total.invoicedCents + total.unbilledCents)
    expect(total.loggedMinutes).toBe(total.invoicedMinutes + total.unbilledMinutes)
    expect(splitBalances(total)).toBe(true)
  })

  it('is empty-safe and balanced', () => {
    const total = sumSplits([])
    expect(total.loggedCents).toBe(0)
    expect(splitBalances(total)).toBe(true)
  })
})

describe('splitFromParts', () => {
  it('accepts already-priced parts and still balances', () => {
    const s = splitFromParts({
      invoicedCents: 12_345, unbilledCents: 6_789, invoicedMinutes: 100, unbilledMinutes: 50,
    })
    expect(s.loggedCents).toBe(19_134)
    expect(s.loggedMinutes).toBe(150)
    expect(splitBalances(s)).toBe(true)
  })
})

describe('agingBucket', () => {
  it('buckets unbilled work by age', () => {
    expect(agingBucket(0)).toBe('0_30')
    expect(agingBucket(30)).toBe('0_30')
    expect(agingBucket(31)).toBe('31_60')
    expect(agingBucket(60)).toBe('31_60')
    expect(agingBucket(61)).toBe('61_90')
    expect(agingBucket(91)).toBe('over_90')
    expect(AGING_LABELS[agingBucket(120)]).toBe('Over 90 days')
  })
})
