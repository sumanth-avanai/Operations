'use server'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { projectHealthUpdates, projects } from '@/lib/db/schema'
import { requireCapability } from '@/lib/auth/context'
import { canTouchProject } from '@/lib/auth/permissions'
import { isoDate, optionalText, projectStatusSchema, riskLevelSchema, uuid } from '@/lib/validation/schemas'
import { fail, failValidation, ok, type ActionResult } from './result'

const healthSchema = z.object({
  projectId: uuid,
  updateDate: isoDate,
  status: projectStatusSchema,
  risk: riskLevelSchema,
  satisfaction: z.number().int().min(1).max(5).nullable(),
  comment: optionalText(2000),
})

/**
 * Health updates are append-only: the newest row IS the project's current status, and
 * the whole list is the history. Nothing is ever overwritten (FR-045).
 */
export async function recordHealthUpdate(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const guard = await requireCapability('manage_health')
  if (!('ctx' in guard)) return guard

  const satisfaction = String(formData.get('satisfaction') ?? '').trim()
  const parsed = healthSchema.safeParse({
    projectId: formData.get('projectId'),
    updateDate: String(formData.get('updateDate') ?? ''),
    status: formData.get('status'),
    risk: formData.get('risk'),
    satisfaction: satisfaction === '' || satisfaction === 'none' ? null : Number(satisfaction),
    comment: String(formData.get('comment') ?? ''),
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

  await db.insert(projectHealthUpdates).values({
    ...input,
    authorMemberId: guard.ctx.actingMember.id,
  })

  for (const path of ['/', '/status', '/projects', `/projects/${input.projectId}`]) {
    revalidatePath(path)
  }
  return ok()
}
