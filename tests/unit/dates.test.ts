import { describe, expect, it } from 'vitest'
import {
  addDays, addMonths, calendarDate, countDays, diffDays, eachDay, endOfMonth, endOfQuarter,
  endOfWeek, endOfYear, isISODate, isTimeZone, isWithin, presetRange, quarterOf, rangesOverlap,
  shiftTimeline, startOfMonth, startOfQuarter, startOfWeek, timelineRange, today, weekdayKey,
} from '@/lib/domain/dates'

describe('isISODate', () => {
  it('accepts real calendar dates and rejects impostors', () => {
    expect(isISODate('2026-09-01')).toBe(true)
    expect(isISODate('2024-02-29')).toBe(true)
    expect(isISODate('2026-02-30')).toBe(false)
    expect(isISODate('2026-13-01')).toBe(false)
    expect(isISODate('2026-9-1')).toBe(false)
    expect(isISODate('')).toBe(false)
    expect(isISODate(20260901)).toBe(false)
  })
})

describe('day arithmetic', () => {
  it('crosses month, year and leap boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('is immune to daylight saving, because it never uses local time', () => {
    // Europe/Berlin springs forward on 2026-03-29 and falls back on 2026-10-25.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29')
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30')
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25')
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26')
    expect(diffDays('2026-03-28', '2026-03-30')).toBe(2)
    expect(diffDays('2026-10-24', '2026-10-26')).toBe(2)
  })

  it('clamps addMonths to the end of a shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
  })

  it('counts inclusive ranges and refuses inverted ones', () => {
    expect(countDays('2026-09-01', '2026-09-07')).toBe(7)
    expect(countDays('2026-09-01', '2026-09-01')).toBe(1)
    expect(countDays('2026-09-07', '2026-09-01')).toBe(0)
    expect(eachDay('2026-09-07', '2026-09-01')).toEqual([])
    expect(eachDay('2026-02-27', '2026-03-02')).toEqual([
      '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02',
    ])
  })
})

describe('weekdays and weeks', () => {
  it('maps weekday keys Monday-first', () => {
    expect(weekdayKey('2026-08-31')).toBe('mon')
    expect(weekdayKey('2026-09-04')).toBe('fri')
    expect(weekdayKey('2026-09-05')).toBe('sat')
    expect(weekdayKey('2026-09-06')).toBe('sun')
  })

  it('finds the week containing a date for either week start', () => {
    // 2026-09-01 is a Tuesday.
    expect(startOfWeek('2026-09-01', 1)).toBe('2026-08-31')
    expect(endOfWeek('2026-09-01', 1)).toBe('2026-09-06')
    expect(startOfWeek('2026-09-01', 0)).toBe('2026-08-30')
    expect(endOfWeek('2026-09-01', 0)).toBe('2026-09-05')
    // A Monday is its own week start.
    expect(startOfWeek('2026-08-31', 1)).toBe('2026-08-31')
  })

  it('keeps a week contiguous across a month and a year boundary', () => {
    const monthEdge = eachDay(startOfWeek('2026-09-01', 1), endOfWeek('2026-09-01', 1))
    expect(monthEdge).toHaveLength(7)
    expect(monthEdge[0]).toBe('2026-08-31')
    expect(monthEdge[6]).toBe('2026-09-06')

    const yearEdge = eachDay(startOfWeek('2027-01-01', 1), endOfWeek('2027-01-01', 1))
    expect(yearEdge).toHaveLength(7)
    expect(yearEdge[0]).toBe('2026-12-28')
    expect(yearEdge[6]).toBe('2027-01-03')
  })
})

describe('period boundaries', () => {
  it('finds months, quarters and years', () => {
    expect(startOfMonth('2026-09-17')).toBe('2026-09-01')
    expect(endOfMonth('2026-09-17')).toBe('2026-09-30')
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28')
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29')
    expect(startOfQuarter('2026-09-17')).toBe('2026-07-01')
    expect(endOfQuarter('2026-09-17')).toBe('2026-09-30')
    expect(startOfQuarter('2026-01-01')).toBe('2026-01-01')
    expect(endOfQuarter('2026-12-31')).toBe('2026-12-31')
    expect(endOfYear('2026-05-05')).toBe('2026-12-31')
    expect(quarterOf('2026-04-01')).toBe(2)
    expect(quarterOf('2026-12-31')).toBe(4)
  })
})

