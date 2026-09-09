/**
 * Money in integer cents, durations in integer minutes, and the parsing and
 * formatting that keeps them that way at the edges. No floats survive a round trip.
 */

/** hours x rate, as exact integer cents. The only place time becomes money. */
export function amountCents(minutes: number, rateCents: number): number {
  if (!Number.isFinite(minutes) || !Number.isFinite(rateCents)) return 0
  // Half-up on .5 so a rate of 1 cent/hour never silently rounds to nothing.
  return Math.round((minutes * rateCents) / 60)
}

export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100
}

export function hoursToMinutes(hours: number): number {
  return Math.round(hours * 60)
}

/** '7.5' by default, '7:30' when asked. Zero renders as an em dash for dense grids. */
export function formatHours(
  minutes: number,
  opts: { style?: 'decimal' | 'clock'; zero?: string } = {},
): string {
  const { style = 'decimal', zero = '—' } = opts
  if (!minutes) return zero
  const sign = minutes < 0 ? '-' : ''
  const abs = Math.abs(minutes)
  if (style === 'clock') {
    return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`
  }
  const hours = abs / 60
  const rounded = Math.round(hours * 100) / 100
  return `${sign}${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2).replace(/0$/, '')}`
}

/**
 * Accepts what people actually type into a timesheet: `7`, `7.5`, `7,5`, `7:30`,
 * `7h30`, `7h`, `90m`, `:30`. Returns minutes, or null when it is not a duration.
 * An empty string is a deliberate zero — it clears the cell.
 */
export function parseHoursInput(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '')
  if (s === '') return 0
  if (/^\d+m$/.test(s)) return Number(s.slice(0, -1))
  const clock = /^(\d*)[:h](\d{1,2})m?$/.exec(s)
  if (clock) {
    const mins = Number(clock[2])
    if (mins > 59) return null
    return Number(clock[1] || 0) * 60 + mins
  }
  if (/^\d+h$/.test(s)) return Number(s.slice(0, -1)) * 60
  const decimal = /^\d*[.,]?\d*$/.exec(s)
  if (decimal && s !== '.' && s !== ',') {
    const value = Number(s.replace(',', '.'))
    if (!Number.isFinite(value)) return null
    return Math.round(value * 60)
  }
  return null
}

export function formatMoney(
  cents: number,
  currency: string,
  opts: { locale?: string; compact?: boolean; withCents?: boolean } = {},
): string {
  const { locale = 'en-GB', compact = false, withCents } = opts
  const showCents = withCents ?? (!compact && Math.abs(cents) < 100_000)
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: showCents ? 2 : 0,
      minimumFractionDigits: showCents ? 2 : 0,
    }).format(cents / 100)
  } catch {
    return `${currency} ${(cents / 100).toFixed(showCents ? 2 : 0)}`
  }
}

/** '1.234,50', '1,234.50', '€1234.5' → cents. Null when it is not a number. */
export function parseMoneyInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/[^\d.,-]/g, '')
  if (cleaned === '') return null
  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')
  let normalized: string
  if (lastComma > lastDot) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.')
  } else if (lastDot > lastComma) {
    normalized = cleaned.replace(/,/g, '')
  } else {
    normalized = cleaned.replace(/[.,]/g, '')
  }
  const value = Number(normalized)
  if (!Number.isFinite(value)) return null
  return Math.round(value * 100)
}

/** Percentage as a whole number, or null when the denominator carries no information. */
export function percentOf(part: number, whole: number): number | null {
  if (!whole) return null
  return Math.round((part / whole) * 100)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
