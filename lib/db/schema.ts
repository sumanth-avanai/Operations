/**
 * Drizzle schema for the Agency Operations Platform.
 *
 * Two rules run through every table (see specs/.../research.md D5, D6):
 *   - every duration is an integer count of MINUTES
 *   - every amount of money is an integer count of CENTS
 * There is no `numeric` column and no float anywhere, so all arithmetic in the
 * domain layer is exact integer arithmetic.
 *
 * Dates a human picks are `date` columns handled as 'YYYY-MM-DD' strings. Only
 * genuine event timestamps use `timestamptz`.
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import {
  BILLING_METHODS,
  BOOKING_STATUSES,
  ENTRY_SOURCES,
  LEAVE_PORTIONS,
  LEAVE_TYPES,
  MEMBER_ROLES,
  NOTIFICATION_KINDS,
  PROJECT_STATUSES,
  RISK_LEVELS,
  type WorkingMinutes,
} from '../domain/types'

/* ------------------------------------------------------------------ enums */

export const memberRoleEnum = pgEnum('member_role', MEMBER_ROLES)

export const projectStatusEnum = pgEnum('project_status', PROJECT_STATUSES)
export const riskLevelEnum = pgEnum('risk_level', RISK_LEVELS)
export const billingMethodEnum = pgEnum('billing_method', BILLING_METHODS)
export const bookingStatusEnum = pgEnum('booking_status', BOOKING_STATUSES)
export const leaveTypeEnum = pgEnum('leave_type', LEAVE_TYPES)
export const leavePortionEnum = pgEnum('leave_portion', LEAVE_PORTIONS)
export const entrySourceEnum = pgEnum('entry_source', ENTRY_SOURCES)
export const notificationKindEnum = pgEnum('notification_kind', NOTIFICATION_KINDS)

/* ------------------------------------------------------------------ shared column types */

/** Re-exported so data-layer consumers need only one import. */
export type { WorkingMinutes }

const createdAt = timestamp('created_at', { withTimezone: true, mode: 'string' })
  .notNull()
  .defaultNow()

/**
 * Money is `bigint` read as a JS number, not `integer`.
 *
 * `integer` caps a single value at 2,147,483,647 cents — 21.47M in the workspace
 * currency — which a mid-sized agency's yearly invoiced total would pass. `bigint`
 * removes that ceiling, and MAX_RATE_CENTS below keeps every product and sum far inside
 * Number.MAX_SAFE_INTEGER so the JS side stays exact:
 *   1440 minutes x 100,000,000 cents = 1.44e11, and 2^53 is 9.0e15.
 */
const cents = (name: string) => bigint(name, { mode: 'number' })

/** 1,000,000.00 per hour. Far above any real rate, far below anything unsafe. */
export const MAX_RATE_CENTS = 100_000_000
/** 10,000,000,000.00 — a bound, not a business rule. */
export const MAX_BUDGET_CENTS = 1_000_000_000_000

/* ------------------------------------------------------------------ workspace */

