'use server'
import { and, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { bookings, members, notifications, projectRoles, projects, roleAssignments } from '@/lib/db/schema'
import { requireCapability } from '@/lib/auth/context'
import { loadRoleConsumption } from '@/lib/db/queries/consumption'
import { loadCapacityContexts, dailyAvailability } from '@/lib/db/queries/capacity-context'
import { eachDay } from '@/lib/domain/dates'
import { amountCents } from '@/lib/domain/money'
import { overCapacityWarning, overCommitmentWarning, summarizeDayWarnings, type Warning } from '@/lib/domain/guardrails'
import {
  bookingStatusSchema, isoDate, minutesFromInput, optionalText, readId, uuid,
} from '@/lib/validation/schemas'
import { fail, failValidation, ok, type ActionResult } from './result'

const bookingSchema = z
  .object({
    memberId: uuid,
    projectRoleId: uuid,
    startDate: isoDate,
    endDate: isoDate,
    minutesPerDay: minutesFromInput().pipe(z.number().int().min(1, 'Book at least some time.')),
    status: bookingStatusSchema,
    note: optionalText(500),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'The last day cannot be before the first.',
    path: ['endDate'],
  })

function readBookingForm(formData: FormData) {
  return {
    memberId: String(formData.get('memberId') ?? ''),
    projectRoleId: String(formData.get('projectRoleId') ?? ''),
    startDate: String(formData.get('startDate') ?? ''),
    endDate: String(formData.get('endDate') ?? ''),
    minutesPerDay: String(formData.get('minutesPerDay') ?? ''),
    status: String(formData.get('status') ?? 'confirmed'),
    note: String(formData.get('note') ?? ''),
  }
}

function revalidatePlanner(projectId?: string) {
  for (const path of ['/', '/planner', '/timesheet', '/projects', '/status']) revalidatePath(path)
  if (projectId) revalidatePath(`/projects/${projectId}`)
}

export async function upsertBooking(
  _prev: ActionResult<{ bookingId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ bookingId: string }>> {
  const guard = await requireCapability('manage_bookings')
  if (!('ctx' in guard)) return guard

  const parsed = bookingSchema.safeParse(readBookingForm(formData))
  if (!parsed.success) return failValidation(parsed.error.issues)
  const input = parsed.data
  const bookingId = String(formData.get('bookingId') ?? '').trim()

  const db = await getDb()

  const member = (await db.select().from(members).where(eq(members.id, input.memberId)).limit(1))[0]
  if (!member) return fail('not_found', 'That member no longer exists.')
  if (member.archivedAt) return fail('forbidden', `${member.name} is archived and cannot be booked.`)

  const role = (
    await db
      .select({
        id: projectRoles.id,
        name: projectRoles.name,
        rateCents: projectRoles.rateCents,
        projectId: projects.id,
        projectName: projects.name,
      })
      .from(projectRoles)
      .innerJoin(projects, eq(projects.id, projectRoles.projectId))
      .where(eq(projectRoles.id, input.projectRoleId))
      .limit(1)
  )[0]
  if (!role) return fail('not_found', 'That project role no longer exists.')

  const assigned = await db
    .select({ id: roleAssignments.id })
    .from(roleAssignments)
    .where(
      and(eq(roleAssignments.memberId, input.memberId), eq(roleAssignments.projectRoleId, input.projectRoleId)),
    )
    .limit(1)
  if (assigned.length === 0) {
    return fail(
      'not_assigned',
      `${member.name} is not assigned to ${role.projectName} · ${role.name}. Add the assignment on the project first.`,
    )
  }

  /* guardrails: warn, never block */
  const warnings: Warning[] = []
  const capacities = await loadCapacityContexts(db, {
    from: input.startDate,
    to: input.endDate,
    memberIds: [input.memberId],
    includeArchived: true,
  })
  const capacity = capacities.get(input.memberId)
  let effectiveMinutes = 0
  if (capacity) {
    const availability = new Map(
      dailyAvailability(capacity, input.startDate, input.endDate).map((day) => [day.date, day.minutes]),
    )
    const existing = await db
      .select({
        startDate: bookings.startDate,
        endDate: bookings.endDate,
        minutesPerDay: bookings.minutesPerDay,
        id: bookings.id,
        status: bookings.status,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.memberId, input.memberId),
          sql`${bookings.startDate} <= ${input.endDate}`,
          sql`${bookings.endDate} >= ${input.startDate}`,
        ),
      )

    for (const date of eachDay(input.startDate, input.endDate)) {
      const available = availability.get(date) ?? 0
      if (available <= 0) continue
      effectiveMinutes += Math.min(input.minutesPerDay, available)
      const others = existing
        .filter((b) => b.id !== bookingId && date >= b.startDate && date <= b.endDate)
        .reduce((sum, b) => sum + Math.min(b.minutesPerDay, available), 0)
      const warning = overCapacityWarning({
        date,
        usedMinutes: others + Math.min(input.minutesPerDay, available),
        availableMinutes: available,
        dateLabel: `${member.name} · ${date}`,
      })
      if (warning) warnings.push(warning)
    }
  }

  if (input.status === 'confirmed') {
    const { byRole } = await loadRoleConsumption(db, {
      asOf: guard.ctx.today,
      roleIds: [input.projectRoleId],
      // Editing: this booking's own committed minutes must not be counted against the
      // replacement it is being turned into.
      ...(bookingId ? { excludeBookingIds: [bookingId] } : {}),
    })
    const consumption = byRole.get(input.projectRoleId)
    if (consumption && consumption.budgetCents > 0) {
      const warning = overCommitmentWarning({
        roleName: role.name,
        projectName: role.projectName,
        proposalCents: amountCents(effectiveMinutes, role.rateCents),
        remainingCents: consumption.budget.remainingCents,
        currency: guard.ctx.settings.currency,
      })
      if (warning) warnings.push(warning)
    }
  }

  const values = {
    memberId: input.memberId,
    projectRoleId: input.projectRoleId,
    startDate: input.startDate,
    endDate: input.endDate,
    minutesPerDay: input.minutesPerDay,
    status: input.status,
    note: input.note,
    createdByMemberId: guard.ctx.actingMember.id,
  }

  if (bookingId) {
    const updated = await db
      .update(bookings)
      .set(values)
      .where(eq(bookings.id, bookingId))
      .returning({ id: bookings.id })
    if (updated.length === 0) return fail('not_found', 'That booking no longer exists.')
    revalidatePlanner(role.projectId)
    return ok({ bookingId }, summarizeDayWarnings(warnings))
  }

  const inserted = await db.insert(bookings).values(values).returning({ id: bookings.id })
  const created = inserted[0]
  if (!created) return fail('invalid', 'The booking could not be created.')

  // Booking somebody onto new work notifies them (FR-031).
  await db.insert(notifications).values({
    memberId: input.memberId,
    kind: 'booked',
    title: `Booked on ${role.projectName}`,
    body: `${input.minutesPerDay / 60}h per day from ${input.startDate} to ${input.endDate} as ${role.name}${
      input.status === 'tentative' ? ' (tentative)' : ''
    }.`,
    link: '/planner',
  })

  revalidatePlanner(role.projectId)
  return ok({ bookingId: created.id }, summarizeDayWarnings(warnings))
}

export async function deleteBooking(bookingId: string): Promise<ActionResult<undefined>> {
  const guard = await requireCapability('manage_bookings')
  if (!('ctx' in guard)) return guard

  const id = readId(bookingId)
  if (!id) return fail('not_found', 'That booking could not be identified.')
  const db = await getDb()
  const deleted = await db
    .delete(bookings)
    .where(eq(bookings.id, id))
    .returning({ projectRoleId: bookings.projectRoleId })
  if (deleted.length === 0) return fail('not_found', 'That booking no longer exists.')
  revalidatePlanner()
  return ok()
}

export type BudgetProbe = {
  roleName: string
  projectName: string
  currency: string
  budgetCents: number
  deliveredCents: number
  committedCents: number
  remainingCents: number
  proposalCents: number
  proposalMinutes: number
  wouldExceedBy: number
}

/**
 * The planner's on-the-spot budget answer (SC-004): read-only, no writes, so it can be
 * called while the user is still choosing dates.
 *
 * `excludeBookingId` is what makes the answer right while EDITING: without it the
 * booking being replaced is still in `committedCents`, and the probe reports the old
 * booking plus its own replacement.
 */
export async function checkRoleBudget(input: {
  memberId: string
  projectRoleId: string
  startDate: string
  endDate: string
  minutesPerDay: number
  excludeBookingId?: string
}): Promise<ActionResult<BudgetProbe>> {
  const guard = await requireCapability('manage_bookings')
  if (!('ctx' in guard)) return guard

  const db = await getDb()
  const role = (
    await db
      .select({
        id: projectRoles.id,
        name: projectRoles.name,
        rateCents: projectRoles.rateCents,
        projectName: projects.name,
      })
      .from(projectRoles)
      .innerJoin(projects, eq(projects.id, projectRoles.projectId))
      .where(eq(projectRoles.id, input.projectRoleId))
      .limit(1)
  )[0]
  if (!role) return fail('not_found', 'That project role no longer exists.')

  const capacities = await loadCapacityContexts(db, {
    from: input.startDate,
    to: input.endDate,
    memberIds: [input.memberId],
    includeArchived: true,
  })
  const capacity = capacities.get(input.memberId)
  let proposalMinutes = 0
  if (capacity) {
    for (const day of dailyAvailability(capacity, input.startDate, input.endDate)) {
      if (day.minutes > 0) proposalMinutes += Math.min(input.minutesPerDay, day.minutes)
    }
  }

  const { byRole } = await loadRoleConsumption(db, {
    asOf: guard.ctx.today,
    roleIds: [input.projectRoleId],
    ...(input.excludeBookingId ? { excludeBookingIds: [input.excludeBookingId] } : {}),
  })
  const consumption = byRole.get(input.projectRoleId)
  const remainingCents = consumption?.budget.remainingCents ?? 0
  const proposalCents = amountCents(proposalMinutes, role.rateCents)

  return ok({
    roleName: role.name,
    projectName: role.projectName,
    currency: guard.ctx.settings.currency,
    budgetCents: consumption?.budgetCents ?? 0,
    deliveredCents: consumption?.budget.deliveredCents ?? 0,
    committedCents: consumption?.budget.committedCents ?? 0,
    remainingCents,
    proposalCents,
    proposalMinutes,
    wouldExceedBy: Math.max(0, proposalCents - remainingCents),
  })
}
