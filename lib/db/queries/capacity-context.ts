import 'server-only'
import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import type { HolidayMap, LeaveSpan } from '@/lib/domain/capacity'
import { availabilityByDay, availableMinutes, weeklyCapacityMinutes } from '@/lib/domain/capacity'
import type { ISODate } from '@/lib/domain/types'
import type { Db } from '../client'
import { holidays, leaveRecords, members, type Member } from '../schema'

/**
 * Everything needed to answer "how available is this person" for a date range, loaded
 * in three queries regardless of how many people or days are involved.
 *
 * Every panel that shows capacity goes through this, so no panel can accidentally
 * forget holidays or leave.
 */
export type MemberCapacity = {
  member: Member
  holidays: HolidayMap
  leaves: LeaveSpan[]
  weeklyCapacityMinutes: number
  /** Available minutes across the requested range. */
  availableMinutes: number
}

export type CapacityContexts = Map<string, MemberCapacity>

export async function loadCapacityContexts(
  db: Db,
  opts: { from: ISODate; to: ISODate; memberIds?: string[]; includeArchived?: boolean },
): Promise<CapacityContexts> {
  const { from, to, memberIds, includeArchived = false } = opts

  const memberRows = await db
    .select()
    .from(members)
    .where(
      and(
        memberIds && memberIds.length > 0 ? inArray(members.id, memberIds) : undefined,
        includeArchived ? undefined : isNull(members.archivedAt),
      ),
    )

  if (memberRows.length === 0) return new Map()

  const calendarIds = [
    ...new Set(memberRows.map((m) => m.holidayCalendarId).filter((id): id is string => Boolean(id))),
  ]

  const holidayRows =
    calendarIds.length === 0
      ? []
      : await db
          .select({
            calendarId: holidays.calendarId,
            holidayDate: holidays.holidayDate,
            name: holidays.name,
          })
          .from(holidays)
          .where(
            and(
              inArray(holidays.calendarId, calendarIds),
              gte(holidays.holidayDate, from),
              lte(holidays.holidayDate, to),
            ),
          )

  const leaveRows = await db
    .select({
      memberId: leaveRecords.memberId,
      leaveType: leaveRecords.leaveType,
      startDate: leaveRecords.startDate,
      endDate: leaveRecords.endDate,
      portion: leaveRecords.portion,
    })
    .from(leaveRecords)
    .where(
      and(
        inArray(
          leaveRecords.memberId,
          memberRows.map((m) => m.id),
        ),
        // Any leave that overlaps the window at all.
        lte(leaveRecords.startDate, to),
        gte(leaveRecords.endDate, from),
      ),
    )

  const holidaysByCalendar = new Map<string, Map<ISODate, string>>()
  for (const row of holidayRows) {
    const map = holidaysByCalendar.get(row.calendarId) ?? new Map<ISODate, string>()
    map.set(row.holidayDate, row.name)
    holidaysByCalendar.set(row.calendarId, map)
  }

  const leavesByMember = new Map<string, LeaveSpan[]>()
  for (const row of leaveRows) {
    const list = leavesByMember.get(row.memberId) ?? []
    list.push({
      leaveType: row.leaveType,
      startDate: row.startDate,
      endDate: row.endDate,
      portion: row.portion,
    })
    leavesByMember.set(row.memberId, list)
  }

  const out: CapacityContexts = new Map()
  const EMPTY: HolidayMap = new Map()
  for (const member of memberRows) {
    const memberHolidays = member.holidayCalendarId
      ? (holidaysByCalendar.get(member.holidayCalendarId) ?? EMPTY)
      : EMPTY
    const memberLeaves = leavesByMember.get(member.id) ?? []
    out.set(member.id, {
      member,
      holidays: memberHolidays,
      leaves: memberLeaves,
      weeklyCapacityMinutes: weeklyCapacityMinutes(member.workingMinutes),
      availableMinutes: availableMinutes(
        { workingMinutes: member.workingMinutes, contractStart: member.contractStart, contractEnd: member.contractEnd },
        from,
        to,
        memberHolidays,
        memberLeaves,
      ),
    })
  }
  return out
}

/** Per-day availability for one loaded member, with lock reasons attached. */
export function dailyAvailability(capacity: MemberCapacity, from: ISODate, to: ISODate) {
  return availabilityByDay(
    {
      workingMinutes: capacity.member.workingMinutes,
      contractStart: capacity.member.contractStart,
      contractEnd: capacity.member.contractEnd,
    },
    from,
    to,
    capacity.holidays,
    capacity.leaves,
  )
}

/** Logged and billable minutes per member for a range — one aggregate query. */
export async function loggedMinutesByMember(
  db: Db,
  opts: { from: ISODate; to: ISODate; memberIds?: string[] },
): Promise<Map<string, { loggedMinutes: number; billableMinutes: number }>> {
  const filter =
    opts.memberIds && opts.memberIds.length > 0
      ? sql`and te.member_id in ${opts.memberIds}`
      : sql``
  const res = await db.execute<{
    member_id: string
    logged: number
    billable: number
  }>(sql`
    select te.member_id,
           coalesce(sum(te.minutes), 0)::bigint as logged,
           coalesce(sum(case when p.billable then te.minutes else 0 end), 0)::bigint as billable
    from time_entries te
    join project_roles pr on pr.id = te.project_role_id
    join projects p on p.id = pr.project_id
    where te.entry_date between ${opts.from} and ${opts.to} ${filter}
    group by te.member_id
  `)
  const rows = res.rows as unknown as { member_id: string; logged: number; billable: number }[]
  return new Map(
    rows.map((r) => [r.member_id, { loggedMinutes: Number(r.logged), billableMinutes: Number(r.billable) }]),
  )
}
