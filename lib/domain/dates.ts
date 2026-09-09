/**
 * Calendar-date arithmetic on 'YYYY-MM-DD' strings.
 *
 * Pure and dependency-free. The arithmetic is timezone-free — a timesheet day is a day
 * — and `Date` appears only as an internal integer calendar at UTC midnight, never
 * crossing a function boundary.
 *
 * Exactly one question needs a zone: which calendar day an instant falls on. Only
 * `calendarDate` and `today` ask it, and they take the zone as an argument instead of
 * reading the host's, so a server in UTC and a browser in IST cannot each invent their
 * own idea of the current day.
 */
import { WEEKDAY_KEYS, type ISODate, type WeekdayKey } from './types'

const MS_PER_DAY = 86_400_000
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return false
  const ms = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(ms) && toISO(ms) === value
}

function toEpoch(date: ISODate): number {
  const ms = Date.parse(`${date}T00:00:00.000Z`)
  if (!Number.isFinite(ms)) throw new RangeError(`Not a calendar date: ${date}`)
  return ms
}

function toISO(epoch: number): ISODate {
  return new Date(epoch).toISOString().slice(0, 10)
}

/* --------------------------------------------------------- naming the current day */

/** Cached: one request resolves the workspace's day many times over. */
const dateFormatters = new Map<string, Intl.DateTimeFormat | null>()

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  if (!dateFormatters.has(timeZone)) {
    try {
      dateFormatters.set(
        timeZone,
        new Intl.DateTimeFormat('en-US', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }),
      )
    } catch {
      // A zone this runtime cannot resolve. Remembered, so it is only ever tried once.
      dateFormatters.set(timeZone, null)
    }
  }
  return dateFormatters.get(timeZone) ?? null
}

/** True for an IANA zone this runtime can actually resolve, e.g. 'Europe/Berlin'. */
export function isTimeZone(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && formatterFor(value) !== null
}

/**
 * The calendar day an instant falls on, in `timeZone`.
 *
 * With no zone — or one this runtime cannot resolve — it falls back to the host's own
 * calendar rather than throwing: a settings row holding a zone this Node build has
 * never heard of must not be able to take down every page in the product.
 */
export function calendarDate(instant: Date, timeZone?: string): ISODate {
  if (timeZone) {
    const formatter = formatterFor(timeZone)
    if (formatter) {
      const parts = formatter.formatToParts(instant)
      const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
      const iso = `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`
      if (isISODate(iso)) return iso
    }
  }
  const y = instant.getFullYear()
  const m = String(instant.getMonth() + 1).padStart(2, '0')
  const d = String(instant.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * The day a person in `timeZone` would call today.
 *
 * Pass the workspace's zone. Pages never call this themselves — they read `ctx.today`,
 * resolved once per request, so no two panels on a screen can disagree about the date.
 */
export function today(timeZone?: string): ISODate {
  return calendarDate(new Date(), timeZone)
}

export function addDays(date: ISODate, days: number): ISODate {
  return toISO(toEpoch(date) + days * MS_PER_DAY)
}

export function addMonths(date: ISODate, months: number): ISODate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, lastDay))
  return toISO(target.getTime())
}

/** Whole days from `a` to `b`; negative when `b` is earlier. */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toEpoch(b) - toEpoch(a)) / MS_PER_DAY)
}

/** 0 = Sunday … 6 = Saturday, matching the workspace's week-start setting. */
export function dayOfWeek(date: ISODate): number {
  return new Date(toEpoch(date)).getUTCDay()
}

export function weekdayKey(date: ISODate): WeekdayKey {
  // getUTCDay is Sunday-first; WEEKDAY_KEYS is Monday-first.
  return WEEKDAY_KEYS[(dayOfWeek(date) + 6) % 7] as WeekdayKey
}

export function isWeekend(date: ISODate): boolean {
  const d = dayOfWeek(date)
  return d === 0 || d === 6
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b
}
export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b
}

/** Inclusive containment. String comparison is correct for this format. */
export function isWithin(date: ISODate, from: ISODate, to: ISODate): boolean {
  return date >= from && date <= to
}

export function rangesOverlap(aFrom: ISODate, aTo: ISODate, bFrom: ISODate, bTo: ISODate): boolean {
  return aFrom <= bTo && bFrom <= aTo
}

/** Every day from `from` to `to` inclusive. Empty when the range is inverted. */
export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  if (to < from) return []
  const out: ISODate[] = []
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) out.push(cursor)
  return out
}