describe('ready-made ranges', () => {
  const ref = '2026-09-17' // a Thursday in Q3

  it('resolves every preset against a fixed reference day', () => {
    expect(presetRange('this_week', ref)).toEqual({ from: '2026-09-14', to: '2026-09-20' })
    expect(presetRange('last_week', ref)).toEqual({ from: '2026-09-07', to: '2026-09-13' })
    expect(presetRange('this_month', ref)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(presetRange('last_month', ref)).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(presetRange('this_quarter', ref)).toEqual({ from: '2026-07-01', to: '2026-09-30' })
    expect(presetRange('last_quarter', ref)).toEqual({ from: '2026-04-01', to: '2026-06-30' })
    expect(presetRange('this_year', ref)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(presetRange('last_year', ref)).toEqual({ from: '2025-01-01', to: '2025-12-31' })
    expect(presetRange('last_30_days', ref)).toEqual({ from: '2026-08-19', to: '2026-09-17' })
  })

  it('handles last_month and last_quarter across a year boundary', () => {
    expect(presetRange('last_month', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(presetRange('last_quarter', '2026-02-15')).toEqual({ from: '2025-10-01', to: '2025-12-31' })
  })
})

describe('timeline scales', () => {
  it('windows and shifts each scale', () => {
    expect(timelineRange('week', '2026-09-17')).toEqual({ from: '2026-09-14', to: '2026-09-20' })
    expect(timelineRange('quarter', '2026-09-17')).toEqual({ from: '2026-07-01', to: '2026-09-30' })
    expect(shiftTimeline('week', '2026-09-17', 1)).toBe('2026-09-24')
    expect(shiftTimeline('month', '2026-01-31', 1)).toBe('2026-02-28')
    expect(shiftTimeline('quarter', '2026-09-17', -1)).toBe('2026-06-17')
    expect(shiftTimeline('year', '2026-09-17', 1)).toBe('2027-09-17')
  })
})

describe('containment and overlap', () => {
  it('is inclusive at both ends', () => {
    expect(isWithin('2026-09-01', '2026-09-01', '2026-09-30')).toBe(true)
    expect(isWithin('2026-09-30', '2026-09-01', '2026-09-30')).toBe(true)
    expect(isWithin('2026-08-31', '2026-09-01', '2026-09-30')).toBe(false)
  })

  it('detects touching ranges as overlapping', () => {
    expect(rangesOverlap('2026-09-01', '2026-09-10', '2026-09-10', '2026-09-20')).toBe(true)
    expect(rangesOverlap('2026-09-01', '2026-09-09', '2026-09-10', '2026-09-20')).toBe(false)
  })
})

describe('which day it is depends on the zone you ask in', () => {
  // 20:30 UTC. Late evening in London, next morning in Kolkata, early afternoon in LA.
  const instant = new Date('2026-09-01T20:30:00.000Z')

  it('names the day the way a person in that zone would', () => {
    expect(calendarDate(instant, 'UTC')).toBe('2026-09-01')
    expect(calendarDate(instant, 'Europe/London')).toBe('2026-09-01')
    expect(calendarDate(instant, 'America/Los_Angeles')).toBe('2026-09-01')
    // +05:30 puts this instant at 02:00 on the 2nd — the case that makes a server in UTC
    // hand an Indian agency yesterday's date every morning.
    expect(calendarDate(instant, 'Asia/Kolkata')).toBe('2026-09-02')
    expect(calendarDate(instant, 'Asia/Tokyo')).toBe('2026-09-02')
  })

  it('crosses the year with the zone, not with UTC', () => {
    const newYear = new Date('2026-01-01T00:30:00.000Z')
    expect(calendarDate(newYear, 'UTC')).toBe('2026-01-01')
    expect(calendarDate(newYear, 'Pacific/Honolulu')).toBe('2025-12-31')
    expect(calendarDate(newYear, 'America/New_York')).toBe('2025-12-31')
  })

  it('is unaffected by a daylight-saving transition', () => {
    // Central European Summer Time begins at 02:00 local on 2026-03-29.
    expect(calendarDate(new Date('2026-03-29T00:30:00.000Z'), 'Europe/Berlin')).toBe('2026-03-29')
    expect(calendarDate(new Date('2026-03-29T01:30:00.000Z'), 'Europe/Berlin')).toBe('2026-03-29')
    expect(calendarDate(new Date('2026-03-28T23:30:00.000Z'), 'Europe/Berlin')).toBe('2026-03-29')
  })

  it('falls back to the host calendar instead of throwing on an unknown zone', () => {
    // A settings row holding a zone this Node build has never heard of must not be able
    // to take down every page in the product.
    expect(() => calendarDate(instant, 'Mars/Olympus_Mons')).not.toThrow()
    expect(isISODate(calendarDate(instant, 'Mars/Olympus_Mons'))).toBe(true)
    expect(isISODate(calendarDate(instant))).toBe(true)
  })

  it('recognises only zones it can actually resolve', () => {
    expect(isTimeZone('Europe/Berlin')).toBe(true)
    expect(isTimeZone('UTC')).toBe(true)
    expect(isTimeZone('Asia/Kolkata')).toBe(true)
    expect(isTimeZone('Mars/Olympus_Mons')).toBe(false)
    expect(isTimeZone('Europe/Berlin ')).toBe(false)
    expect(isTimeZone('')).toBe(false)
    expect(isTimeZone(null)).toBe(false)
    expect(isTimeZone(undefined)).toBe(false)
  })

  it('spans at most one day across the whole world, whenever it is run', () => {
    // +14 and -10 are the extremes of the zone range, exactly 24 hours apart.
    const first = today('Pacific/Kiritimati')
    const last = today('Pacific/Honolulu')
    expect(isISODate(first)).toBe(true)
    expect(isISODate(last)).toBe(true)
    expect(diffDays(last, first)).toBeGreaterThanOrEqual(0)
    expect(diffDays(last, first)).toBeLessThanOrEqual(1)
  })
})
