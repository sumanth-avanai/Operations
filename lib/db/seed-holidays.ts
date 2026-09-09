/**
 * Public holidays computed rather than hardcoded, so the demo workspace has correct
 * non-working days for whatever year it is first started in.
 */
import { addDays, dayOfWeek } from '@/lib/domain/dates'
import type { ISODate } from '@/lib/domain/types'

/** Anonymous Gregorian algorithm — Easter Sunday for a given year. */
function easterSunday(year: number): ISODate {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): ISODate {
  const first: ISODate = `${year}-${String(month).padStart(2, '0')}-01`
  const shift = (weekday - dayOfWeek(first) + 7) % 7
  return addDays(first, shift + (nth - 1) * 7)
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): ISODate {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const last: ISODate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`
  const shift = (dayOfWeek(last) - weekday + 7) % 7
  return addDays(last, -shift)
}

/** UK practice: a holiday landing at the weekend is observed on the next weekday. */
function substituted(date: ISODate): ISODate {
  const dow = dayOfWeek(date)
  if (dow === 6) return addDays(date, 2)
  if (dow === 0) return addDays(date, 1)
  return date
}

export type SeedHoliday = { holidayDate: ISODate; name: string }

export function germanBerlinHolidays(year: number): SeedHoliday[] {
  const easter = easterSunday(year)
  return [
    { holidayDate: `${year}-01-01`, name: 'Neujahr' },
    { holidayDate: `${year}-03-08`, name: 'Internationaler Frauentag' },
    { holidayDate: addDays(easter, -2), name: 'Karfreitag' },
    { holidayDate: addDays(easter, 1), name: 'Ostermontag' },
    { holidayDate: `${year}-05-01`, name: 'Tag der Arbeit' },
    { holidayDate: addDays(easter, 39), name: 'Christi Himmelfahrt' },
    { holidayDate: addDays(easter, 50), name: 'Pfingstmontag' },
    { holidayDate: `${year}-10-03`, name: 'Tag der Deutschen Einheit' },
    { holidayDate: `${year}-12-25`, name: '1. Weihnachtstag' },
    { holidayDate: `${year}-12-26`, name: '2. Weihnachtstag' },
  ]
}

export function englandHolidays(year: number): SeedHoliday[] {
  const easter = easterSunday(year)
  return [
    { holidayDate: substituted(`${year}-01-01`), name: "New Year's Day" },
    { holidayDate: addDays(easter, -2), name: 'Good Friday' },
    { holidayDate: addDays(easter, 1), name: 'Easter Monday' },
    { holidayDate: nthWeekdayOfMonth(year, 5, 1, 1), name: 'Early May bank holiday' },
    { holidayDate: lastWeekdayOfMonth(year, 5, 1), name: 'Spring bank holiday' },
    { holidayDate: lastWeekdayOfMonth(year, 8, 1), name: 'Summer bank holiday' },
    { holidayDate: substituted(`${year}-12-25`), name: 'Christmas Day' },
    { holidayDate: substituted(`${year}-12-26`), name: 'Boxing Day' },
  ]
}
