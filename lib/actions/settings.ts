'use server'
import { and, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { holidayCalendars, holidays, members, projectRoles, projects, timeEntries, workspaceSettings } from '@/lib/db/schema'
import { isUniqueViolation } from '@/lib/db/errors'
import { requireCapability } from '@/lib/auth/context'
import { holidayConflictWarning, type Warning } from '@/lib/domain/guardrails'
import {
  billingMethodSchema, centsFromInput, isoDate, readId, timeZoneSchema, uuid,
} from '@/lib/validation/schemas'
import { fail, failValidation, ok, type ActionResult } from './result'

function revalidateEverything() {
  for (const path of ['/', '/settings', '/timesheet', '/planner', '/reports', '/billing', '/members', '/status']) {
    revalidatePath(path)
  }
}

const settingsSchema = z.object({
  agencyName: z.string().trim().min(1, 'The workspace needs a name.').max(120),
  currency: z.string().trim().length(3, 'Use a three-letter currency code.').toUpperCase(),
  dateFormat: z.string().trim().min(3).max(20),
  weekStartDay: z.number().int().min(0).max(6),
  timeZone: timeZoneSchema,
  defaultRateCents: centsFromInput,
  defaultBillingMethod: billingMethodSchema,
  defaultBillable: z.boolean(),
})

export async function updateWorkspaceSettings(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const guard = await requireCapability('manage_settings')
  if (!('ctx' in guard)) return guard

  const parsed = settingsSchema.safeParse({
    agencyName: String(formData.get('agencyName') ?? ''),
    currency: String(formData.get('currency') ?? 'EUR'),
    dateFormat: String(formData.get('dateFormat') ?? 'dd/MM/yyyy'),
    weekStartDay: Number(String(formData.get('weekStartDay') ?? '1')),
    timeZone: String(formData.get('timeZone') ?? 'UTC'),
    defaultRateCents: String(formData.get('defaultRateCents') ?? '0'),
    defaultBillingMethod: String(formData.get('defaultBillingMethod') ?? 'time_and_materials'),
    defaultBillable: formData.get('defaultBillable') === 'on' || formData.get('defaultBillable') === 'true',
  })
  if (!parsed.success) return failValidation(parsed.error.issues)

  const db = await getDb()
  await db
    .update(workspaceSettings)
    .set({ ...parsed.data, updatedAt: sql`now()` })
    .where(eq(workspaceSettings.id, 'default'))

  revalidateEverything()
  return ok()
}

/* ------------------------------------------------------------------ calendars */

const calendarSchema = z.object({
  name: z.string().trim().min(1, 'Give the calendar a name.').max(120),
  regionCode: z
    .string()
    .trim()
    .max(16)
    .transform((v) => (v === '' ? null : v.toUpperCase()))
    .nullable(),
})

export async function upsertHolidayCalendar(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const guard = await requireCapability('manage_settings')
  if (!('ctx' in guard)) return guard

  const parsed = calendarSchema.safeParse({
    name: String(formData.get('name') ?? ''),
    regionCode: String(formData.get('regionCode') ?? ''),
  })
  if (!parsed.success) return failValidation(parsed.error.issues)

  const db = await getDb()
  const calendarId = String(formData.get('calendarId') ?? '').trim()
  if (calendarId) {
    const updated = await db
      .update(holidayCalendars)
      .set(parsed.data)
      .where(eq(holidayCalendars.id, calendarId))
      .returning({ id: holidayCalendars.id })
    if (updated.length === 0) return fail('not_found', 'That calendar no longer exists.')
    revalidateEverything()
    return ok({ id: calendarId })
  }

  const inserted = await db.insert(holidayCalendars).values(parsed.data).returning({ id: holidayCalendars.id })
  revalidateEverything()
  return ok({ id: inserted[0]!.id })
}

export async function deleteHolidayCalendar(calendarId: string): Promise<ActionResult<undefined>> {
  const guard = await requireCapability('manage_settings')
  if (!('ctx' in guard)) return guard

  const id = readId(calendarId)
  if (!id) return fail('not_found', 'That calendar could not be identified.')

  const db = await getDb()
  const used = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.holidayCalendarId, id))
    .limit(1)
  if (used.length > 0) {
    return fail('invalid', 'Members are still using this calendar. Move them to another one first.')
  }

  const deleted = await db
    .delete(holidayCalendars)
    .where(eq(holidayCalendars.id, id))
    .returning({ id: holidayCalendars.id })
  if (deleted.length === 0) return fail('not_found', 'That calendar no longer exists.')
  revalidateEverything()
  return ok()
}

const holidaySchema = z.object({
  calendarId: uuid,
  holidayDate: isoDate,
  name: z.string().trim().min(1, 'Name the holiday.').max(120),
})

export async function upsertHoliday(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const guard = await requireCapability('manage_settings')
  if (!('ctx' in guard)) return guard

  const parsed = holidaySchema.safeParse({
    calendarId: String(formData.get('calendarId') ?? ''),
    holidayDate: String(formData.get('holidayDate') ?? ''),
    name: String(formData.get('name') ?? ''),
  })
  if (!parsed.success) return failValidation(parsed.error.issues)
  const input = parsed.data

  const db = await getDb()

  // Hours already logged on that date are preserved and surfaced, never deleted.
  const clash = await db
    .select({ name: members.name, minutes: timeEntries.minutes })
    .from(timeEntries)
    .innerJoin(members, eq(members.id, timeEntries.memberId))
    .innerJoin(projectRoles, eq(projectRoles.id, timeEntries.projectRoleId))
    .innerJoin(projects, eq(projects.id, projectRoles.projectId))
    .where(and(eq(members.holidayCalendarId, input.calendarId), eq(timeEntries.entryDate, input.holidayDate)))

  const warnings: Warning[] = []
  if (clash.length > 0) {
    const warning = holidayConflictWarning({
      date: input.holidayDate,
      holidayName: input.name,
      members: [...new Set(clash.map((row) => row.name))],
      minutes: clash.reduce((sum, row) => sum + row.minutes, 0),
    })
    if (warning) warnings.push(warning)
  }

  try {
    await db.insert(holidays).values(input).onConflictDoUpdate({
      target: [holidays.calendarId, holidays.holidayDate],
      set: { name: input.name },
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail('duplicate', 'That date already has a holiday on this calendar.', 'holidayDate')
    }
    throw error
  }

  revalidateEverything()
  return ok(undefined, warnings)
}

export async function deleteHoliday(holidayId: string): Promise<ActionResult<undefined>> {
  const guard = await requireCapability('manage_settings')
  if (!('ctx' in guard)) return guard

  const id = readId(holidayId)
  if (!id) return fail('not_found', 'That holiday could not be identified.')
  const db = await getDb()
  const deleted = await db.delete(holidays).where(eq(holidays.id, id)).returning({ id: holidays.id })
  if (deleted.length === 0) return fail('not_found', 'That holiday no longer exists.')
  revalidateEverything()
  return ok()
}
