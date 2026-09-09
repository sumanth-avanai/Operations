/**
 * THE role matrix (FR-007). Pure data plus two predicates, in one file, so what each
 * role may do is auditable at a glance rather than scattered across route handlers.
 *
 * Nothing here reads a request or a cookie: it answers "may this role do this?" and
 * the callers supply the role. Client-side hiding is presentation; this is protection.
 */
import type { MemberRoleName } from '@/lib/domain/types'

export const CAPABILITIES = [
  /** Workspace password, member PINs, portal revocation. Owner/Admin alone. */
  'manage_security',
  /** Holiday calendars, defaults, currency, date format. */
  'manage_settings',
  /** Create, edit, archive members; record leave. */
  'manage_members',
  /** Create, edit, archive clients, projects, roles, rates, budgets. */
  'manage_projects',
  /** Assign members to project roles. */
  'manage_assignments',
  /** Create, edit, delete bookings on the planner. */
  'manage_bookings',
  /** Fill in or correct anyone's timesheet. */
  'log_time_for_others',
  /** Mark work invoiced, unmark an invoice. */
  'manage_billing',
  /** See logged / invoiced / unbilled figures and export them. */
  'view_billing',
  /** See utilization and project reports and export them. */
  'view_reports',
  /** See the planner and availability. */
  'view_planner',
  /** See clients, projects, roles and budgets. */
  'view_projects',
  /** See members and their capacity. */
  'view_members',
  /** Record project health updates. */
  'manage_health',
] as const

export type Capability = (typeof CAPABILITIES)[number]

const ALL: readonly Capability[] = CAPABILITIES

const MATRIX: Record<MemberRoleName, readonly Capability[]> = {
  // Everything, plus workspace security.
  owner_admin: ALL,

  // Full workspace; cannot change workspace-level security.
  operations_lead: ALL.filter((c) => c !== 'manage_security'),

  // Planning and projects; cannot invoice or see money owed.
  resource_manager: [
    'manage_projects',
    'manage_assignments',
    'manage_bookings',
    'view_planner',
    'view_projects',
    'view_members',
    'view_reports',
  ],

  // Own projects only — enforced by scope, not by capability. Related billing is
  // readable; global finance is not.
  project_manager: [
    'manage_projects',
    'manage_assignments',
    'manage_health',
    'view_projects',
    'view_members',
    'view_planner',
    'view_billing',
    'view_reports',
  ],

  // Billing and reports; cannot change scope or staffing.
  finance: ['manage_billing', 'view_billing', 'view_reports', 'view_projects', 'view_members'],

  // Own timesheet only, through the portal. No workspace capability at all.
  logger: [],
}

export function can(role: MemberRoleName, capability: Capability): boolean {
  return MATRIX[role].includes(capability)
}

export function capabilitiesFor(role: MemberRoleName): readonly Capability[] {
  return MATRIX[role]
}

/**
 * A Project Manager is scoped to the engagements they own; everyone else with the
 * capability sees all of them. Scope is a second gate AFTER the capability check,
 * never a substitute for it.
 */
export function isProjectScoped(role: MemberRoleName): boolean {
  return role === 'project_manager'
}

export function canTouchProject(
  role: MemberRoleName,
  actingMemberId: string,
  project: { ownerMemberId: string | null },
): boolean {
  if (!isProjectScoped(role)) return true
  return project.ownerMemberId === actingMemberId
}

/** Human text for a refusal, so a forbidden panel can say what is missing. */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  manage_security: 'manage workspace security',
  manage_settings: 'manage workspace settings',
  manage_members: 'manage members',
  manage_projects: 'manage clients and projects',
  manage_assignments: 'manage role assignments',
  manage_bookings: 'create and edit bookings',
  log_time_for_others: "fill in other people's timesheets",
  manage_billing: 'mark work invoiced',
  view_billing: 'view billing figures',
  view_reports: 'view reports',
  view_planner: 'view the resource planner',
  view_projects: 'view clients and projects',
  view_members: 'view members',
  manage_health: 'record project health updates',
}
