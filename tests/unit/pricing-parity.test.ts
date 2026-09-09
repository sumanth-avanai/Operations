/**
 * The price of an hour is the single most load-bearing calculation in the product, and
 * it exists twice: `amountCents()` in TypeScript and `priceCents()` in SQL.
 *
 * This file proves the TypeScript side is exact — equal to integer half-up rounding of
 * `minutes x rate / 60` — across the whole legal input space. The SQL side is proved
 * equal to the TypeScript side against a real database in
 * `tests/integration/pricing-sql.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { amountCents } from '@/lib/domain/money'
import { MAX_RATE_CENTS } from '@/lib/db/schema'

/**
 * The reference implementation: exact half-up rounding using only integers, so it
 * cannot itself suffer floating-point error.
 *
 *   round_half_up(m*r/60) === floor((2*m*r + 60) / 120)
 */
function exactHalfUp(minutes: number, rateCents: number): number {
  return Math.floor((2 * minutes * rateCents + 60) / 120)
}

/** Every minute of a day, since a time entry is capped at 1440. */
const ALL_MINUTES = Array.from({ length: 1441 }, (_, i) => i)

/** Rates chosen to hit the awkward cases plus the boundaries the schema allows. */
const RATES = [
  0, 1, 2, 7, 29, 30, 31, 59, 60, 61, 99, 100, 101, 333, 999, 1000, 1001,
  3333, 9999, 10_000, 12_000, 12_500, 13_500, 16_500, 17_500,
  99_999, 100_000, 123_456, 999_999, 1_000_000, 12_345_678, MAX_RATE_CENTS,
]

describe('amountCents is exact integer arithmetic', () => {
  it('equals half-up rounding for every minute of a day at every representative rate', () => {
    const mismatches: string[] = []
    for (const rate of RATES) {
      for (const minutes of ALL_MINUTES) {
        const actual = amountCents(minutes, rate)
        const expected = exactHalfUp(minutes, rate)
        if (actual !== expected) mismatches.push(`${minutes}m @ ${rate} → ${actual} ≠ ${expected}`)
      }
    }
    // 46,112 combinations, and not one is allowed to differ.
    expect(mismatches.slice(0, 10)).toEqual([])
  })

  it('equals half-up rounding across a large pseudo-random sweep', () => {
    // Deterministic sweep so a failure is always reproducible.
    let seed = 424242
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    const mismatches: string[] = []
    for (let i = 0; i < 200_000; i++) {
      const minutes = Math.floor(next() * 1441)
      const rate = Math.floor(next() * (MAX_RATE_CENTS + 1))
      const actual = amountCents(minutes, rate)
      const expected = exactHalfUp(minutes, rate)
      if (actual !== expected) mismatches.push(`${minutes}m @ ${rate} → ${actual} ≠ ${expected}`)
    }
    expect(mismatches.slice(0, 10)).toEqual([])
  })

  it('rounds the exact half upward, never toward zero', () => {
    // minutes x rate ≡ 30 (mod 60) is the only way to land on an exact half cent.
    const halves: [number, number][] = []
    for (const minutes of ALL_MINUTES) {
      for (const rate of RATES) {
        if (minutes * rate > 0 && (minutes * rate) % 60 === 30) halves.push([minutes, rate])
      }
    }
    expect(halves.length).toBeGreaterThan(50)
    for (const [minutes, rate] of halves) {
      const exact = (minutes * rate) / 60
      expect(Number.isInteger(exact)).toBe(false)
      expect(amountCents(minutes, rate)).toBe(Math.floor(exact) + 1)
    }
  })

  it("stays inside Number.MAX_SAFE_INTEGER at the schema limits", () => {
    const worstProduct = 1440 * MAX_RATE_CENTS
    expect(worstProduct).toBeLessThan(Number.MAX_SAFE_INTEGER)
    // A million such entries summed is still exact.
    const worstSum = amountCents(1440, MAX_RATE_CENTS) * 1_000_000
    expect(worstSum).toBeLessThan(Number.MAX_SAFE_INTEGER)
    expect(Number.isSafeInteger(worstSum)).toBe(true)
  })

  it('is monotonic in both arguments', () => {
    for (const rate of [1, 12_000, MAX_RATE_CENTS]) {
      for (let minutes = 1; minutes <= 1440; minutes++) {
        expect(amountCents(minutes, rate)).toBeGreaterThanOrEqual(amountCents(minutes - 1, rate))
      }
    }
    for (const minutes of [1, 15, 480, 1440]) {
      let previous = -1
      for (const rate of RATES) {
        const value = amountCents(minutes, rate)
        expect(value).toBeGreaterThanOrEqual(previous)
        previous = value
      }
    }
  })

  it('never returns a non-integer, a negative, or NaN for legal inputs', () => {
    for (const rate of RATES) {
      for (const minutes of [0, 1, 7, 15, 450, 1440]) {
        const value = amountCents(minutes, rate)
        expect(Number.isInteger(value)).toBe(true)
        expect(value).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('refuses to produce a number from a non-number', () => {
    expect(amountCents(Number.NaN, 12_000)).toBe(0)
    expect(amountCents(60, Number.NaN)).toBe(0)
    expect(amountCents(Number.POSITIVE_INFINITY, 12_000)).toBe(0)
  })
})

describe('rounding per entry, then summing — the product\'s convention', () => {
  it('is what both implementations do, and the difference from summing first is bounded', () => {
    // Rounding each entry and summing is NOT the same as summing minutes then rounding.
    // The product rounds per entry (an invoice line is a real amount), and both the SQL
    // and the TypeScript path do it the same way. The drift is at most half a cent per
    // entry, which this pins down so nobody "fixes" one side later.
    const rate = 3333
    const entries = [7, 7, 7, 7, 7, 7, 7, 7, 7, 7]
    const perEntry = entries.reduce((sum, m) => sum + amountCents(m, rate), 0)
    const allAtOnce = amountCents(
      entries.reduce((a, b) => a + b, 0),
      rate,
    )
    expect(perEntry).toBe(3890)
    expect(allAtOnce).toBe(3889)
    expect(Math.abs(perEntry - allAtOnce)).toBeLessThanOrEqual(Math.ceil(entries.length / 2))
  })
})
