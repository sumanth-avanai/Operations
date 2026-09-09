/**
 * The vocabulary of the product, owned by the domain layer.
 *
 * The database schema imports these tuples for its enums, so the words that appear
 * in a Postgres type and the words the calculation core reasons about can never
 * drift apart. Nothing in this file imports anything.
 */

/** A calendar date as 'YYYY-MM-DD'. Never an instant, never timezone-shifted. */
export type ISODate = string

export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number]

/** Minutes of work for each weekday — a member's whole capacity definition. */
export type WorkingMinutes = Record<WeekdayKey, number>

export const MEMBER_ROLES = [
  'owner_admin',
  'operations_lead',
  'resource_manager',
  'project_manager',
  'finance',
  'logger',
] as const

export const PROJECT_STATUSES = ['on_track', 'at_risk', 'on_hold', 'done'] as const
export const RISK_LEVELS = ['low', 'medium', 'high'] as const
export const BILLING_METHODS = ['time_and_materials', 'fixed_fee', 'retainer'] as const
export const BOOKING_STATUSES = ['tentative', 'confirmed'] as const
export const LEAVE_TYPES = ['vacation', 'sick', 'unpaid', 'other'] as const
/**
 * How much of a working day a leave record absorbs. A day is whole or half — there is
 * no free-form minutes value, because two part-days of arbitrary length on one date
 * produced a day that was neither worked nor absent.
 */
export const LEAVE_PORTIONS = ['full', 'half'] as const
export const ENTRY_SOURCES = ['internal', 'portal'] as const
export const NOTIFICATION_KINDS = ['booked', 'onboarded', 'over_commitment', 'slipped_work'] as const

export type MemberRoleName = (typeof MEMBER_ROLES)[number]
export type ProjectStatusName = (typeof PROJECT_STATUSES)[number]
export type RiskLevelName = (typeof RISK_LEVELS)[number]
export type BillingMethodName = (typeof BILLING_METHODS)[number]
export type BookingStatusName = (typeof BOOKING_STATUSES)[number]
export type LeaveTypeName = (typeof LEAVE_TYPES)[number]
export type LeavePortion = (typeof LEAVE_PORTIONS)[number]
export type EntrySourceName = (typeof ENTRY_SOURCES)[number]
export type NotificationKindName = (typeof NOTIFICATION_KINDS)[number]

export const LEAVE_PORTION_LABELS: Record<LeavePortion, string> = {
  full: 'Full day',
  half: 'Half day',
}

export const LEAVE_TYPE_LABELS: Record<LeaveTypeName, string> = {
  vacation: 'Vacation',
  sick: 'Sick',
  unpaid: 'Unpaid',
  other: 'Other',
}

export const PROJECT_STATUS_LABELS: Record<ProjectStatusName, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  on_hold: 'On hold',
  done: 'Done',
}

export const RISK_LABELS: Record<RiskLevelName, string> = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
}

export const BILLING_METHOD_LABELS: Record<BillingMethodName, string> = {
  time_and_materials: 'Time & materials',
  fixed_fee: 'Fixed fee',
  retainer: 'Retainer',
}

export const MEMBER_ROLE_LABELS: Record<MemberRoleName, string> = {
  owner_admin: 'Owner / Admin',
  operations_lead: 'Operations Lead',
  resource_manager: 'Resource Manager',
  project_manager: 'Project Manager',
  finance: 'Finance / Billing',
  logger: 'Employee / Consultant',
}
