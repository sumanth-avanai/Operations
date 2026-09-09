import 'server-only'
import { asc, eq, gte, sql } from 'drizzle-orm'
import { startOfYear } from '@/lib/domain/dates'
import type { ISODate } from '@/lib/domain/types'
import type { Db } from '../client'
import { holidayCalendars, holidays, members } from '../schema'

export type CalendarWithHolidays = {
  id: string
  name: string
  regionCode: string | null
  memberCount: number
  holidays: { id: string; holidayDate: string; name: string }[]
}

/** Calendars with this year's holidays onward — three bounded queries. */
export async function getCalendars(db: Db, asOf: ISODate): Promise<CalendarWithHolidays[]> {
  const from = startOfYear(asOf)
  const [calendars, holidayRows, counts] = await Promise.all([
    db
      .select({ id: holidayCalendars.id, name: holidayCalendars.name, regionCode: holidayCalendars.regionCode })
      .from(holidayCalendars)
      .orderBy(asc(holidayCalendars.name)),
    db
      .select({
        id: holidays.id,
        calendarId: holidays.calendarId,
        holidayDate: holidays.holidayDate,
        name: holidays.name,
      })
      .from(holidays)
      .where(gte(holidays.holidayDate, from))
      .orderBy(asc(holidays.holidayDate)),
    db
      .select({ calendarId: members.holidayCalendarId, n: sql<number>`count(*)::int` })
      .from(members)
      .groupBy(members.holidayCalendarId),
  ])

  const countByCalendar = new Map(counts.map((row) => [row.calendarId, Number(row.n)]))

  return calendars.map((calendar) => ({
    ...calendar,
    memberCount: countByCalendar.get(calendar.id) ?? 0,
    holidays: holidayRows.filter((row) => row.calendarId === calendar.id),
  }))
}

export async function countMembersOnCalendar(db: Db, calendarId: string) {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(members)
    .where(eq(members.holidayCalendarId, calendarId))
  return Number(rows[0]?.n ?? 0)
}