export function countDays(from: ISODate, to: ISODate): number {
  return to < from ? 0 : diffDays(from, to) + 1
}

/* ------------------------------------------------------------ period boundaries */

/** `weekStartDay` is 0 = Sunday … 6 = Saturday; the workspace default is 1 (Monday). */
export function startOfWeek(date: ISODate, weekStartDay = 1): ISODate {
  const shift = (dayOfWeek(date) - weekStartDay + 7) % 7
  return addDays(date, -shift)
}
export function endOfWeek(date: ISODate, weekStartDay = 1): ISODate {
  return addDays(startOfWeek(date, weekStartDay), 6)
}
export function startOfMonth(date: ISODate): ISODate {
  return `${date.slice(0, 7)}-01`
}
export function endOfMonth(date: ISODate): ISODate {
  const [y, m] = date.split('-').map(Number) as [number, number]
  return toISO(Date.UTC(y, m, 0))
}
export function startOfQuarter(date: ISODate): ISODate {
  const [y, m] = date.split('-').map(Number) as [number, number]
  const firstMonth = Math.floor((m - 1) / 3) * 3 + 1
  return `${y}-${String(firstMonth).padStart(2, '0')}-01`
}
export function endOfQuarter(date: ISODate): ISODate {
  return endOfMonth(addMonths(startOfQuarter(date), 2))
}
export function startOfYear(date: ISODate): ISODate {
  return `${date.slice(0, 4)}-01-01`
}
export function endOfYear(date: ISODate): ISODate {
  return `${date.slice(0, 4)}-12-31`
}

export function quarterOf(date: ISODate): number {
  const m = Number(date.slice(5, 7))
  return Math.floor((m - 1) / 3) + 1
}

/* ------------------------------------------------------------ ready-made ranges */

export const RANGE_PRESETS = [
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
  'last_30_days',
] as const
export type RangePreset = (typeof RANGE_PRESETS)[number]

export type DateRange = { from: ISODate; to: ISODate }

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  this_week: 'This week',
  last_week: 'Last week',
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  last_quarter: 'Last quarter',
  this_year: 'This year',
  last_year: 'Last year',
  last_30_days: 'Last 30 days',
}

export function presetRange(preset: RangePreset, ref: ISODate, weekStartDay = 1): DateRange {
  switch (preset) {
    case 'this_week':
      return { from: startOfWeek(ref, weekStartDay), to: endOfWeek(ref, weekStartDay) }
    case 'last_week': {
      const prev = addDays(startOfWeek(ref, weekStartDay), -7)
      return { from: prev, to: addDays(prev, 6) }
    }
    case 'this_month':
      return { from: startOfMonth(ref), to: endOfMonth(ref) }
    case 'last_month': {
      const prev = addMonths(startOfMonth(ref), -1)
      return { from: startOfMonth(prev), to: endOfMonth(prev) }
    }
    case 'this_quarter':
      return { from: startOfQuarter(ref), to: endOfQuarter(ref) }
    case 'last_quarter': {
      const prev = addMonths(startOfQuarter(ref), -3)
      return { from: startOfQuarter(prev), to: endOfQuarter(prev) }
    }
    case 'this_year':
      return { from: startOfYear(ref), to: endOfYear(ref) }
    case 'last_year': {
      const prev = `${Number(ref.slice(0, 4)) - 1}-06-15`
      return { from: startOfYear(prev), to: endOfYear(prev) }
    }
    case 'last_30_days':
      return { from: addDays(ref, -29), to: ref }
  }
}

/** The planner's four zoom levels. */
export type TimelineScale = 'week' | 'month' | 'quarter' | 'year'

export function timelineRange(scale: TimelineScale, ref: ISODate, weekStartDay = 1): DateRange {
  switch (scale) {
    case 'week':
      return { from: startOfWeek(ref, weekStartDay), to: endOfWeek(ref, weekStartDay) }
    case 'month':
      return { from: startOfMonth(ref), to: endOfMonth(ref) }
    case 'quarter':
      return { from: startOfQuarter(ref), to: endOfQuarter(ref) }
    case 'year':
      return { from: startOfYear(ref), to: endOfYear(ref) }
  }
}

export function shiftTimeline(scale: TimelineScale, ref: ISODate, direction: -1 | 1): ISODate {
  switch (scale) {
    case 'week':
      return addDays(ref, 7 * direction)
    case 'month':
      return addMonths(ref, direction)
    case 'quarter':
      return addMonths(ref, 3 * direction)
    case 'year':
      return addMonths(ref, 12 * direction)
  }
}
