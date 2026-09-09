import 'server-only'
import { and, asc, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import {
  addDays, eachDay, endOfMonth, endOfWeek, startOfMonth, startOfWeek, timelineRange,
  type TimelineScale,
} from '@/lib/domain/dates'
import { loadBand, type LoadBand } from '@/lib/domain/utilization'
import type { ISODate } from '@/lib/domain/types'
import type { Db } from '../client'
import { bookings, clients, members, projectRoles, projects, roleAssignments } from '../schema'
import { dailyAvailability, loadCapacityContexts } from './capacity-context'

export type PlannerBucket = { key: string; label: string; sublabel: string; from: ISODate; to: ISODate; isToday: boolean }

export type PlannerCell = {
  key: string
  availableMinutes: number
  confirmedMinutes: number
  tentativeMinutes: number
  loggedMinutes: number
  band: LoadBand
  /** Why this cell has no capacity, when it has none. */
  blockedLabel: string | null
}

export type PlannerRow = {
  memberId: string
  name: string
  color: string
  role: string
  cells: PlannerCell[]
  availableMinutes: number
  confirmedMinutes: number
  tentativeMinutes: number
  loggedMinutes: number
}

export type PlannerBooking = {
  id: string
  memberId: string
  memberName: string
  projectRoleId: string
  roleName: string
  projectId: string
  projectName: string
  projectColor: string
  clientName: string
  startDate: ISODate
  endDate: ISODate
  minutesPerDay: number
  status: 'tentative' | 'confirmed'
  note: string | null
  effectiveMinutes: number
}

export type PlannerData = {
  scale: TimelineScale
  from: ISODate
  to: ISODate
  buckets: PlannerBucket[]
  rows: PlannerRow[]
  bookings: PlannerBooking[]
  /** True when bookings were limited to the engagements the caller owns. */
  scopedToOwner: boolean
}

/**
 * Columns adapt to the zoom level so a year does not render 365 of them: days for a
 * week or a month, weeks for a quarter, months for a year.
 */
function buildBuckets(
  scale: TimelineScale,
  from: ISODate,
  to: ISODate,
  weekStartDay: number,
  now: ISODate,
): PlannerBucket[] {
  if (scale === 'week' || scale === 'month') {
    return eachDay(from, to).map((date) => ({
      key: date,
      label: date.slice(8, 10),
      sublabel: date,
      from: date,
      to: date,
      isToday: date === now,
    }))
  }
  if (scale === 'quarter') {
    const out: PlannerBucket[] = []
    let cursor = startOfWeek(from, weekStartDay)
    while (cursor <= to) {
      const end = endOfWeek(cursor, weekStartDay)
      out.push({
        key: cursor,
        label: `w/c ${cursor.slice(8, 10)}`,
        sublabel: `${cursor} – ${end}`,
        from: cursor > from ? cursor : from,
        to: end < to ? end : to,
        isToday: now >= cursor && now <= end,
      })
      cursor = addDays(cursor, 7)
    }
    return out
  }
  const out: PlannerBucket[] = []
  let cursor = startOfMonth(from)
  while (cursor <= to) {
    const end = endOfMonth(cursor)
    out.push({
      key: cursor,
      label: cursor.slice(5, 7),
      sublabel: cursor.slice(0, 7),
      from: cursor > from ? cursor : from,
      to: end < to ? end : to,
      isToday: now.slice(0, 7) === cursor.slice(0, 7),
    })
    cursor = startOfMonth(addDays(end, 1))
  }
  return out
}

export async function getPlannerData(
  db: Db,
  opts: {
    scale: TimelineScale
    ref: ISODate
    weekStartDay: number
    /** The workspace's today, for the "you are here" column. Never read from the clock here. */
    asOf: ISODate
    projectId?: string
    /**
     * Limits which bookings are visible to projects this member owns. Availability
     * stays whole — who is free is staffing information the planner exists to show —
     * but another manager's project names and plans are not disclosed.
     */
    ownerMemberId?: string
  },
): Promise<PlannerData> {
  const { from, to } = timelineRange(opts.scale, opts.ref, opts.weekStartDay)
  const buckets = buildBuckets(opts.scale, from, to, opts.weekStartDay, opts.asOf)

  const [capacities, bookingRows, loggedRows] = await Promise.all([
    loadCapacityContexts(db, { from, to }),
    db
      .select({
        id: bookings.id,
        memberId: bookings.memberId,
        projectRoleId: bookings.projectRoleId,
        startDate: bookings.startDate,
        endDate: bookings.endDate,
        minutesPerDay: bookings.minutesPerDay,
        status: bookings.status,
        note: bookings.note,
        roleName: projectRoles.name,
        projectId: projects.id,
        projectName: projects.name,
        projectColor: projects.color,
        clientName: clients.name,
        memberName: members.name,
      })
      .from(bookings)
      .innerJoin(projectRoles, eq(projectRoles.id, bookings.projectRoleId))
      .innerJoin(projects, eq(projects.id, projectRoles.projectId))
      .innerJoin(clients, eq(clients.id, projects.clientId))
      .innerJoin(members, eq(members.id, bookings.memberId))
      .where(
        and(
          lte(bookings.startDate, to),
          gte(bookings.endDate, from),
          opts.projectId ? eq(projects.id, opts.projectId) : undefined,
          opts.ownerMemberId ? eq(projects.ownerMemberId, opts.ownerMemberId) : undefined,
        ),
      )
      .orderBy(asc(bookings.startDate)),
    db.execute<{ member_id: string; entry_date: string; minutes: number }>(sql`
      select member_id, entry_date::text, sum(minutes)::bigint as minutes
      from time_entries
      where entry_date between ${from} and ${to}
      group by member_id, entry_date
    `),
  ])

  const loggedByCell = new Map<string, number>()
  for (const row of loggedRows.rows as unknown as { member_id: string; entry_date: string; minutes: number }[]) {
    loggedByCell.set(`${row.member_id}|${row.entry_date}`, Number(row.minutes))
  }

  const plannerBookings: PlannerBooking[] = []
  const rows: PlannerRow[] = []

  for (const capacity of [...capacities.values()].sort((a, b) => a.member.name.localeCompare(b.member.name))) {
    const member = capacity.member
    const availabilityByDate = new Map(
      dailyAvailability(capacity, from, to).map((day) => [day.date, day]),
    )
    const memberBookings = bookingRows.filter((b) => b.memberId === member.id)

    // Per-day booked minutes, capped by what the day actually holds.
    const confirmedByDate = new Map<string, number>()
    const tentativeByDate = new Map<string, number>()
    for (const booking of memberBookings) {
      let effective = 0
      const start = booking.startDate > from ? booking.startDate : from
      const end = booking.endDate < to ? booking.endDate : to
      for (const date of eachDay(start, end)) {
        const available = availabilityByDate.get(date)?.minutes ?? 0
        if (available <= 0) continue
        const minutes = Math.min(booking.minutesPerDay, available)
        effective += minutes
        const target = booking.status === 'confirmed' ? confirmedByDate : tentativeByDate
        target.set(date, (target.get(date) ?? 0) + minutes)
      }
      plannerBookings.push({
        id: booking.id,
        memberId: booking.memberId,
        memberName: booking.memberName,
        projectRoleId: booking.projectRoleId,
        roleName: booking.roleName,
        projectId: booking.projectId,
        projectName: booking.projectName,
        projectColor: booking.projectColor,
        clientName: booking.clientName,
        startDate: booking.startDate,
        endDate: booking.endDate,
        minutesPerDay: booking.minutesPerDay,
        status: booking.status,
        note: booking.note,
        effectiveMinutes: effective,
      })
    }

    const cells: PlannerCell[] = buckets.map((bucket) => {
      let available = 0
      let confirmed = 0
      let tentative = 0
      let logged = 0
      let blockedLabel: string | null = null
      for (const date of eachDay(bucket.from, bucket.to)) {
        const day = availabilityByDate.get(date)
        available += day?.minutes ?? 0
        confirmed += confirmedByDate.get(date) ?? 0
        tentative += tentativeByDate.get(date) ?? 0
        logged += loggedByCell.get(`${member.id}|${date}`) ?? 0
        if (
          bucket.from === bucket.to &&
          day &&
          day.minutes === 0 &&
          day.reason !== 'non_working_day'
        ) {
          blockedLabel = day.label
        }
      }
      return {
        key: bucket.key,
        availableMinutes: available,
        confirmedMinutes: confirmed,
        tentativeMinutes: tentative,
        loggedMinutes: logged,
        band: loadBand(confirmed + tentative, available),
        blockedLabel,
      }
    })

    rows.push({
      memberId: member.id,
      name: member.name,
      color: member.color,
      role: member.role,
      cells,
      availableMinutes: cells.reduce((sum, c) => sum + c.availableMinutes, 0),
      confirmedMinutes: cells.reduce((sum, c) => sum + c.confirmedMinutes, 0),
      tentativeMinutes: cells.reduce((sum, c) => sum + c.tentativeMinutes, 0),
      loggedMinutes: cells.reduce((sum, c) => sum + c.loggedMinutes, 0),
    })
  }

  return {
    scale: opts.scale,
    from,
    to,
    buckets,
    rows,
    bookings: plannerBookings,
    scopedToOwner: Boolean(opts.ownerMemberId),
  }
}

/** Roles a given member may be booked on — assignment is the gate. */
export async function bookableRolesForMember(db: Db, memberId: string) {
  return db
    .select({
      projectRoleId: projectRoles.id,
      roleName: projectRoles.name,
      rateCents: projectRoles.rateCents,
      projectId: projects.id,
      projectName: projects.name,
      clientName: clients.name,
      billable: projects.billable,
    })
    .from(roleAssignments)
    .innerJoin(projectRoles, eq(projectRoles.id, roleAssignments.projectRoleId))
    .innerJoin(projects, eq(projects.id, projectRoles.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(
      and(
        eq(roleAssignments.memberId, memberId),
        isNull(projects.archivedAt),
        isNull(projectRoles.archivedAt),
      ),
    )
    .orderBy(asc(clients.name), asc(projects.name), asc(projectRoles.sortOrder))
}

/**
 * Every assignable pair, so the booking dialog can switch member without a round trip.
 * `ownerMemberId` limits it to one manager's engagements.
 */
export async function allBookableAssignments(db: Db, ownerMemberId?: string) {
  return db
    .select({
      memberId: roleAssignments.memberId,
      projectRoleId: projectRoles.id,
      roleName: projectRoles.name,
      rateCents: projectRoles.rateCents,
      projectId: projects.id,
      projectName: projects.name,
      clientName: clients.name,
      billable: projects.billable,
    })
    .from(roleAssignments)
    .innerJoin(projectRoles, eq(projectRoles.id, roleAssignments.projectRoleId))
    .innerJoin(projects, eq(projects.id, projectRoles.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(
      and(
        isNull(projects.archivedAt),
        isNull(projectRoles.archivedAt),
        ownerMemberId ? eq(projects.ownerMemberId, ownerMemberId) : undefined,
      ),
    )
    .orderBy(asc(clients.name), asc(projects.name), asc(projectRoles.sortOrder))
}
