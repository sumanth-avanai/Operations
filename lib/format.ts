/**
 * Workspace-aware display formatting. Every money and date on screen goes through a
 * formatter built from the workspace settings, so changing currency or date format in
 * Settings changes the whole product (FR-047).
 */
import { format as formatDate, parseISO } from 'date-fns'
import { formatHours, formatMoney, minutesToHours } from '@/lib/domain/money'
import type { ISODate } from '@/lib/domain/types'
import type { WorkspaceSettings } from '@/lib/db/schema'

export type Formatter = {
  currency: string
  money: (cents: number, opts?: { compact?: boolean; withCents?: boolean }) => string
  /** Rounded to the nearest whole unit — for headline figures. */
  moneyShort: (cents: number) => string
  hours: (minutes: number, opts?: { style?: 'decimal' | 'clock'; zero?: string }) => string
  hoursValue: (minutes: number) => number
  date: (date: ISODate) => string
  dateLong: (date: ISODate) => string
  dayShort: (date: ISODate) => string
  weekday: (date: ISODate) => string
  monthYear: (date: ISODate) => string
  range: (from: ISODate, to: ISODate) => string
  percent: (value: number | null) => string
  weekStartDay: number
}

export function makeFormatter(settings: Pick<WorkspaceSettings, 'currency' | 'dateFormat' | 'weekStartDay'>): Formatter {
  const { currency, dateFormat, weekStartDay } = settings
  const safe = (date: ISODate, pattern: string) => {
    try {
      return formatDate(parseISO(date), pattern)
    } catch {
      return date
    }
  }
  return {
    currency,
    weekStartDay,
    money: (cents, opts) => formatMoney(cents, currency, opts),
    moneyShort: (cents) => formatMoney(cents, currency, { withCents: false }),
    hours: (minutes, opts) => formatHours(minutes, opts),
    hoursValue: (minutes) => minutesToHours(minutes),
    date: (date) => safe(date, dateFormat),
    dateLong: (date) => safe(date, 'd MMM yyyy'),
    dayShort: (date) => safe(date, 'd MMM'),
    weekday: (date) => safe(date, 'EEE'),
    monthYear: (date) => safe(date, 'MMMM yyyy'),
    range: (from, to) =>
      from.slice(0, 7) === to.slice(0, 7)
        ? `${safe(from, 'd')} – ${safe(to, 'd MMM yyyy')}`
        : `${safe(from, 'd MMM')} – ${safe(to, 'd MMM yyyy')}`,
    percent: (value) => (value === null ? '—' : `${value}%`),
  }
}
