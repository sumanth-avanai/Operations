import 'server-only'
import { and, asc, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import { eachDay, endOfWeek, startOfWeek } from '@/lib/domain/dates'
import { bookedMinutesByDay, type DayAvailability } from '@/lib/domain/capacity'
import type { ISODate } from '@/lib/domain/types'
import type { Db } from '../client'
import {
  bookings, clients, invoices, members, projectRoles, projects, roleAssignments, timeEntries,
  toPublicMember, type PublicMember,
} from '../schema'
import { loadCapacityContexts, dailyAvailability } from './capacity-context'

export type TimesheetCell = {
  minutes: number
  note: string | null
  /** Set when the cell is already invoiced and therefore immutable. */
  invoiceReference: string | null
}

export type TimesheetRow = {
  projectRoleId: string
  roleName: string
  projectId: string
  projectName: string
  projectColor: string
  clientName: string
  billable: boolean
  assigned: boolean
  cells: Record<string, TimesheetCell>
  planned: Record<string, number>
  rowMinutes: number
  plannedMinutes: number
}

export type TimesheetDay = DayAvailability & { isToday: boolean; isPast: boolean }

export type TimesheetWeek = {
  member: PublicMember
  weekStart: ISODate
  weekEnd: ISODate
  days: TimesheetDay[]
  rows: TimesheetRow[]
  /** Conflict token: the newest updatedAt across the week that was read (FR-024). */
  baseUpdatedAt: string | null
  totalsByDay: Record<string, number>
  weekMinutes: number
  billableMinutes: number
  availableMinutes: number
}

/**
 * One member-week, assembled from five bounded queries.
 *
 * Rows are the member's assigned roles, plus any role they already have hours or a
 * booking against this week — so history stays visible after an un-assignment even
 * though nothing new can be added to it.
 */
export async function getTimesheetWeek(
  db: Db,
  memberId: string,
  weekDate: ISODate,
  /** The workspace's week start and its today: which day is highlighted, and which are past. */
  opts: { weekStartDay: number; asOf: ISODate },
): Promise<TimesheetWeek | null> {
  const { weekStartDay, asOf } = opts
  const weekStart = startOfWeek(weekDate, weekStartDay)
  const weekEnd = endOfWeek(weekDate, weekStartDay)
  const dates = eachDay(weekStart, weekEnd)

  const capacities = await loadCapacityContexts(db, {
    from: weekStart,
    to: weekEnd,
    memberIds: [memberId],
    includeArchived: true,
  })
  const capacity = capacities.get(memberId)
  if (!capacity) return null

  const [assignmentRows, entryRows, bookingRows] = await Promise.all([
    db
      .select({
        projectRoleId: projectRoles.id,
        roleName: projectRoles.name,
        sortOrder: projectRoles.sortOrder,
        projectId: projects.id,
        projectName: projects.name,
        projectColor: projects.color,
        billable: projects.billable,
        clientName: clients.name,
      })
      .from(roleAssignments)
      .innerJoin(projectRoles, eq(projectRoles.id, roleAssignments.projectRoleId))
      .innerJoin(projects, eq(projects.id, projectRoles.projectId))
      .innerJoin(clients, eq(clients.id, projects.clientId))
      .where(
        and(
          eq(roleAssignments.memberId, memberId),
          sql`${projects.archivedAt} is null`,
          sql`${projectRoles.archivedAt} is null`,
        ),
      )
      .orderBy(asc(clients.name), asc(projects.name), asc(projectRoles.sortOrder)),

    db
      .select({
        id: timeEntries.id,
        projectRoleId: timeEntries.projectRoleId,
        entryDate: timeEntries.entryDate,
        minutes: timeEntries.minutes,
        note: timeEntries.note,
        updatedAt: timeEntries.updatedAt,
        invoiceReference: invoices.reference,
        roleName: projectRoles.name,
        sortOrder: projectRoles.sortOrder,
        projectId: projects.id,
        projectName: projects.name,
        projectColor: projects.color,
        billable: projects.billable,
        clientName: clients.name,
      })
      .from(timeEntries)
      .innerJoin(projectRoles, eq(projectRoles.id, timeEntries.projectRoleId))
      .innerJoin(projects, eq(projects.id, projectRoles.projectId))
      .innerJoin(clients, eq(clients.id, projects.clientId))
      .leftJoin(invoices, eq(invoices.id, timeEntries.invoiceId))
      .where(
        and(
          eq(timeEntries.memberId, memberId),
          gte(timeEntries.entryDate, weekStart),
          lte(timeEntries.entryDate, weekEnd),
        ),
      ),

    db
      .select({
        projectRoleId: bookings.projectRoleId,
        startDate: bookings.startDate,
        endDate: bookings.endDate,
        minutesPerDay: bookings.minutesPerDay,
        status: bookings.status,
        roleName: projectRoles.name,
        sortOrder: projectRoles.sortOrder,
        projectId: projects.id,
        projectName: projects.name,
        projectColor: projects.color,
        billable: projects.billable,
        clientName: clients.name,
      })
      .from(bookings)
      .innerJoin(projectRoles, eq(projectRoles.id, bookings.projectRoleId))
      .innerJoin(projects, eq(projects.id, projectRoles.projectId))
      .innerJoin(clients, eq(clients.id, projects.clientId))
      .where(
        and(
          eq(bookings.memberId, memberId),
          eq(bookings.status, 'confirmed'),
          lte(bookings.startDate, weekEnd),
          gte(bookings.endDate, weekStart),
        ),
      ),
  ])

  type RowSeed = {
    projectRoleId: string
    roleName: string
    sortOrder: number
    projectId: string
    projectName: string
    projectColor: string
    billable: boolean
    clientName: string
    assigned: boolean
  }

  const seeds = new Map<string, RowSeed>()
  for (const row of assignmentRows) seeds.set(row.projectRoleId, { ...row, assigned: true })
  for (const row of [...entryRows, ...bookingRows]) {
    if (!seeds.has(row.projectRoleId)) {
      seeds.set(row.projectRoleId, {
        projectRoleId: row.projectRoleId,
        roleName: row.roleName,
        sortOrder: row.sortOrder,
        projectId: row.projectId,
        projectName: row.projectName,
        projectColor: row.projectColor,
        billable: row.billable,
        clientName: row.clientName,
        assigned: false,
      })
    }
  }

  const member = capacity.member
  const capacityMember = {
    workingMinutes: member.workingMinutes,
    contractStart: member.contractStart,
    contractEnd: member.contractEnd,
  }

  const plannedByRole = new Map<string, Map<string, number>>()
  for (const booking of bookingRows) {
    const byDay = bookedMinutesByDay(
      capacityMember,
      { startDate: booking.startDate, endDate: booking.endDate, minutesPerDay: booking.minutesPerDay },
      weekStart,
      weekEnd,
      capacity.holidays,
      capacity.leaves,
    )
    const target = plannedByRole.get(booking.projectRoleId) ?? new Map<string, number>()
    for (const [date, minutes] of byDay) {
      target.set(date, (target.get(date) ?? 0) + minutes)
    }
    plannedByRole.set(booking.projectRoleId, target)
  }

  const rows: TimesheetRow[] = [...seeds.values()]
    .map((seed) => {
      const cells: Record<string, TimesheetCell> = {}
      let rowMinutes = 0
      for (const entry of entryRows) {
        if (entry.projectRoleId !== seed.projectRoleId) continue
        cells[entry.entryDate] = {
          minutes: entry.minutes,
          note: entry.note,
          invoiceReference: entry.invoiceReference,
        }
        rowMinutes += entry.minutes
      }
      const plannedMap = plannedByRole.get(seed.projectRoleId)
      const planned: Record<string, number> = {}
      let plannedMinutes = 0
      if (plannedMap) {
        for (const date of dates) {
          const value = plannedMap.get(date) ?? 0
          if (value > 0) {
            planned[date] = value
            plannedMinutes += value
          }
        }
      }
      return { ...seed, cells, planned, rowMinutes, plannedMinutes }
    })
    .sort(
      (a, b) =>
        a.clientName.localeCompare(b.clientName) ||
        a.projectName.localeCompare(b.projectName) ||
        a.sortOrder - b.sortOrder ||
        a.roleName.localeCompare(b.roleName),
    )
    .map(({ sortOrder: _sortOrder, ...row }) => row)

  const totalsByDay: Record<string, number> = {}
  let weekMinutes = 0
  let billableMinutes = 0
  for (const date of dates) totalsByDay[date] = 0
  for (const entry of entryRows) {
    totalsByDay[entry.entryDate] = (totalsByDay[entry.entryDate] ?? 0) + entry.minutes
    weekMinutes += entry.minutes
    if (entry.billable) billableMinutes += entry.minutes
  }

  const now = asOf
  const days: TimesheetDay[] = dailyAvailability(capacity, weekStart, weekEnd).map((day) => ({
    ...day,
    isToday: day.date === now,
    isPast: day.date < now,
  }))

  const baseUpdatedAt =
    entryRows.length === 0
      ? null
      : entryRows.reduce((latest, row) => (row.updatedAt > latest ? row.updatedAt : latest), entryRows[0]!.updatedAt)

  return {
    member: toPublicMember(member),
    weekStart,
    weekEnd,
    days,
    rows,
    baseUpdatedAt,
    totalsByDay,
    weekMinutes,
    billableMinutes,
    availableMinutes: capacity.availableMinutes,
  }
}

/** Members whose timesheet can be opened internally. */
export async function timesheetMemberOptions(db: Db) {
  return db
    .select({ id: members.id, name: members.name, color: members.color, role: members.role })
    .from(members)
    .where(isNull(members.archivedAt))
    .orderBy(asc(members.name))
}
