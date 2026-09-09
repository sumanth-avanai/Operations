import { describe, expect, it } from 'vitest'
import {
  amountCents, formatHours, formatMoney, hoursToMinutes, minutesToHours,
  parseHoursInput, parseMoneyInput, percentOf,
} from '@/lib/domain/money'

describe('amountCents', () => {
  it('prices time exactly, with no float drift', () => {
    expect(amountCents(60, 12000)).toBe(12000)
    expect(amountCents(30, 12000)).toBe(6000)
    expect(amountCents(450, 12550)).toBe(94125) // 7.5h at 125.50
    expect(amountCents(0, 12000)).toBe(0)
  })

  it('rounds half-up to the cent', () => {
    expect(amountCents(1, 30)).toBe(1) // 0.5 -> 1
    expect(amountCents(1, 29)).toBe(0) // 0.483 -> 0
    expect(amountCents(7, 100)).toBe(12) // 11.67 -> 12
  })

  it('stays exact where floating point would not', () => {
    // 0.1 + 0.2 territory: ten six-minute entries at 33.33/h must total exactly 33.30
    const perEntry = amountCents(6, 3333)
    expect(perEntry).toBe(333)
    expect(perEntry * 10).toBe(3330)
    // and a long month of awkward values never accumulates error
    let total = 0
    for (let i = 0; i < 1000; i++) total += amountCents(7, 3333)
    expect(total).toBe(389_000)
    expect(Number.isInteger(total)).toBe(true)
  })

  it('survives a rate of one cent per hour', () => {
    expect(amountCents(60, 1)).toBe(1)
    expect(amountCents(30, 1)).toBe(1) // half-up, not silently zero
  })
})

describe('hours conversion', () => {
  it('round-trips', () => {
    expect(minutesToHours(450)).toBe(7.5)
    expect(minutesToHours(0)).toBe(0)
    expect(hoursToMinutes(7.5)).toBe(450)
    expect(hoursToMinutes(0.25)).toBe(15)
  })

  it('formats for dense grids', () => {
    expect(formatHours(450)).toBe('7.5')
    expect(formatHours(480)).toBe('8')
    expect(formatHours(465)).toBe('7.75')
    expect(formatHours(0)).toBe('—')
    expect(formatHours(0, { zero: '' })).toBe('')
    expect(formatHours(450, { style: 'clock' })).toBe('7:30')
    expect(formatHours(485, { style: 'clock' })).toBe('8:05')
    expect(formatHours(-60)).toBe('-1')
  })
})

describe('parseHoursInput', () => {
  it('accepts what people actually type', () => {
    expect(parseHoursInput('7')).toBe(420)
    expect(parseHoursInput('7.5')).toBe(450)
    expect(parseHoursInput('7,5')).toBe(450)
    expect(parseHoursInput('7:30')).toBe(450)
    expect(parseHoursInput('7h30')).toBe(450)
    expect(parseHoursInput('7h')).toBe(420)
    expect(parseHoursInput('90m')).toBe(90)
    expect(parseHoursInput(':30')).toBe(30)
    expect(parseHoursInput(' 7.5 ')).toBe(450)
    expect(parseHoursInput('0.25')).toBe(15)
  })

  it('treats an empty cell as a deliberate zero', () => {
    expect(parseHoursInput('')).toBe(0)
    expect(parseHoursInput('   ')).toBe(0)
    expect(parseHoursInput('0')).toBe(0)
  })

  it('rejects nonsense rather than guessing', () => {
    expect(parseHoursInput('abc')).toBeNull()
    expect(parseHoursInput('7:75')).toBeNull()
    expect(parseHoursInput('.')).toBeNull()
    expect(parseHoursInput('7-5')).toBeNull()
  })
})

describe('money formatting and parsing', () => {
  it('formats with the workspace currency', () => {
    expect(formatMoney(12_550, 'EUR', { locale: 'en-GB' })).toContain('125.50')
    expect(formatMoney(0, 'EUR', { locale: 'en-GB' })).toContain('0.00')
    expect(formatMoney(-5000, 'EUR', { locale: 'en-GB' })).toContain('50.00')
  })

  it('parses both European and US notation', () => {
    expect(parseMoneyInput('1.234,50')).toBe(123_450)
    expect(parseMoneyInput('1,234.50')).toBe(123_450)
    expect(parseMoneyInput('€ 125.50')).toBe(12_550)
    expect(parseMoneyInput('125')).toBe(12_500)
    expect(parseMoneyInput('1234')).toBe(123_400)
    expect(parseMoneyInput('')).toBeNull()
    expect(parseMoneyInput('abc')).toBeNull()
  })
})

describe('percentOf', () => {
  it('returns null rather than a misleading zero', () => {
    expect(percentOf(5, 10)).toBe(50)
    expect(percentOf(0, 10)).toBe(0)
    expect(percentOf(5, 0)).toBeNull()
    expect(percentOf(0, 0)).toBeNull()
  })
})
