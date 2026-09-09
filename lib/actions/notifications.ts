'use server'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { notifications } from '@/lib/db/schema'
import { getWorkspaceContext } from '@/lib/auth/context'
import { uuid } from '@/lib/validation/schemas'
import { fail, failValidation, ok, type ActionResult } from './result'

/**
 * Only mutations live here.
 *
 * Reading notifications is `listNotificationsFor` in `lib/db/queries/notifications.ts`:
 * every export of a `'use server'` module is an endpoint the browser can call with any
 * arguments it likes, so a read that takes a `memberId` must not be one.
 */

const idsSchema = z.object({ ids: z.array(uuid).min(1).max(200) })

export async function markNotificationsRead(ids: string[]): Promise<ActionResult<{ count: number }>> {
  const ctx = await getWorkspaceContext()
  if (!ctx?.actingMember) return fail('forbidden', 'Choose which member you are acting as first.')

  const parsed = idsSchema.safeParse({ ids })
  if (!parsed.success) return failValidation(parsed.error.issues)

  const db = await getDb()
  // Scoped to the acting member: you cannot mark somebody else's notifications read,
  // and passing another member's ids simply matches nothing.
  const updated = await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(
      and(eq(notifications.memberId, ctx.actingMember.id), inArray(notifications.id, parsed.data.ids)),
    )
    .returning({ id: notifications.id })

  revalidatePath('/', 'layout')
  return ok({ count: updated.length })
}

export async function markAllNotificationsRead(): Promise<ActionResult<{ count: number }>> {
  const ctx = await getWorkspaceContext()
  if (!ctx?.actingMember) return fail('forbidden', 'Choose which member you are acting as first.')

  const db = await getDb()
  const updated = await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(and(eq(notifications.memberId, ctx.actingMember.id), isNull(notifications.readAt)))
    .returning({ id: notifications.id })

  revalidatePath('/', 'layout')
  return ok({ count: updated.length })
}
