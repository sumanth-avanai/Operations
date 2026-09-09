/**
 * Billable utilization: billable logged minutes over AVAILABLE minutes for the same
 * range. Never a fixed weekly divisor, and never narrowed by a numerator filter —
 * that asymmetry is the point, and the report says so out loud.
 */
import { percentOf } from './money'

export type UtilizationBand = 'unknown' | 'idle' | 'under' | 'on_target' | 'over'

export type Utilization = {
  billableMinutes: number
  loggedMinutes: number
  availableMinutes: number
  /** null when there is no availability to divide by — unknown, not zero. */
  pct: number | null
  /** Share of logged time that is billable, null when nothing was logged. */
  billablePct: number | null
  targetPct: number | null
  /** pct - targetPct, null when either is unknown. */
  variancePct: number | null
  band: UtilizationBand
}

/** ±5 points around the target still counts as on target. */
export const TARGET_TOLERANCE_PCT = 5

export function utilization(input: {
  billableMinutes: number
  loggedMinutes: number
  availableMinutes: number
  targetPct: number | null
}): Utilization {
  const { billableMinutes, loggedMinutes, availableMinutes, targetPct } = input
  const pct = percentOf(billableMinutes, availableMinutes)
  const billablePct = percentOf(billableMinutes, loggedMinutes)
  const variancePct = pct === null || targetPct === null ? null : pct - targetPct
  return {
    billableMinutes,
    loggedMinutes,
    availableMinutes,
    pct,
    billablePct,
    targetPct,
    variancePct,
    band: utilizationBand(pct, targetPct),
  }
}

export function utilizationBand(pct: number | null, targetPct: number | null): UtilizationBand {
  if (pct === null) return 'unknown'
  if (pct === 0) return 'idle'
  if (pct > 100) return 'over'
  if (targetPct === null) return 'on_target'
  if (pct >= targetPct - TARGET_TOLERANCE_PCT) return 'on_target'
  return 'under'
}

/** Design tokens, so every panel colours utilization identically. */
export const UTILIZATION_BAND_STYLE: Record<
  UtilizationBand,
  { color: string; soft: string; label: string }
> = {
  unknown: { color: 'var(--idle)', soft: 'var(--idle-soft)', label: 'No availability' },
  idle: { color: 'var(--idle)', soft: 'var(--idle-soft)', label: 'Nothing logged' },
  under: { color: 'var(--warn)', soft: 'var(--warn-soft)', label: 'Below target' },
  on_target: { color: 'var(--ok)', soft: 'var(--ok-soft)', label: 'On target' },
  over: { color: 'var(--danger)', soft: 'var(--danger-soft)', label: 'Over capacity' },
}

/** How full a day or week is against availability — the planner's heat scale. */
export type LoadBand = 'empty' | 'light' | 'healthy' | 'full' | 'over'

export function loadBand(bookedMinutes: number, availableMinutes: number): LoadBand {
  if (availableMinutes <= 0) return bookedMinutes > 0 ? 'over' : 'empty'
  if (bookedMinutes <= 0) return 'empty'
  const ratio = bookedMinutes / availableMinutes
  if (ratio > 1.001) return 'over'
  if (ratio >= 0.95) return 'full'
  if (ratio >= 0.5) return 'healthy'
  return 'light'
}

export const LOAD_BAND_STYLE: Record<LoadBand, { bg: string; fg: string; label: string }> = {
  empty: { bg: 'transparent', fg: 'var(--muted-foreground)', label: 'Free' },
  light: { bg: 'var(--info-soft)', fg: 'var(--info)', label: 'Lightly booked' },
  healthy: { bg: 'var(--ok-soft)', fg: 'var(--ok)', label: 'Well booked' },
  full: { bg: 'var(--warn-soft)', fg: 'var(--warn)', label: 'At capacity' },
  over: { bg: 'var(--danger-soft)', fg: 'var(--danger)', label: 'Over capacity' },
}
