/**
 * Availability — the honest-numbers principle in code.
 *
 * `workingMinutesOn` is the ONE gate every capacity figure passes through: contract
 * dates, then the holiday calendar, then the working-day pattern, then leave. The
 * timesheet's locked days, the planner's effective booked minutes, and the
 * utilization denominator all resolve through it, which is why they cannot disagree.
 */
import { eachDay, isWithin, weekdayKey } from './dates'
import {
  LEAVE_TYPE_LABELS, type ISODate, type LeavePortion, type LeaveTypeName, type WorkingMinutes,
} from './types'

export type CapacityMember = {
  workingMinutes: WorkingMinutes
  contractStart: ISODate
  contractEnd: ISODate | null
}

export type LeaveSpan = {
  leaveType: LeaveTypeName
  startDate: ISODate
  endDate: ISODate
  /**
   * Whole day or half day — the only two states a leave record can hold. Half is half of
   * THAT day's pattern, so a half day on a 4h Wednesday absorbs 2h, not a fixed 4h.
   */
  portion: LeavePortion
}

/** Holiday date → holiday name, so a locked cell can say *which* holiday. */
export type HolidayMap = ReadonlyMap<ISODate, string>

export const NO_HOLIDAYS: HolidayMap = new Map()

export type LockReason =
  | 'before_contract'
  | 'after_contract'
  | 'non_working_day'
  | 'holiday'
  | 'leave'

export type DayAvailability = {
  date: ISODate
  minutes: number
  /** Present when minutes is 0, or when leave partially reduced the day. */
  reason: LockReason | null
  label: string | null
}

export function weeklyCapacityMinutes(working: WorkingMinutes): number {
  return (
    working.mon + working.tue + working.wed + working.thu + working.fri + working.sat + working.sun
  )
}

export function patternMinutesOn(working: WorkingMinutes, date: ISODate): number {
  return working[weekdayKey(date)] ?? 0
}

/**
 * The leave record that governs this date.
 *
 * A member cannot hold two leave records covering the same day — `upsertLeave` refuses
 * it. This still resolves to the MOST absorbing record rather than the first one found,
 * so a hand-inserted or legacy overlap can never leave phantom capacity behind that a
 * booking would then fill: a full day always wins.
 */
function governingLeave(leaves: readonly LeaveSpan[], date: ISODate): LeaveSpan | null {
  let found: LeaveSpan | null = null
  for (const leave of leaves) {
    if (!isWithin(date, leave.startDate, leave.endDate)) continue
    if (leave.portion === 'full') return leave
    found ??= leave
  }
  return found
}

/**
 * Available minutes for one member on one date, with the reason when it is zero.
 * Order matters: a contract boundary outranks a holiday, which outranks the working
 * pattern, which outranks leave — you cannot be on holiday from a job you have left.
 */
export function dayAvailability(
  member: CapacityMember,
  date: ISODate,
  holidays: HolidayMap = NO_HOLIDAYS,
  leaves: readonly LeaveSpan[] = [],
): DayAvailability {
  if (date < member.contractStart) {
    return { date, minutes: 0, reason: 'before_contract', label: 'Before contract start' }
  }
  if (member.contractEnd && date > member.contractEnd) {
    return { date, minutes: 0, reason: 'after_contract', label: 'After contract end' }
  }

  const holidayName = holidays.get(date)
  if (holidayName !== undefined) {
    return { date, minutes: 0, reason: 'holiday', label: holidayName }
  }

  const pattern = patternMinutesOn(member.workingMinutes, date)
  if (pattern <= 0) {
    return { date, minutes: 0, reason: 'non_working_day', label: 'Non-working day' }
  }

  const leave = governingLeave(leaves, date)
  if (leave) {
    const label = LEAVE_TYPE_LABELS[leave.leaveType]
    if (leave.portion === 'full') {
      return { date, minutes: 0, reason: 'leave', label }
    }
    // Half of this day's own pattern, kept in whole minutes.
    const remaining = Math.max(0, pattern - Math.round(pattern / 2))
    return {
      date,
      minutes: remaining,
      reason: 'leave',
      label: remaining === 0 ? label : `${label} (half day)`,
    }
  }

  return { date, minutes: pattern, reason: null, label: null }
}

export function workingMinutesOn(
  member: CapacityMember,
  date: ISODate,
  holidays: HolidayMap = NO_HOLIDAYS,
  leaves: readonly LeaveSpan[] = [],
): number {
  return dayAvailability(member, date, holidays, leaves).minutes
}

/** True when no time may be logged on this date at all. */
export function isDayLocked(
  member: CapacityMember,
  date: ISODate,
  holidays: HolidayMap = NO_HOLIDAYS,
  leaves: readonly LeaveSpan[] = [],
): boolean {
  return dayAvailability(member, date, holidays, leaves).minutes === 0
}

export function availabilityByDay(
  member: CapacityMember,
  from: ISODate,
  to: ISODate,
  holidays: HolidayMap = NO_HOLIDAYS,
  leaves: readonly LeaveSpan[] = [],
): DayAvailability[] {
  return eachDay(from, to).map((date) => dayAvailability(member, date, holidays, leaves))
}

export function availableMinutes(
  member: CapacityMember,
  from: ISODate,
  to: ISODate,
  holidays: HolidayMap = NO_HOLIDAYS,
  leaves: readonly LeaveSpan[] = [],
): number {
  let total = 0
  for (const day of eachDay(from, to)) total += workingMinutesOn(member, day, holidays, leaves)
  return total
}

/**
 * The minutes a booking actually consumes: `minutesPerDay` on each day the member is
 * genuinely available, capped by that day's availability, and zero everywhere else.
 * This is why a booking drawn across a holiday week does not invent work.
 */
export function effectiveBookedMinutes(
  member: CapacityMember,
  booking: { startDate: ISODate; endDate: ISODate; minutesPerDay: number },
  from: ISODate,
  to: ISODate,
  holidays: HolidayMap = NO_HOLIDAYS,
  leaves: readonly LeaveSpan[] = [],
): number {
  const start = booking.startDate > from ? booking.startDate : from
  const end = booking.endDate < to ? booking.endDate : to
  let total = 0
  for (const day of eachDay(start, end)) {
    const capacity = workingMinutesOn(member, day, holidays, leaves)
    if (capacity > 0) total += Math.min(booking.minutesPerDay, capacity)
  }
  return total
}

export function bookedMinutesByDay(
  member: CapacityMember,
  booking: { startDate: ISODate; endDate: ISODate; minutesPerDay: number },
  from: ISODate,
  to: ISODate,
  holidays: HolidayMap = NO_HOLIDAYS,
  leaves: readonly LeaveSpan[] = [],
): Map<ISODate, number> {
  const out = new Map<ISODate, number>()
  const start = booking.startDate > from ? booking.startDate : from
  const end = booking.endDate < to ? booking.endDate : to
  for (const day of eachDay(start, end)) {
    const capacity = workingMinutesOn(member, day, holidays, leaves)
    if (capacity > 0) out.set(day, Math.min(booking.minutesPerDay, capacity))
  }
  return out
}