export const workspaceSettings = pgTable(
  'workspace_settings',
  {
    id: text('id').primaryKey(),
    agencyName: text('agency_name').notNull(),
    currency: text('currency').notNull().default('EUR'),
    dateFormat: text('date_format').notNull().default('dd/MM/yyyy'),
    weekStartDay: integer('week_start_day').notNull().default(1),
    /**
     * Which calendar the workspace calls today.
     *
     * An IANA zone, e.g. 'Europe/Berlin'. Without it the current day would be the
     * *server's* day: a Vercel deployment runs in UTC, so an agency east of it would
     * see tomorrow's date all evening and one west of it would see yesterday's all
     * morning — and a timesheet, a slipped-work list and an aging report are all
     * answers to "as of today". 'UTC' is the migration default rather than a guess at
     * the agency's zone; Settings is where it gets set.
     */
    timeZone: text('time_zone').notNull().default('UTC'),
    defaultRateCents: cents('default_rate_cents').notNull().default(12000),
    defaultBillingMethod: billingMethodEnum('default_billing_method').notNull().default('time_and_materials'),
    defaultBillable: boolean('default_billable').notNull().default(true),
    passwordHash: text('password_hash').notNull(),
    passwordSalt: text('password_salt').notNull(),
    /**
     * The front door is throttled like the portal PIN is.
     *
     * One shared password admits every internal role, so an unthrottled unlock screen
     * is a path to the entire workspace no matter how carefully the panels are scoped.
     */
    unlockFailedCount: integer('unlock_failed_count').notNull().default(0),
    unlockLockedUntil: timestamp('unlock_locked_until', { withTimezone: true, mode: 'string' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => [
    // Single-tenant for this version: the table holds exactly one row.
    check('workspace_settings_singleton', sql`${t.id} = 'default'`),
    check('workspace_week_start_valid', sql`${t.weekStartDay} between 0 and 6`),
    // Postgres cannot check an IANA name; the action validates it against Intl before
    // it is written, and today() falls back to the host calendar if one slips through.
    check('workspace_time_zone_present', sql`length(${t.timeZone}) between 1 and 64`),
    check('workspace_default_rate_range', sql`${t.defaultRateCents} between 0 and ${sql.raw(String(MAX_RATE_CENTS))}`),
  ],
)

/* ------------------------------------------------------------------ calendars */

export const holidayCalendars = pgTable('holiday_calendars', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  regionCode: text('region_code'),
  createdAt,
})

export const holidays = pgTable(
  'holidays',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => holidayCalendars.id, { onDelete: 'cascade' }),
    holidayDate: date('holiday_date', { mode: 'string' }).notNull(),
    name: text('name').notNull(),
  },
  (t) => [
    unique('holidays_calendar_date_unique').on(t.calendarId, t.holidayDate),
    index('holidays_calendar_date_idx').on(t.calendarId, t.holidayDate),
  ],
)

/* ------------------------------------------------------------------ people */

export const members = pgTable(
  'members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    role: memberRoleEnum('role').notNull().default('logger'),
    /** Weekly capacity is derived from this, never stored separately. */
    workingMinutes: jsonb('working_minutes').$type<WorkingMinutes>().notNull(),
    contractStart: date('contract_start', { mode: 'string' }).notNull(),
    contractEnd: date('contract_end', { mode: 'string' }),
    utilizationTargetPct: integer('utilization_target_pct'),
    holidayCalendarId: uuid('holiday_calendar_id').references(() => holidayCalendars.id, {
      onDelete: 'set null',
    }),
    portalToken: text('portal_token').notNull(),
    pinHash: text('pin_hash'),
    pinSalt: text('pin_salt'),
    portalRevoked: boolean('portal_revoked').notNull().default(false),
    pinFailedCount: integer('pin_failed_count').notNull().default(0),
    pinLockedUntil: timestamp('pin_locked_until', { withTimezone: true, mode: 'string' }),
    color: text('color').notNull().default('var(--hue-1)'),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),
    createdAt,
  },
  (t) => [
    unique('members_email_unique').on(t.email),
    unique('members_portal_token_unique').on(t.portalToken),
    index('members_archived_idx').on(t.archivedAt),
    check(
      'members_target_range',
      sql`${t.utilizationTargetPct} is null or ${t.utilizationTargetPct} between 0 and 100`,
    ),
    check(
      'members_contract_order',
      sql`${t.contractEnd} is null or ${t.contractEnd} >= ${t.contractStart}`,
    ),
  ],
)

export const leaveRecords = pgTable(
  'leave',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    leaveType: leaveTypeEnum('leave_type').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    /**
     * Whole day or half day. There is no free-form minutes value: one date can hold one
     * leave record (enforced in `upsertLeave`), and that record is all-or-half.
     */
    portion: leavePortionEnum('portion').notNull().default('full'),
    note: text('note'),
    createdAt,
  },
  (t) => [
    index('leave_member_range_idx').on(t.memberId, t.startDate, t.endDate),
    check('leave_range_order', sql`${t.endDate} >= ${t.startDate}`),
  ],
)

/* ------------------------------------------------------------------ work */

export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    color: text('color').notNull().default('var(--hue-2)'),
    contactEmail: text('contact_email'),
    notes: text('notes'),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),
    createdAt,
  },
  (t) => [unique('clients_name_unique').on(t.name)],
)

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    code: text('code'),
    color: text('color').notNull().default('var(--hue-3)'),
    /** The single source for whether work on this project bills. */
    billable: boolean('billable').notNull().default(true),
    billingMethod: billingMethodEnum('billing_method').notNull().default('time_and_materials'),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    /** Project Manager scoping: who owns this engagement. */
    ownerMemberId: uuid('owner_member_id').references(() => members.id, { onDelete: 'set null' }),
    notes: text('notes'),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),
    createdAt,
    // No budget column: a project's budget is the sum of its roles' budgets.
    // No status/risk/satisfaction: current health is the newest health update.
  },
  (t) => [
    unique('projects_code_unique').on(t.code),
    index('projects_client_idx').on(t.clientId),
    index('projects_archived_idx').on(t.archivedAt),
    check('projects_date_order', sql`${t.endDate} is null or ${t.startDate} is null or ${t.endDate} >= ${t.startDate}`),
  ],
)

