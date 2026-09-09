import 'server-only'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { utilization, type Utilization } from '@/lib/domain/utilization'
import type { ISODate } from '@/lib/domain/types'
import type { Db } from '../client'
import {
  holidayCalendars, leaveRecords, members, projectRoles, projects, roleAssignments,
  toPublicMember, type LeaveRecord, type PublicMember,
} from '../schema'
import { dailyAvailability, loadCapacityContexts, loggedMinutesByMember } from './capacity-context'

export type PortalState = 'active' | 'revoked' | 'no_pin'


export type MemberListRow = {
  member: PublicMember
  calendarName: string | null
  weeklyCapacityMinutes: number
  availableMinutes: number
  loggedMinutes: number
  billableMinutes: number
  utilization: Utilization
  assignmentCount: number
  portalState: PortalState
}

/** Takes only the two fields it needs, so no helper here holds a whole member row. */
function portalState(state: { portalRevoked: boolean; pinHash: string | null }): PortalState {
  if (state.portalRevoked) return 'revoked'
  if (!state.pinHash) return 'no_pin'
  return 'active'
}

/** Members with capacity and utilization for a range — five bounded queries. */
export async function listMembers(
  db: Db,
  opts: { from: ISODate; to: ISODate; includeArchived?: boolean },
): Promise<MemberListRow[]> {
  const [capacities, logged, calendars, assignmentCounts] = await Promise.all([
    loadCapacityContexts(db, { from: opts.from, to: opts.to, includeArchived: opts.includeArchived }),
    loggedMinutesByMember(db, { from: opts.from, to: opts.to }),
    db.select({ id: holidayCalendars.id, name: holidayCalendars.name }).from(holidayCalendars),
    db
      .select({ memberId: roleAssignments.memberId, n: sql<number>`count(*)::int` })
      .from(roleAssignments)
      .groupBy(roleAssignments.memberId),
  ])

  const calendarName = new Map(calendars.map((c) => [c.id, c.name]))
  const assignments = new Map(assignmentCounts.map((a) => [a.memberId, Number(a.n)]))

  return [...capacities.values()]
    .map((capacity) => {
      const member = capacity.member
      const totals = logged.get(member.id) ?? { loggedMinutes: 0, billableMinutes: 0 }
      return {
        member: toPublicMember(member),
        calendarName: member.holidayCalendarId ? (calendarName.get(member.holidayCalendarId) ?? null) : null,
        weeklyCapacityMinutes: capacity.weeklyCapacityMinutes,
        availableMinutes: capacity.availableMinutes,
        loggedMinutes: totals.loggedMinutes,
        billableMinutes: totals.billableMinutes,
        utilization: utilization({
          billableMinutes: totals.billableMinutes,
          loggedMinutes: totals.loggedMinutes,
          availableMinutes: capacity.availableMinutes,
          targetPct: member.utilizationTargetPct,
        }),
        assignmentCount: assignments.get(member.id) ?? 0,
        portalState: portalState(member),
      }
    })
    .sort((a, b) => a.member.name.localeCompare(b.member.name))
}

export type MemberAssignment = {
  projectRoleId: string
  roleName: string
  rateCents: number
  projectId: string
  projectName: string
  projectColor: string
  billable: boolean
}

export type MemberDetail = {
  member: PublicMember
  /**
   * The private link and its state. Sensitive: a page must gate `token` behind
   * `manage_members` before handing it to anything that renders.
   */
  portal: { token: string; hasPin: boolean; revoked: boolean }
  calendarName: string | null
  weeklyCapacityMinutes: number
  availableMinutes: number
  loggedMinutes: number
  billableMinutes: number
  utilization: Utilization
  leave: LeaveRecord[]
  assignments: MemberAssignment[]
  portalState: PortalState
  /** Per-day availability for the requested range, with lock reasons. */
  days: ReturnType<typeof dailyAvailability>
}

export async function getMemberDetail(
  db: Db,
  memberId: string,
  range: { from: ISODate; to: ISODate },
): Promise<MemberDetail | null> {
  const capacities = await loadCapacityContexts(db, {
    from: range.from,
    to: range.to,
    memberIds: [memberId],
    includeArchived: true,
  })
  const capacity = capacities.get(memberId)
  if (!capacity) return null

  const [logged, calendars, leave, assignments] = await Promise.all([
    loggedMinutesByMember(db, { from: range.from, to: range.to, memberIds: [memberId] }),
    capacity.member.holidayCalendarId
      ? db
          .select({ name: holidayCalendars.name })
          .from(holidayCalendars)
          .where(eq(holidayCalendars.id, capacity.member.holidayCalendarId))
          .limit(1)
      : Promise.resolve([]),
    db
      .select()
      .from(leaveRecords)
      .where(eq(leaveRecords.memberId, memberId))
      .orderBy(desc(leaveRecords.startDate)),
    db
      .select({
        projectRoleId: projectRoles.id,
        roleName: projectRoles.name,
        rateCents: projectRoles.rateCents,
        projectId: projects.id,
        projectName: projects.name,
        projectColor: projects.color,
        billable: projects.billable,
      })
      .from(roleAssignments)
      .innerJoin(projectRoles, eq(projectRoles.id, roleAssignments.projectRoleId))
      .innerJoin(projects, eq(projects.id, projectRoles.projectId))
      .where(and(eq(roleAssignments.memberId, memberId), isNull(projects.archivedAt)))
      .orderBy(asc(projects.name), asc(projectRoles.sortOrder)),
  ])

  const totals = logged.get(memberId) ?? { loggedMinutes: 0, billableMinutes: 0 }

  return {
    member: toPublicMember(capacity.member),
    portal: {
      token: capacity.member.portalToken,
      hasPin: Boolean(capacity.member.pinHash),
      revoked: capacity.member.portalRevoked,
    },
    calendarName: calendars[0]?.name ?? null,
    weeklyCapacityMinutes: capacity.weeklyCapacityMinutes,
    availableMinutes: capacity.availableMinutes,
    loggedMinutes: totals.loggedMinutes,
    billableMinutes: totals.billableMinutes,
    utilization: utilization({
      billableMinutes: totals.billableMinutes,
      loggedMinutes: totals.loggedMinutes,
      availableMinutes: capacity.availableMinutes,
      targetPct: capacity.member.utilizationTargetPct,
    }),
    leave,
    assignments,
    portalState: portalState(capacity.member),
    days: dailyAvailability(capacity, range.from, range.to),
  }
}

export async function listHolidayCalendars(db: Db) {
  return db
    .select({ id: holidayCalendars.id, name: holidayCalendars.name, regionCode: holidayCalendars.regionCode })
    .from(holidayCalendars)
    .orderBy(asc(holidayCalendars.name))
}
