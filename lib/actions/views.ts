'use server'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { savedViews } from '@/lib/db/schema'
import { isUniqueViolation } from '@/lib/db/errors'
import { requireCapability } from '@/lib/auth/context'
import { can } from '@/lib/auth/permissions'
import { readId } from '@/lib/validation/schemas'
import { fail, failValidation, ok, type ActionResult } from './result'

const viewSchema = z.object({
  panel: z.enum(['reports', 'billing']),
  name: z.string().trim().min(1, 'Give the view a name.').max(80),
  config: z.record(z.string(), z.string()),
})

/** A saved view is exactly the search params that produced it, so it restores exactly. */
export async function saveView(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const guard = await requireCapability('view_reports')
  if (!('ctx' in guard)) return guard

  let config: Record<string, string> = {}
  try {
    config = JSON.parse(String(formData.get('config') ?? '{}')) as Record<string, string>
  } catch {
    return fail('invalid', 'That view configuration could not be read.')
  }

  const parsed = viewSchema.safeParse({
    panel: String(formData.get('panel') ?? 'reports'),
    name: String(formData.get('name') ?? ''),
    config,
  })
  if (!parsed.success) return failValidation(parsed.error.issues)

  const db = await getDb()
  try {
    const inserted = await db
      .insert(savedViews)
      .values({ ...parsed.data, ownerMemberId: guard.ctx.actingMember.id })
      .returning({ id: savedViews.id })
    revalidatePath(`/${parsed.data.panel}`)
    return ok({ id: inserted[0]!.id })
  } catch (error) {
    if (isUniqueViolation(error, 'saved_views_panel_name_unique')) {
      return fail('duplicate', 'A view with that name already exists here.', 'name')
    }
    throw error
  }
}

export async function deleteView(viewId: string): Promise<ActionResult<undefined>> {
  const guard = await requireCapability('view_reports')
  if (!('ctx' in guard)) return guard

  const id = readId(viewId)
  if (!id) return fail('not_found', 'That view could not be identified.')

  const db = await getDb()
  const existing = (
    await db
      .select({ id: savedViews.id, panel: savedViews.panel, ownerMemberId: savedViews.ownerMemberId, name: savedViews.name })
      .from(savedViews)
      .where(eq(savedViews.id, id))
      .limit(1)
  )[0]
  if (!existing) return fail('not_found', 'That view no longer exists.')

  // Your own views, or anyone's if you administer the workspace. Views are shared to
  // read — the range and filters are not sensitive — but they are not shared to delete.
  const isOwner = existing.ownerMemberId === guard.ctx.actingMember.id
  if (!isOwner && !can(guard.ctx.actingMember.role, 'manage_settings')) {
    return fail('forbidden', `"${existing.name}" was saved by somebody else.`)
  }

  await db.delete(savedViews).where(eq(savedViews.id, id))
  revalidatePath(`/${existing.panel}`)
  return ok()
}
