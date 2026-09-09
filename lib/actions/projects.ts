'use server'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { clients, projectRoles, projects, roleAssignments, timeEntries } from '@/lib/db/schema'
import { isUniqueViolation } from '@/lib/db/errors'
import { requireCapability } from '@/lib/auth/context'
import { canTouchProject } from '@/lib/auth/permissions'
import { amountCents } from '@/lib/domain/money'
import { nonBillableWarning, rateChangeWarning, type Warning } from '@/lib/domain/guardrails'
import {
  billingMethodSchema, centsFromInput, colorSchema, isoDate, minutesFromInput, optionalText, uuid, readId,} from '@/lib/validation/schemas'
import { fail, failValidation, ok, type ActionResult } from './result'
import { priceCents } from '@/lib/db/sql-money'

function revalidateProjectViews(projectId?: string) {
  for (const path of ['/', '/projects', '/billing', '/planner', '/status', '/reports']) {
    revalidatePath(path)
  }
  if (projectId) revalidatePath(`/projects/${projectId}`)
}

/* ------------------------------------------------------------------ clients */

const clientSchema = z.object({
  name: z.string().trim().min(1, 'A client name is required.').max(160),
  color: colorSchema,
  contactEmail: z
    .string()
    .trim()
    .max(200)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .refine((v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'That is not an email address.'),
  notes: optionalText(2000),
})

function readClientForm(formData: FormData) {
  return {
    name: String(formData.get('name') ?? ''),
    color: String(formData.get('color') ?? 'var(--hue-2)'),
    contactEmail: String(formData.get('contactEmail') ?? ''),
    notes: String(formData.get('notes') ?? ''),
  }
}

export async function createClient(
  _prev: ActionResult<{ clientId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ clientId: string }>> {
  const guard = await requireCapability('manage_projects')
  if (!('ctx' in guard)) return guard
  const parsed = clientSchema.safeParse(readClientForm(formData))
  if (!parsed.success) return failValidation(parsed.error.issues)

  const db = await getDb()
  try {
    const inserted = await db.insert(clients).values(parsed.data).returning({ id: clients.id })
    revalidateProjectViews()
    return ok({ clientId: inserted[0]!.id })
  } catch (error) {
    if (isUniqueViolation(error, 'clients_name_unique')) {
      return fail('duplicate', 'A client with that name already exists.', 'name')
    }
    throw error
  }
}

export async function updateClient(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const guard = await requireCapability('manage_projects')
  if (!('ctx' in guard)) return guard
  const clientId = uuid.safeParse(formData.get('clientId'))
  if (!clientId.success) return fail('not_found', 'That client could not be identified.')
  const parsed = clientSchema.safeParse(readClientForm(formData))
  if (!parsed.success) return failValidation(parsed.error.issues)

  const db = await getDb()
  try {
    const updated = await db
      .update(clients)
      .set(parsed.data)
      .where(eq(clients.id, clientId.data))
      .returning({ id: clients.id })
    if (updated.length === 0) return fail('not_found', 'That client no longer exists.')
  } catch (error) {
    if (isUniqueViolation(error, 'clients_name_unique')) {
      return fail('duplicate', 'A client with that name already exists.', 'name')
    }
    throw error
  }
  revalidateProjectViews()
  return ok()
}

export async function archiveClient(clientId: string, archived: boolean): Promise<ActionResult<undefined>> {
  const guard = await requireCapability('manage_projects')
  if (!('ctx' in guard)) return guard

  const id = readId(clientId)
  if (!id) return fail('not_found', 'That client could not be identified.')
  const db = await getDb()

  if (archived) {
    const live = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from projects
      where client_id = ${id} and archived_at is null
    `)
    const n = Number((live.rows as unknown as { n: number }[])[0]?.n ?? 0)
    if (n > 0) {
      return fail(
        'invalid',
        `${n} active project(s) still belong to this client. Archive those first.`,
      )
    }
  }

  const updated = await db
    .update(clients)
    .set({ archivedAt: archived ? sql`now()` : null })
    .where(eq(clients.id, id))
    .returning({ id: clients.id })
  if (updated.length === 0) return fail('not_found', 'That client no longer exists.')
  revalidateProjectViews()
  return ok()
}

/* ------------------------------------------------------------------ projects */

const projectSchema = z.object({
  clientId: uuid,
  name: z.string().trim().min(1, 'A project name is required.').max(160),
  code: z
    .string()
    .trim()
    .max(32)
    .transform((v) => (v === '' ? null : v.toUpperCase()))
    .nullable(),
  color: colorSchema,
  billable: z.boolean(),
  billingMethod: billingMethodSchema,
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  ownerMemberId: uuid.nullable(),
  notes: optionalText(4000),
})

function readProjectForm(formData: FormData) {
  const nullable = (name: string) => {
    const raw = String(formData.get(name) ?? '').trim()
    return raw === '' || raw === 'none' ? null : raw
  }
  return {
    clientId: String(formData.get('clientId') ?? ''),
    name: String(formData.get('name') ?? ''),
    code: String(formData.get('code') ?? ''),
    color: String(formData.get('color') ?? 'var(--hue-3)'),
    billable: formData.get('billable') === 'on' || formData.get('billable') === 'true',
    billingMethod: String(formData.get('billingMethod') ?? 'time_and_materials'),
    startDate: nullable('startDate'),
    endDate: nullable('endDate'),
    ownerMemberId: nullable('ownerMemberId'),
    notes: String(formData.get('notes') ?? ''),
  }
}

export async function createProject(
  _prev: ActionResult<{ projectId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ projectId: string }>> {
  const guard = await requireCapability('manage_projects')
  if (!('ctx' in guard)) return guard
  const parsed = projectSchema.safeParse(readProjectForm(formData))
  if (!parsed.success) return failValidation(parsed.error.issues)
  const input = parsed.data
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    return fail('invalid', 'The end date cannot be before the start date.', 'endDate')
  }

  const db = await getDb()
  try {
    const inserted = await db.insert(projects).values(input).returning({ id: projects.id })
    revalidateProjectViews(inserted[0]!.id)
    return ok({ projectId: inserted[0]!.id })
  } catch (error) {
    if (isUniqueViolation(error, 'projects_code_unique')) {
      return fail('duplicate', 'That project code is already in use.', 'code')
    }
    throw error
  }
}

export async function updateProject(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const guard = await requireCapability('manage_projects')
  if (!('ctx' in guard)) return guard
  const projectId = uuid.safeParse(formData.get('projectId'))
  if (!projectId.success) return fail('not_found', 'That project could not be identified.')

  const parsed = projectSchema.safeParse(readProjectForm(formData))
  if (!parsed.success) return failValidation(parsed.error.issues)
  const input = parsed.data
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    return fail('invalid', 'The end date cannot be before the start date.', 'endDate')
  }

  const db = await getDb()
  const existing = await db
    .select({ id: projects.id, name: projects.name, billable: projects.billable, ownerMemberId: projects.ownerMemberId })
    .from(projects)
    .where(eq(projects.id, projectId.data))
    .limit(1)
  const project = existing[0]
  if (!project) return fail('not_found', 'That project no longer exists.')

  if (!canTouchProject(guard.ctx.actingMember.role, guard.ctx.actingMember.id, project)) {
    return fail('forbidden', `${project.name} belongs to another manager.`)
  }

  const warnings: Warning[] = []
  if (project.billable && !input.billable) {
    const unbilled = await unbilledCentsForProject(db, projectId.data)
    const warning = nonBillableWarning({
      projectName: project.name,
      unbilledCents: unbilled,
      currency: guard.ctx.settings.currency,
    })
    if (warning) warnings.push(warning)
  }

  try {
    await db.update(projects).set(input).where(eq(projects.id, projectId.data))
  } catch (error) {
    if (isUniqueViolation(error, 'projects_code_unique')) {
      return fail('duplicate', 'That project code is already in use.', 'code')
    }
    throw error
  }

  revalidateProjectViews(projectId.data)
  return ok(undefined, warnings)
}

export async function archiveProject(projectId: string, archived: boolean): Promise<ActionResult<undefined>> {
  const guard = await requireCapability('manage_projects')
  if (!('ctx' in guard)) return guard

  const id = readId(projectId)
  if (!id) return fail('not_found', 'That project could not be identified.')
  const db = await getDb()
  const existing = await db
    .select({ id: projects.id, name: projects.name, ownerMemberId: projects.ownerMemberId })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1)
  const project = existing[0]
  if (!project) return fail('not_found', 'That project no longer exists.')
  if (!canTouchProject(guard.ctx.actingMember.role, guard.ctx.actingMember.id, project)) {
    return fail('forbidden', `${project.name} belongs to another manager.`)
  }

  await db
    .update(projects)
    .set({ archivedAt: archived ? sql`now()` : null })
    .where(eq(projects.id, id))
  revalidateProjectViews(id)
  return ok()
}

/* ------------------------------------------------------------------ roles */

const roleSchema = z.object({
  projectId: uuid,
  name: z.string().trim().min(1, 'A role name is required.').max(120),
  rateCents: centsFromInput,
  budgetCents: centsFromInput,
  budgetMinutes: minutesFromInput(100_000).nullable(),
  sortOrder: z.number().int().min(0).max(999),
})

export async function upsertProjectRole(
  _prev: ActionResult<{ roleId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ roleId: string }>> {
  const guard = await requireCapability('manage_projects')
  if (!('ctx' in guard)) return guard

  const budgetHours = String(formData.get('budgetMinutes') ?? '').trim()
  const parsed = roleSchema.safeParse({
    projectId: String(formData.get('projectId') ?? ''),
    name: String(formData.get('name') ?? ''),
    rateCents: String(formData.get('rateCents') ?? '0'),
    budgetCents: String(formData.get('budgetCents') ?? '0'),
    budgetMinutes: budgetHours === '' ? null : budgetHours,
    sortOrder: Number(String(formData.get('sortOrder') ?? '0')),
  })
  if (!parsed.success) return failValidation(parsed.error.issues)
  const input = parsed.data

  const db = await getDb()
  const project = (
    await db
      .select({ id: projects.id, name: projects.name, ownerMemberId: projects.ownerMemberId })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1)
  )[0]
  if (!project) return fail('not_found', 'That project no longer exists.')
  if (!canTouchProject(guard.ctx.actingMember.role, guard.ctx.actingMember.id, project)) {
    return fail('forbidden', `${project.name} belongs to another manager.`)
  }

  const roleId = String(formData.get('roleId') ?? '').trim()
  const warnings: Warning[] = []

  try {
    if (roleId) {
      const before = (
        await db
          .select({ rateCents: projectRoles.rateCents, name: projectRoles.name })
          .from(projectRoles)
          .where(eq(projectRoles.id, roleId))
          .limit(1)
      )[0]
      if (!before) return fail('not_found', 'That role no longer exists.')

      if (before.rateCents !== input.rateCents) {
        // A rate correction re-prices unbilled work by design; say so out loud.
        const unbilled = await unbilledMinutesForRole(db, roleId)
        const warning = rateChangeWarning({
          roleName: input.name,
          beforeCents: amountCents(unbilled, before.rateCents),
          afterCents: amountCents(unbilled, input.rateCents),
          currency: guard.ctx.settings.currency,
        })
        if (warning) warnings.push(warning)
      }

      await db
        .update(projectRoles)
        .set({
          name: input.name,
          rateCents: input.rateCents,
          budgetCents: input.budgetCents,
          budgetMinutes: input.budgetMinutes,
          sortOrder: input.sortOrder,
        })
        .where(eq(projectRoles.id, roleId))
      revalidateProjectViews(input.projectId)
      return ok({ roleId }, warnings)
    }

    const inserted = await db.insert(projectRoles).values(input).returning({ id: projectRoles.id })
    revalidateProjectViews(input.projectId)
    return ok({ roleId: inserted[0]!.id })
  } catch (error) {
    if (isUniqueViolation(error, 'project_roles_name_unique')) {
      return fail('duplicate', 'That role already exists on this project.', 'name')
    }
    throw error
  }
}

export async function archiveProjectRole(roleId: string, archived: boolean): Promise<ActionResult<undefined>> {
  const guard = await requireCapability('manage_projects')
  if (!('ctx' in guard)) return guard

  const id = readId(roleId)
  if (!id) return fail('not_found', 'That role could not be identified.')

  const db = await getDb()
  // Scope before the write: a Project Manager may not archive a role on somebody
  // else's engagement.
  const owning = (
    await db
      .select({
        roleName: projectRoles.name,
        projectId: projects.id,
        projectName: projects.name,
        ownerMemberId: projects.ownerMemberId,
      })
      .from(projectRoles)
      .innerJoin(projects, eq(projects.id, projectRoles.projectId))
      .where(eq(projectRoles.id, id))
      .limit(1)
  )[0]
  if (!owning) return fail('not_found', 'That role no longer exists.')
  if (!canTouchProject(guard.ctx.actingMember.role, guard.ctx.actingMember.id, owning)) {
    return fail('forbidden', `${owning.projectName} belongs to another manager.`)
  }

  await db
    .update(projectRoles)
    .set({ archivedAt: archived ? sql`now()` : null })
    .where(eq(projectRoles.id, id))
  revalidateProjectViews(owning.projectId)
  return ok()
}

export async function setRoleAssignments(
  projectRoleId: string,
  memberIds: string[],
): Promise<ActionResult<{ removedWithHistory: number }>> {
  const guard = await requireCapability('manage_assignments')
  if (!('ctx' in guard)) return guard

  const id = readId(projectRoleId)
  if (!id) return fail('not_found', 'That role could not be identified.')

  const db = await getDb()
  const role = (
    await db
      .select({ id: projectRoles.id, projectId: projectRoles.projectId, name: projectRoles.name })
      .from(projectRoles)
      .where(eq(projectRoles.id, id))
      .limit(1)
  )[0]
  if (!role) return fail('not_found', 'That role no longer exists.')

  const project = (
    await db
      .select({ id: projects.id, name: projects.name, ownerMemberId: projects.ownerMemberId })
      .from(projects)
      .where(eq(projects.id, role.projectId))
      .limit(1)
  )[0]
  if (!project) return fail('not_found', 'That project no longer exists.')
  if (!canTouchProject(guard.ctx.actingMember.role, guard.ctx.actingMember.id, project)) {
    return fail('forbidden', `${project.name} belongs to another manager.`)
  }

  const current = await db
    .select({ memberId: roleAssignments.memberId })
    .from(roleAssignments)
    .where(eq(roleAssignments.projectRoleId, id))
  const currentIds = new Set(current.map((c) => c.memberId))
  const nextIds = new Set(memberIds)

  const removed = [...currentIds].filter((id) => !nextIds.has(id))
  const added = [...nextIds].filter((id) => !currentIds.has(id))

  // Removing somebody who already logged time keeps their history and only blocks
  // new entries (edge cases in the spec).
  let removedWithHistory = 0
  if (removed.length > 0) {
    const res = await db.execute<{ n: number }>(sql`
      select count(distinct member_id)::int as n from time_entries
      where project_role_id = ${id} and member_id in ${removed}
    `)
    removedWithHistory = Number((res.rows as unknown as { n: number }[])[0]?.n ?? 0)
    await db
      .delete(roleAssignments)
      .where(and(eq(roleAssignments.projectRoleId, id), inArray(roleAssignments.memberId, removed)))
  }
  if (added.length > 0) {
    await db
      .insert(roleAssignments)
      .values(added.map((memberId) => ({ projectRoleId: id, memberId })))
      .onConflictDoNothing()
  }

  revalidateProjectViews(role.projectId)
  revalidatePath('/timesheet')
  return ok(
    { removedWithHistory },
    removedWithHistory > 0
      ? [
          {
            code: 'over_capacity',
            message: `${removedWithHistory} person(s) removed from ${role.name} have already logged time. Their history stays and remains billable; they simply cannot add new entries.`,
          },
        ]
      : undefined,
  )
}

/* ------------------------------------------------------------------ helpers */

async function unbilledCentsForProject(db: Awaited<ReturnType<typeof getDb>>, projectId: string) {
  const res = await db.execute<{ cents: number }>(sql`
    select coalesce(sum(${priceCents()}), 0)::bigint as cents
    from time_entries te
    join project_roles pr on pr.id = te.project_role_id
    where pr.project_id = ${projectId} and te.invoice_id is null
  `)
  return Number((res.rows as unknown as { cents: number }[])[0]?.cents ?? 0)
}

async function unbilledMinutesForRole(db: Awaited<ReturnType<typeof getDb>>, roleId: string) {
  const res = await db.execute<{ minutes: number }>(sql`
    select coalesce(sum(minutes), 0)::bigint as minutes
    from time_entries where project_role_id = ${roleId} and invoice_id is null
  `)
  return Number((res.rows as unknown as { minutes: number }[])[0]?.minutes ?? 0)
}
