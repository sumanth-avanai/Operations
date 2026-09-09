'use server'
import { and, eq, gte, lte, ne, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { leaveRecords, members } from '@/lib/db/schema'
import { isUniqueViolation } from '@/lib/db/errors'
import { requireCapability } from '@/lib/auth/context'
import { generatePortalToken, hashSecret } from '@/lib/auth/secrets'
import { weeklyCapacityMinutes } from '@/lib/domain/capacity'
import type { Warning } from '@/lib/domain/guardrails'
import {
  colorSchema, isoDate, leavePortionSchema, leaveTypeSchema, memberRoleSchema, minutesFromInput,
  optionalText, readId, uuid, workingMinutesFromForm, workingMinutesSchema,
} from '@/lib/validation/schemas'
import { LEAVE_TYPE_LABELS } from '@/lib/domain/types'
import { fail, failValidation, ok, type ActionResult } from './result'

const REVALIDATE = ['/', '/members', '/planner', '/timesheet', '/reports', '/projects']
function revalidateMemberViews(memberId?: string) {
  for (const path of REVALIDATE) revalidatePath(path)
  if (memberId) revalidatePath(`/members/${memberId}`)
}

const memberSchema = z.object({
  name: z.string().trim().min(1, 'A name is required.').max(120),
  email: z.string().trim().email('That is not an email address.').max(200),
  role: memberRoleSchema,
  workingMinutes: workingMinutesSchema,
  contractStart: isoDate,
  contractEnd: isoDate.nullable(),
  utilizationTargetPct: z.number().int().min(0).max(100).nullable(),
  holidayCalendarId: uuid.nullable(),
  color: colorSchema,
})

function readMemberForm(formData: FormData) {
  const targetRaw = String(formData.get('utilizationTargetPct') ?? '').trim()
  const contractEnd = String(formData.get('contractEnd') ?? '').trim()
  const calendar = String(formData.get('holidayCalendarId') ?? '').trim()
  return {
    name: String(formData.get('name') ?? ''),
    email: String(formData.get('email') ?? ''),
    role: String(formData.get('role') ?? 'logger'),
    workingMinutes: workingMinutesFromForm(formData),
    contractStart: String(formData.get('contractStart') ?? ''),
    contractEnd: contractEnd === '' ? null : contractEnd,
    utilizationTargetPct: targetRaw === '' ? null : Number(targetRaw),
    holidayCalendarId: calendar === '' || calendar === 'none' ? null : calendar,
    color: String(formData.get('color') ?? 'var(--hue-1)'),
  }
}

export async function createMember(
  _prev: ActionResult<{ memberId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ memberId: string; portalPath: string }>> {
  const guard = await requireCapability('manage_members')
  if (!('ctx' in guard)) return guard

  const parsed = memberSchema.safeParse(readMemberForm(formData))
  if (!parsed.success) return failValidation(parsed.error.issues)
  const input = parsed.data

  if (input.contractEnd && input.contractEnd < input.contractStart) {
    return fail('invalid', 'The contract end cannot be before the contract start.', 'contractEnd')
  }
  if (weeklyCapacityMinutes(input.workingMinutes) === 0) {
    return fail('invalid', 'Give this person at least one working day.', 'workingMinutes.mon')
  }

  const db = await getDb()
  const token = generatePortalToken()
  try {
    const inserted = await db
      .insert(members)
      .values({ ...input, portalToken: token })
      .returning({ id: members.id, name: members.name })
    const created = inserted[0]
    if (!created) return fail('invalid', 'The member could not be created.')

    // A new member is welcomed with their private link (FR-031).
    await db.execute(sql`
      insert into notifications (member_id, kind, title, body, link)
      values (${created.id}, 'onboarded', ${'Welcome to the workspace'},
              ${'Your private timesheet link is ready — logging a week takes a couple of minutes.'},
              ${`/portal/${token}`})
    `)

    revalidateMemberViews(created.id)
    return ok({ memberId: created.id, portalPath: `/portal/${token}` })
  } catch (error) {
    if (isUniqueViolation(error, 'members_email_unique')) {
      return fail('duplicate', 'Somebody already uses that email address.', 'email')
    }
    throw error
  }
}

export async function updateMember(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const guard = await requireCapability('manage_members')
  if (!('ctx' in guard)) return guard

  const memberId = uuid.safeParse(formData.get('memberId'))
  if (!memberId.success) return fail('not_found', 'That member could not be identified.')

  const parsed = memberSchema.safeParse(readMemberForm(formData))
  if (!parsed.success) return failValidation(parsed.error.issues)
  const input = parsed.data

  if (input.contractEnd && input.contractEnd < input.contractStart) {
    return fail('invalid', 'The contract end cannot be before the contract start.', 'contractEnd')
  }
  if (weeklyCapacityMinutes(input.workingMinutes) === 0) {
    return fail('invalid', 'Give this person at least one working day.', 'workingMinutes.mon')
  }

  const db = await getDb()

  // Logged history is never destroyed by a contract change, but the user should know
  // it now sits outside the contract.
  const warnings: Warning[] = []
  const outside = await db.execute<{ n: number; first: string | null }>(sql`
    select count(*)::int as n, min(entry_date)::text as first
    from time_entries
    where member_id = ${memberId.data}
      and (entry_date < ${input.contractStart}
           ${input.contractEnd ? sql`or entry_date > ${input.contractEnd}` : sql``})
  `)
  const outsideRow = (outside.rows as unknown as { n: number; first: string | null }[])[0]
  if (outsideRow && Number(outsideRow.n) > 0) {
    warnings.push({
      code: 'over_capacity',
      message: `${outsideRow.n} logged day(s) now fall outside these contract dates, starting ${outsideRow.first}. The hours are kept — availability after the change is zero on those days.`,
    })
  }

  try {
    const updated = await db
      .update(members)
      .set(input)
      .where(eq(members.id, memberId.data))
      .returning({ id: members.id })
    if (updated.length === 0) return fail('not_found', 'That member no longer exists.')
  } catch (error) {
    if (isUniqueViolation(error, 'members_email_unique')) {
      return fail('duplicate', 'Somebody already uses that email address.', 'email')
    }
    throw error
  }

  revalidateMemberViews(memberId.data)
  return ok(undefined, warnings)
}

export async function archiveMember(memberId: string, archived: boolean): Promise<ActionResult<undefined>> {
  const guard = await requireCapability('manage_members')
  if (!('ctx' in guard)) return guard

  const id = readId(memberId)
  if (!id) return fail('not_found', 'That member could not be identified.')
  if (guard.ctx.actingMember.id === id && archived) {
    return fail('invalid', 'You cannot archive the member you are currently acting as.')
  }

  const db = await getDb()
  const updated = await db
    .update(members)
    .set({ archivedAt: archived ? sql`now()` : null })
    .where(eq(members.id, id))
    .returning({ id: members.id })
  if (updated.length === 0) return fail('not_found', 'That member no longer exists.')

  revalidateMemberViews(id)
  return ok()
}

export async function setMemberPin(
  memberId: string,
  pin: string,
): Promise<ActionResult<undefined>> {
  const guard = await requireCapability('manage_security')
  if (!('ctx' in guard)) return guard

  const id = readId(memberId)
  if (!id) return fail('not_found', 'That member could not be identified.')
  if (!/^\d{4,8}$/.test(pin)) return fail('invalid', 'A PIN is four to eight digits.', 'pin')

  const db = await getDb()
  const { hash, salt } = hashSecret(pin)
  const updated = await db
    .update(members)
    .set({ pinHash: hash, pinSalt: salt, pinFailedCount: 0, pinLockedUntil: null })
    .where(eq(members.id, id))
    .returning({ id: members.id })
  if (updated.length === 0) return fail('not_found', 'That member no longer exists.')
  revalidateMemberViews(id)
  return ok()
}

/* ------------------------------------------------------------------ leave */

const leaveSchema = z
  .object({
    memberId: uuid,
    leaveType: leaveTypeSchema,
    startDate: isoDate,
    endDate: isoDate,
    /** Whole day or half day. A free-form minutes value is not an option. */
    portion: leavePortionSchema,
    note: optionalText(500),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'The last day cannot be before the first.',
    path: ['endDate'],
  })

export async function upsertLeave(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const guard = await requireCapability('manage_members')
  if (!('ctx' in guard)) return guard

  const parsed = leaveSchema.safeParse({
    memberId: formData.get('memberId'),
    leaveType: formData.get('leaveType'),
    startDate: formData.get('startDate'),
    endDate: formData.get('endDate'),
    portion: String(formData.get('portion') ?? 'full'),
    note: String(formData.get('note') ?? ''),
  })
  if (!parsed.success) return failValidation(parsed.error.issues)
  const input = parsed.data

  const db = await getDb()
  const leaveId = readId(String(formData.get('leaveId') ?? '').trim()) ?? ''

  const member = (
    await db.select({ name: members.name }).from(members).where(eq(members.id, input.memberId)).limit(1)
  )[0]
  if (!member) return fail('not_found', 'That member no longer exists.')

  /**
   * One date, one leave record. Two records covering the same day used to be accepted,
   * and a day carrying two half-days was then neither worked nor fully absent — the
   * availability gate could only apply one of them, leaving capacity a booking would
   * fill. Refusing the overlap is what makes that state unrepresentable.
   */
  const leaveClash = (
    await db
      .select({
        leaveType: leaveRecords.leaveType,
        startDate: leaveRecords.startDate,
        endDate: leaveRecords.endDate,
      })
      .from(leaveRecords)
      .where(
        and(
          eq(leaveRecords.memberId, input.memberId),
          lte(leaveRecords.startDate, input.endDate),
          gte(leaveRecords.endDate, input.startDate),
          leaveId ? ne(leaveRecords.id, leaveId) : undefined,
        ),
      )
      .limit(1)
  )[0]
  if (leaveClash) {
    const kind = LEAVE_TYPE_LABELS[leaveClash.leaveType].toLowerCase()
    return fail(
      'leave_overlap',
      `${member.name} already has ${kind} leave from ${leaveClash.startDate} to ${leaveClash.endDate}, which overlaps this range. A day holds one leave record — edit that one, or shorten these dates.`,
    )
  }

  if (leaveId) {
    await db
      .update(leaveRecords)
      .set({
        leaveType: input.leaveType,
        startDate: input.startDate,
        endDate: input.endDate,
        portion: input.portion,
        note: input.note,
      })
      .where(eq(leaveRecords.id, leaveId))
  } else {
    await db.insert(leaveRecords).values(input)
  }

  // Hours already logged inside the range are preserved and surfaced (edge cases).
  const warnings: Warning[] = []
  const clash = await db.execute<{ minutes: number; days: number }>(sql`
    select coalesce(sum(minutes), 0)::bigint as minutes, count(distinct entry_date)::int as days
    from time_entries
    where member_id = ${input.memberId}
      and entry_date between ${input.startDate} and ${input.endDate}
  `)
  const clashRow = (clash.rows as unknown as { minutes: number; days: number }[])[0]
  if (clashRow && Number(clashRow.minutes) > 0) {
    warnings.push({
      code: 'holiday_conflict',
      date: input.startDate,
      message: `${clashRow.days} day(s) in this leave range already have time logged. Those hours are kept — review them.`,
    })
  }

  revalidateMemberViews(input.memberId)
  return ok(undefined, warnings)
}

export async function deleteLeave(leaveId: string): Promise<ActionResult<undefined>> {
  const guard = await requireCapability('manage_members')
  if (!('ctx' in guard)) return guard

  const id = readId(leaveId)
  if (!id) return fail('not_found', 'That leave record could not be identified.')
  const db = await getDb()
  const deleted = await db
    .delete(leaveRecords)
    .where(eq(leaveRecords.id, id))
    .returning({ memberId: leaveRecords.memberId })
  if (deleted.length === 0) return fail('not_found', 'That leave record no longer exists.')
  revalidateMemberViews(deleted[0]!.memberId)
  return ok()
}

/* ------------------------------------------------------------------ helpers */

