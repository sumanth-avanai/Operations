/**
 * Resolving a date range from URL search params: a named preset, or an explicit
 * from/to. Shared by Billing, Reports and both export routes so an export can never
 * disagree with the screen it came from.
 */
import { isISODate, presetRange, RANGE_PRESETS, type DateRange, type RangePreset } from '@/lib/domain/dates'
import type { ISODate } from '@/lib/domain/types'

export type ResolvedRange = DateRange & { preset: RangePreset | 'custom' }

export function resolveRange(
  params: { preset?: string; from?: string; to?: string },
  /**
   * `asOf` is what "this month" means. It comes from the request context, never from
   * the clock in here, so a screen and the export route beside it resolve the same
   * preset to the same days even across midnight in the workspace's zone.
   */
  opts: { asOf: ISODate; weekStartDay?: number; fallback?: RangePreset },
): ResolvedRange {
  const { asOf, weekStartDay = 1, fallback = 'this_month' } = opts
  if (params.from && params.to && isISODate(params.from) && isISODate(params.to)) {
    const from = params.from <= params.to ? params.from : params.to
    const to = params.from <= params.to ? params.to : params.from
    return { from, to, preset: 'custom' }
  }
  const preset = (RANGE_PRESETS as readonly string[]).includes(params.preset ?? '')
    ? (params.preset as RangePreset)
    : fallback
  return { ...presetRange(preset, asOf, weekStartDay), preset }
}

/** Turns a resolved range back into the query string an export route needs. */
export function rangeToQuery(range: ResolvedRange, extra: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams()
  if (range.preset === 'custom') {
    params.set('from', range.from)
    params.set('to', range.to)
  } else {
    params.set('preset', range.preset)
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, value)
  }
  return params.toString()
}
