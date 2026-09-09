'use server'
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { invoices, members, projectRoles, projects, roleAssignments, timeEntries } from '@/lib/db/schema'
import { getWorkspaceContext, requirePortalMember } from '@/lib/auth/context'
import { can } from '@/lib/auth/permissions'
import { dayAvailability, type LeaveSpan } from '@/lib/domain/capacity'
import { eachDay, endOfWeek, isWithin, startOfWeek } from '@/lib/domain/dates'
import { overCapacityWarning, summarizeDayWarnings, type Warning } from '@/lib/domain/guardrails'
import { isoDate, uuid } from '@/lib/validation/schemas'
import { fail, ok, failValidation, type ActionResult } from './result'

const cellSchema = z.object({
  projectRoleId: uuid,
  date: isoDate,
  /** Zero clears the cell — the row is deleted rather than stored as zero. */
  minutes: z.number().int().min(0).max(1440),
  note: z.string().max(500).nullable().optional(),
})

const saveSchema = z.object({
  memberId: uuid,
  weekStart: isoDate,
  baseUpdatedAt: z.string().nullable(),
  cells: z.array(cellSchema).max(400),
  /** Present when the save comes from a private portal link. */
  portalToken: z.string().min(10).optional(),
})

export type SaveTimesheetInput = z.input<typeof saveSchema>
export type SaveTimesheetOutput = { savedCells: number; deletedCells: number; updatedAt: string | null }

/**
 * The central write of the product.
 *
 * One transaction for the whole week: all-or-nothing, so a single bad cell writes
 * nothing. Integrity rules refuse and name the offending record; guardrails warn and
 * let the save through.
 */
