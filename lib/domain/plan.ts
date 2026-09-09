/**
 * Splitting a plan against what was actually delivered.
 *
 * Two rules live here, and nothing else in the product is allowed to restate them.
 *
 * 1. Delivered work supersedes the plan MINUTE FOR MINUTE, not day for day. Logging one
 *    minute against an eight-hour booked day leaves 7h59m still owed. A yes/no test
 *    ("did they log anything?") releases a whole day for a token entry in one direction
 *    and holds a whole day forever in the other.
 *
 * 2. The plan is laid out per member+role+day BEFORE anything is subtracted. Two
 *    bookings covering the same person, role and day are one commitment of their sum,
 *    so that day's logged minutes are subtracted once. Netting each booking separately
 *    would let eight logged hours cancel two eight-hour bookings.
 *
 * The cell key carries the member, which is why one person's overtime can never cancel
 * another person's plan even when both are booked on the same role and day.
 */
import type { ISODate } from './types'

/**
 * One member's plan for one role on one day, with what they logged against it.
 *
 * The caller MUST supply at most one cell per member+role+day — that grouping is the
 * whole point of rule 2 above. `key` is whatever the caller wants totals grouped by
 * (a role id, in practice); the split itself does not care.
 */
export type PlanCell = {
  key: string
  date: ISODate
  /** Confirmed booked minutes on this day, already capped by real availability. */
  confirmedMinutes: number
  /** Tentative booked minutes on this day, already capped by real availability. */
  tentativeMinutes: number
  /** Minutes this member logged against this role on this day. */
  loggedMinutes: number
}

export type PlanSplit = {
  /** Confirmed shortfall on days from `asOf` onward. A live commitment: it is spend. */
  committedMinutes: number
  /**
   * Confirmed shortfall on days before `asOf`. The day is gone, so this is flagged for
   * re-planning or write-off and never touches remaining budget again. Without this
   * split a booking nobody logged against consumes its budget forever.
   */
  staleMinutes: number
  /** Tentative shortfall from `asOf` onward. Tentative plan whose day has passed is not pipeline. */
  tentativeMinutes: number
}

export const EMPTY_SPLIT: PlanSplit = {
  committedMinutes: 0,
  staleMinutes: 0,
  tentativeMinutes: 0,
}

/**
 * Split a single cell. Confirmed plan absorbs the day's delivery first, because it is
 * the real commitment; only what is left over can supersede tentative plan.
 */
export function splitCell(cell: PlanCell, asOf: ISODate): PlanSplit {
  const confirmedShortfall = Math.max(cell.confirmedMinutes - cell.loggedMinutes, 0)
  const spareDelivery = Math.max(cell.loggedMinutes - cell.confirmedMinutes, 0)
  const tentativeShortfall = Math.max(cell.tentativeMinutes - spareDelivery, 0)

  if (cell.date >= asOf) {
    return {
      committedMinutes: confirmedShortfall,
      staleMinutes: 0,
      tentativeMinutes: tentativeShortfall,
    }
  }
  return {
    committedMinutes: 0,
    staleMinutes: confirmedShortfall,
    tentativeMinutes: 0,
  }
}

/** Totals per `key`. Keys with nothing owed are omitted, so an empty map means a clean plan. */
export function splitPlan(cells: Iterable<PlanCell>, asOf: ISODate): Map<string, PlanSplit> {
  const out = new Map<string, PlanSplit>()
  for (const cell of cells) {
    const split = splitCell(cell, asOf)
    if (split.committedMinutes === 0 && split.staleMinutes === 0 && split.tentativeMinutes === 0) {
      continue
    }
    const running = out.get(cell.key)
    if (running) {
      running.committedMinutes += split.committedMinutes
      running.staleMinutes += split.staleMinutes
      running.tentativeMinutes += split.tentativeMinutes
    } else {
      out.set(cell.key, { ...split })
    }
  }
  return out
}