export const projectRoles = pgTable(
  'project_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Hourly rate in cents. The only place a price lives. */
    rateCents: cents('rate_cents').notNull(),
    budgetCents: cents('budget_cents').notNull().default(0),
    budgetMinutes: integer('budget_minutes'),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),
    createdAt,
  },
  (t) => [
    unique('project_roles_name_unique').on(t.projectId, t.name),
    index('project_roles_project_idx').on(t.projectId),
    // Bounded so `minutes x rate_cents` and every sum of it stay exact in JS.
    check(
      'project_roles_rate_range',
      sql`${t.rateCents} between 0 and ${sql.raw(String(MAX_RATE_CENTS))}`,
    ),
    check(
      'project_roles_budget_range',
      sql`${t.budgetCents} between 0 and ${sql.raw(String(MAX_BUDGET_CENTS))}`,
    ),
    check(
      'project_roles_budget_minutes_range',
      sql`${t.budgetMinutes} is null or ${t.budgetMinutes} between 0 and 10000000`,
    ),
  ],
)

export const roleAssignments = pgTable(
  'role_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectRoleId: uuid('project_role_id')
      .notNull()
      .references(() => projectRoles.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    createdAt,
  },
  (t) => [
    unique('role_assignments_unique').on(t.projectRoleId, t.memberId),
    index('role_assignments_member_idx').on(t.memberId),
  ],
)

/* ------------------------------------------------------------------ billing */

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reference: text('reference').notNull(),
    issuedDate: date('issued_date', { mode: 'string' }).notNull(),
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    periodEnd: date('period_end', { mode: 'string' }).notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    /** Frozen at creation from the entries it billed; those entries then become immutable. */
    amountCents: cents('amount_cents').notNull(),
    note: text('note'),
    createdAt,
  },
  (t) => [
    unique('invoices_reference_unique').on(t.reference),
    index('invoices_project_idx').on(t.projectId),
    check('invoices_period_order', sql`${t.periodEnd} >= ${t.periodStart}`),
    check('invoices_amount_nonneg', sql`${t.amountCents} >= 0`),
  ],
)

/* ------------------------------------------------------------------ time — the single source of truth */

export const timeEntries = pgTable(
  'time_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    projectRoleId: uuid('project_role_id')
      .notNull()
      .references(() => projectRoles.id, { onDelete: 'restrict' }),
    entryDate: date('entry_date', { mode: 'string' }).notNull(),
    minutes: integer('minutes').notNull(),
    note: text('note'),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
    /** Frozen price at the moment of invoicing; null while unbilled. */
    invoicedAmountCents: cents('invoiced_amount_cents'),
    source: entrySourceEnum('source').notNull().default('internal'),
    createdAt,
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    // No `billable` column: billability is projects.billable read at query time.
    // No amount while unbilled: it is minutes x project_roles.rate_cents / 60.
  },
  (t) => [
    unique('time_entries_cell_unique').on(t.memberId, t.projectRoleId, t.entryDate),
    index('time_entries_member_date_idx').on(t.memberId, t.entryDate),
    index('time_entries_role_date_idx').on(t.projectRoleId, t.entryDate),
    index('time_entries_date_idx').on(t.entryDate),
    index('time_entries_invoice_idx').on(t.invoiceId),
    check('time_entries_minutes_positive', sql`${t.minutes} > 0`),
    check('time_entries_minutes_max', sql`${t.minutes} <= 1440`),
    check(
      'time_entries_invoiced_amount_pairs',
      sql`(${t.invoiceId} is null) = (${t.invoicedAmountCents} is null)`,
    ),
    check(
      'time_entries_invoiced_amount_nonneg',
      sql`${t.invoicedAmountCents} is null or ${t.invoicedAmountCents} >= 0`,
    ),
  ],
)

