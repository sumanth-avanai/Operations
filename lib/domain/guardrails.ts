/**
 * Guardrails warn; integrity rules block (constitution VII).
 *
 * Everything in this file is a WARNING: the write proceeds and the user is told. The
 * blocking rules live in the actions, because they need the database to know whether a
 * day is locked or an entry is invoiced. Every message names the offending date,
 * amount, or record — no generic text ever reaches a user.
 */
import { formatHours, formatMoney } from './money'
import type { ISODate } from './types'

export type WarningCode =
  | 'over_capacity'
  | 'over_commitment'
  | 'slipped_work'
  | 'non_billable_project'
  | 'holiday_conflict'
  | 'rate_change'

export type Warning = {
  code: WarningCode
  message: string
  date?: ISODate
}

/** Logged or booked beyond what the day actually holds. */
export function overCapacityWarning(input: {
  date: ISODate
  usedMinutes: number
  availableMinutes: number
  dateLabel?: string
}): Warning | null {
  if (input.usedMinutes <= input.availableMinutes) return null
  const over = input.usedMinutes - input.availableMinutes
  const label = input.dateLabel ?? input.date
  return {
    code: 'over_capacity',
    date: input.date,
    message:
      input.availableMinutes === 0
        ? `${label}: ${formatHours(input.usedMinutes)}h on a day with no capacity.`
        : `${label}: ${formatHours(input.usedMinutes)}h against ${formatHours(
            input.availableMinutes,
          )}h of capacity — ${formatHours(over)}h over.`,
  }
}

/** A booking that would push a role's committed spend past its remaining budget. */
export function overCommitmentWarning(input: {
  roleName: string
  projectName: string
  proposalCents: number
  remainingCents: number
  currency: string
}): Warning | null {
  if (input.proposalCents <= input.remainingCents) return null
  const over = input.proposalCents - input.remainingCents
  const remaining = input.remainingCents <= 0 ? 'nothing' : formatMoney(input.remainingCents, input.currency)
  return {
    code: 'over_commitment',
    message: `${input.projectName} · ${input.roleName}: this booking is worth ${formatMoney(
      input.proposalCents,
      input.currency,
    )} but only ${remaining} of budget remains — ${formatMoney(over, input.currency)} over.`,
  }
}

/** Confirmed work whose date has passed without being delivered. */
export function slippedWorkWarning(input: {
  memberName: string
  projectName: string
  endDate: ISODate
  bookedMinutes: number
  loggedMinutes: number
}): Warning | null {
  const shortfall = input.bookedMinutes - input.loggedMinutes
  if (shortfall <= 0) return null
  return {
    code: 'slipped_work',
    date: input.endDate,
    message: `${input.memberName} on ${input.projectName}: ${formatHours(
      shortfall,
    )}h of work planned to ${input.endDate} has not been logged.`,
  }
}

export function nonBillableWarning(input: {
  projectName: string
  unbilledCents: number
  currency: string
}): Warning | null {
  if (input.unbilledCents <= 0) return null
  return {
    code: 'non_billable_project',
    message: `${input.projectName} has ${formatMoney(
      input.unbilledCents,
      input.currency,
    )} of unbilled work that will drop out of billing while it is non-billable.`,
  }
}

export function holidayConflictWarning(input: {
  date: ISODate
  holidayName: string
  members: readonly string[]
  minutes: number
}): Warning | null {
  if (input.minutes <= 0) return null
  const who =
    input.members.length <= 3
      ? input.members.join(', ')
      : `${input.members.slice(0, 3).join(', ')} and ${input.members.length - 3} more`
  return {
    code: 'holiday_conflict',
    date: input.date,
    message: `${input.holidayName} on ${input.date} already has ${formatHours(
      input.minutes,
    )}h logged by ${who}. Those hours are kept — review them.`,
  }
}

export function rateChangeWarning(input: {
  roleName: string
  beforeCents: number
  afterCents: number
  currency: string
}): Warning | null {
  const delta = input.afterCents - input.beforeCents
  if (delta === 0) return null
  const direction = delta > 0 ? 'increases' : 'decreases'
  return {
    code: 'rate_change',
    message: `${input.roleName}: the new rate ${direction} unbilled work by ${formatMoney(
      Math.abs(delta),
      input.currency,
    )}. Already-invoiced work is unchanged.`,
  }
}

export function compactWarnings(warnings: readonly (Warning | null)[]): Warning[] {
  return warnings.filter((w): w is Warning => w !== null)
}

/** Collapse a long list of per-day warnings into one line the user will actually read. */
export function summarizeDayWarnings(warnings: readonly Warning[], max = 3): Warning[] {
  const capacity = warnings.filter((w) => w.code === 'over_capacity')
  if (capacity.length <= max) return [...warnings]
  const others = warnings.filter((w) => w.code !== 'over_capacity')
  const dates = capacity.map((w) => w.date).filter(Boolean) as ISODate[]
  return [
    ...others,
    {
      code: 'over_capacity',
      message: `${capacity.length} days are over capacity: ${dates.slice(0, max).join(', ')} and ${
        dates.length - max
      } more.`,
    },
  ]
}