export async function saveTimesheetWeek(
  input: SaveTimesheetInput,
): Promise<ActionResult<SaveTimesheetOutput>> {
  const parsed = saveSchema.safeParse(input)
  if (!parsed.success) return failValidation(parsed.error.issues)
  const { memberId, weekStart: weekStartInput, baseUpdatedAt, cells, portalToken } = parsed.data

  /* ---------------- who is allowed to write this week ---------------- */
  let source: 'internal' | 'portal'
  let weekStartDay = 1

  if (portalToken) {
    const portal = await requirePortalMember(portalToken)
    if (!('ctx' in portal)) return portal
    // A portal session can only ever write its own member's week (FR-004).
    if (portal.ctx.member.id !== memberId) {
      return fail('forbidden', 'This link can only log time for its own owner.')
    }
    source = 'portal'
    weekStartDay = portal.ctx.settings.weekStartDay
  } else {
    const ctx = await getWorkspaceContext()
    if (!ctx?.actingMember) return fail('forbidden', 'Unlock the workspace and choose a member first.')
    if (!can(ctx.actingMember.role, 'log_time_for_others') && ctx.actingMember.id !== memberId) {
      return fail('forbidden', `${ctx.actingMember.name} cannot fill in other people's timesheets.`)
    }
    source = 'internal'
    weekStartDay = ctx.settings.weekStartDay
  }

  const weekStart = startOfWeek(weekStartInput, weekStartDay)
  const weekEnd = endOfWeek(weekStartInput, weekStartDay)

  for (const cell of cells) {
    if (!isWithin(cell.date, weekStart, weekEnd)) {
      return fail('invalid', `${cell.date} is not in the week beginning ${weekStart}.`)
    }
  }

  const db = await getDb()

  /* ---------------- the member and their real availability ---------------- */
  const memberRows = await db.select().from(members).where(eq(members.id, memberId)).limit(1)
  const member = memberRows[0]
  if (!member) return fail('not_found', 'That member no longer exists.')
  if (member.archivedAt) return fail('forbidden', `${member.name} is archived.`)

  const [holidayRows, leaveRows] = await Promise.all([
    member.holidayCalendarId
      ? db.execute<{ holiday_date: string; name: string }>(sql`
          select holiday_date::text, name from holidays
          where calendar_id = ${member.holidayCalendarId}
            and holiday_date between ${weekStart} and ${weekEnd}
        `)
      : Promise.resolve({ rows: [] as unknown[] }),
    db.execute<{ leave_type: string; start_date: string; end_date: string; portion: string }>(sql`
      select leave_type, start_date::text, end_date::text, portion from leave
      where member_id = ${memberId} and start_date <= ${weekEnd} and end_date >= ${weekStart}
    `),
  ])

  const holidayMap = new Map(
    (holidayRows.rows as unknown as { holiday_date: string; name: string }[]).map((h) => [h.holiday_date, h.name]),
  )
  const leaves: LeaveSpan[] = (
    leaveRows.rows as unknown as {
      leave_type: LeaveSpan['leaveType']
      start_date: string
      end_date: string
      portion: LeaveSpan['portion']
    }[]
  ).map((l) => ({
    leaveType: l.leave_type,
    startDate: l.start_date,
    endDate: l.end_date,
    portion: l.portion,
  }))

  const capacityMember = {
    workingMinutes: member.workingMinutes,
    contractStart: member.contractStart,
    contractEnd: member.contractEnd,
  }
  const availabilityByDate = new Map(
    eachDay(weekStart, weekEnd).map((date) => [
      date,
      dayAvailability(capacityMember, date, holidayMap, leaves),
    ]),
  )

  /* ---------------- existing state for this week ---------------- */
  const existingRows = await db
    .select({
      id: timeEntries.id,
      projectRoleId: timeEntries.projectRoleId,
      entryDate: timeEntries.entryDate,
      minutes: timeEntries.minutes,
      note: timeEntries.note,
      updatedAt: timeEntries.updatedAt,
      invoiceId: timeEntries.invoiceId,
      invoiceReference: invoices.reference,
    })
    .from(timeEntries)
    .leftJoin(invoices, eq(invoices.id, timeEntries.invoiceId))
    .where(
      and(
        eq(timeEntries.memberId, memberId),
        gte(timeEntries.entryDate, weekStart),
        lte(timeEntries.entryDate, weekEnd),
      ),
    )

  /* ---------------- concurrency (FR-024) ---------------- */
  const currentUpdatedAt =
    existingRows.length === 0
      ? null
      : existingRows.reduce(
          (latest, row) => (row.updatedAt > latest ? row.updatedAt : latest),
          existingRows[0]!.updatedAt,
        )
  const sameToken =
    (currentUpdatedAt === null && baseUpdatedAt === null) ||
    (currentUpdatedAt !== null && baseUpdatedAt !== null && Date.parse(currentUpdatedAt) === Date.parse(baseUpdatedAt))
  if (!sameToken) {
    return fail(
      'conflict',
      'Somebody else changed this week while you were editing it. Reload to see their version, then re-enter your changes.',
    )
  }

  const key = (roleId: string, date: string) => `${roleId}|${date}`
  const existingByCell = new Map(existingRows.map((row) => [key(row.projectRoleId, row.entryDate), row]))

  /* ---------------- assignments and role metadata ---------------- */
  const touchedRoleIds = [...new Set(cells.map((c) => c.projectRoleId))]
  const roleRows =
    touchedRoleIds.length === 0
      ? []
      : await db
          .select({
            id: projectRoles.id,
            name: projectRoles.name,
            projectName: projects.name,
            projectArchived: projects.archivedAt,
            roleArchived: projectRoles.archivedAt,
          })
          .from(projectRoles)
          .innerJoin(projects, eq(projects.id, projectRoles.projectId))
          .where(inArray(projectRoles.id, touchedRoleIds))
  const roleById = new Map(roleRows.map((r) => [r.id, r]))

  const assignedRows =
    touchedRoleIds.length === 0
      ? []
      : await db
          .select({ projectRoleId: roleAssignments.projectRoleId })
          .from(roleAssignments)
          .where(
            and(
              eq(roleAssignments.memberId, memberId),
              inArray(roleAssignments.projectRoleId, touchedRoleIds),
            ),
          )
  const assigned = new Set(assignedRows.map((r) => r.projectRoleId))

  /* ---------------- decide what to write, refusing anything that lies ---------------- */
  type Op =
    | { kind: 'insert'; roleId: string; date: string; minutes: number; note: string | null }
    | { kind: 'update'; id: string; minutes: number; note: string | null }
    | { kind: 'delete'; id: string }

  const ops: Op[] = []
  const dayTotals = new Map<string, number>()
  for (const row of existingRows) {
    dayTotals.set(row.entryDate, (dayTotals.get(row.entryDate) ?? 0) + row.minutes)
  }

  for (const cell of cells) {
    const existing = existingByCell.get(key(cell.projectRoleId, cell.date))
    const role = roleById.get(cell.projectRoleId)
    if (!role) return fail('not_found', 'One of those project roles no longer exists.')

    // Invoiced work is immutable, and the refusal names the invoice (FR-022).
    if (existing?.invoiceId) {
      const unchanged = existing.minutes === cell.minutes && (existing.note ?? null) === (cell.note ?? null)
      if (unchanged) continue
      return fail(
        'already_invoiced',
        `${role.projectName} · ${role.name} on ${cell.date} was invoiced as ${existing.invoiceReference ?? 'an invoice'} and can no longer be changed.`,
      )
    }

    const previous = existing?.minutes ?? 0
    dayTotals.set(cell.date, (dayTotals.get(cell.date) ?? 0) - previous + cell.minutes)

    if (cell.minutes === 0) {
      if (existing) ops.push({ kind: 'delete', id: existing.id })
      continue
    }

    const availability = availabilityByDate.get(cell.date)
    if (!availability || availability.minutes === 0) {
      const reason = availability?.reason
      if (reason === 'before_contract' || reason === 'after_contract') {
        return fail(
          'outside_contract',
          `${cell.date} is outside ${member.name}'s contract dates (${member.contractStart}${
            member.contractEnd ? ` to ${member.contractEnd}` : ' onwards'
          }).`,
        )
      }
      return fail(
        'locked_day',
        `${cell.date} cannot be logged: ${availability?.label ?? 'it is not a working day'}.`,
      )
    }

    if (!assigned.has(cell.projectRoleId)) {
      return fail(
        'not_assigned',
        `${member.name} is not assigned to ${role.projectName} · ${role.name}. Ask for the assignment first — existing hours are unaffected.`,
      )
    }
    if (role.projectArchived || role.roleArchived) {
      return fail('invalid', `${role.projectName} · ${role.name} is archived and cannot take new hours.`)
    }

    if (existing) {
      if (existing.minutes === cell.minutes && (existing.note ?? null) === (cell.note ?? null)) continue
      ops.push({ kind: 'update', id: existing.id, minutes: cell.minutes, note: cell.note ?? null })
    } else {
      ops.push({
        kind: 'insert',
        roleId: cell.projectRoleId,
        date: cell.date,
        minutes: cell.minutes,
        note: cell.note ?? null,
      })
    }
  }

  /* ---------------- guardrails: warn, never block ---------------- */
  const warnings: Warning[] = []
  for (const [date, used] of dayTotals) {
    const availability = availabilityByDate.get(date)
    if (!availability) continue
    const warning = overCapacityWarning({
      date,
      usedMinutes: used,
      availableMinutes: availability.minutes,
      dateLabel: date,
    })
    if (warning) warnings.push(warning)
  }

  if (ops.length === 0) {
    return ok(
      { savedCells: 0, deletedCells: 0, updatedAt: currentUpdatedAt },
      summarizeDayWarnings(warnings),
    )
  }

  /* ---------------- one transaction for the whole week ---------------- */
  await db.transaction(async (tx) => {
    for (const op of ops) {
      if (op.kind === 'delete') {
        await tx.delete(timeEntries).where(eq(timeEntries.id, op.id))
      } else if (op.kind === 'update') {
        await tx
          .update(timeEntries)
          .set({ minutes: op.minutes, note: op.note, updatedAt: sql`now()`, source })
          .where(eq(timeEntries.id, op.id))
      } else {
        await tx.insert(timeEntries).values({
          memberId,
          projectRoleId: op.roleId,
          entryDate: op.date,
          minutes: op.minutes,
          note: op.note,
          source,
        })
      }
    }
  })

  const latest = await db.execute<{ updated_at: string | null }>(sql`
    select max(updated_at)::text as updated_at from time_entries
    where member_id = ${memberId} and entry_date between ${weekStart} and ${weekEnd}
  `)
  const updatedAt = (latest.rows as unknown as { updated_at: string | null }[])[0]?.updated_at ?? null

  for (const path of ['/', '/timesheet', '/billing', '/reports', '/status', '/planner', '/projects']) {
    revalidatePath(path)
  }
  if (portalToken) revalidatePath(`/portal/${portalToken}`)

  return ok(
    {
      savedCells: ops.filter((o) => o.kind !== 'delete').length,
      deletedCells: ops.filter((o) => o.kind === 'delete').length,
      updatedAt,
    },
    summarizeDayWarnings(warnings),
  )
}