/* ------------------------------------------------------------------ planning */

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    projectRoleId: uuid('project_role_id')
      .notNull()
      .references(() => projectRoles.id, { onDelete: 'cascade' }),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    minutesPerDay: integer('minutes_per_day').notNull(),
    status: bookingStatusEnum('status').notNull().default('confirmed'),
    note: text('note'),
    createdByMemberId: uuid('created_by_member_id').references(() => members.id, {
      onDelete: 'set null',
    }),
    createdAt,
  },
  (t) => [
    index('bookings_member_range_idx').on(t.memberId, t.startDate, t.endDate),
    index('bookings_role_idx').on(t.projectRoleId),
    check('bookings_range_order', sql`${t.endDate} >= ${t.startDate}`),
    check('bookings_minutes_sane', sql`${t.minutesPerDay} > 0 and ${t.minutesPerDay} <= 1440`),
  ],
)

/* ------------------------------------------------------------------ health, views, notifications */

export const projectHealthUpdates = pgTable(
  'project_health_updates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    updateDate: date('update_date', { mode: 'string' }).notNull(),
    status: projectStatusEnum('status').notNull(),
    risk: riskLevelEnum('risk').notNull(),
    satisfaction: integer('satisfaction'),
    comment: text('comment'),
    authorMemberId: uuid('author_member_id').references(() => members.id, { onDelete: 'set null' }),
    createdAt,
  },
  (t) => [
    index('project_health_project_idx').on(t.projectId, t.updateDate),
    check(
      'project_health_satisfaction_range',
      sql`${t.satisfaction} is null or ${t.satisfaction} between 1 and 5`,
    ),
  ],
)

export const savedViews = pgTable(
  'saved_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    panel: text('panel').notNull(),
    config: jsonb('config').$type<Record<string, string>>().notNull(),
    ownerMemberId: uuid('owner_member_id').references(() => members.id, { onDelete: 'cascade' }),
    createdAt,
  },
  (t) => [unique('saved_views_panel_name_unique').on(t.panel, t.name)],
)

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    kind: notificationKindEnum('kind').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'string' }),
    createdAt,
  },
  (t) => [index('notifications_member_idx').on(t.memberId, t.readAt, t.createdAt)],
)

/* ------------------------------------------------------------------ inferred types */

export type Member = typeof members.$inferSelect
export type NewMember = typeof members.$inferInsert

/**
 * A member with their credentials removed.
 *
 * `pinHash`, `pinSalt` and `portalToken` are secrets. Nothing that a page holds — and
 * therefore nothing that could be handed to a client component — is typed as the full
 * `Member`. The query layer converts on the way out, and the portal token is returned
 * as its own clearly-named field that a page must deliberately pass on.
 */
export type PublicMember = Omit<Member, 'pinHash' | 'pinSalt' | 'portalToken'>

export function toPublicMember(member: Member): PublicMember {
  const { pinHash: _hash, pinSalt: _salt, portalToken: _token, ...rest } = member
  return rest
}
export type Client = typeof clients.$inferSelect
export type Project = typeof projects.$inferSelect
export type ProjectRole = typeof projectRoles.$inferSelect
export type TimeEntry = typeof timeEntries.$inferSelect
export type Booking = typeof bookings.$inferSelect
export type LeaveRecord = typeof leaveRecords.$inferSelect
export type Holiday = typeof holidays.$inferSelect
export type HolidayCalendar = typeof holidayCalendars.$inferSelect
export type Invoice = typeof invoices.$inferSelect
export type ProjectHealthUpdate = typeof projectHealthUpdates.$inferSelect
export type Notification = typeof notifications.$inferSelect
export type SavedView = typeof savedViews.$inferSelect
export type WorkspaceSettings = typeof workspaceSettings.$inferSelect

export type MemberRole = (typeof memberRoleEnum.enumValues)[number]
export type ProjectStatus = (typeof projectStatusEnum.enumValues)[number]
export type RiskLevel = (typeof riskLevelEnum.enumValues)[number]
export type BillingMethod = (typeof billingMethodEnum.enumValues)[number]
export type BookingStatus = (typeof bookingStatusEnum.enumValues)[number]
export type LeaveType = (typeof leaveTypeEnum.enumValues)[number]
export type EntrySource = (typeof entrySourceEnum.enumValues)[number]
export type NotificationKind = (typeof notificationKindEnum.enumValues)[number]
