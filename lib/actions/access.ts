'use server'
/**
 * Getting in: the shared workspace password, choosing which member you are acting as,
 * and the account-free portal PIN.
 */
import { and, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { members, workspaceSettings } from '@/lib/db/schema'
import { getSettings, requireCapability } from '@/lib/auth/context'
import { generatePin, hashSecret, verifySecret } from '@/lib/auth/secrets'
import {
  clearPortalSession, clearWorkspaceSession, writePortalSession, writeWorkspaceSession,
} from '@/lib/auth/session'
import { readId } from '@/lib/validation/schemas'
import { fail, failValidation, ok, type ActionResult } from './result'

/** Wrong PIN attempts allowed before the link cools off. */
const PIN_ATTEMPT_LIMIT = 5
const PIN_LOCK_MINUTES = 15

/**
 * Wrong workspace passwords allowed before the unlock screen cools off.
 *
 * A little more generous than the PIN limit — a shared password gets mistyped by real
 * people all day — but bounded, because one password admits every internal role and an
 * unthrottled guess is a path to the whole workspace.
 */
const UNLOCK_ATTEMPT_LIMIT = 10
const UNLOCK_LOCK_MINUTES = 10

const unlockSchema = z.object({ password: z.string().min(1, 'Enter the workspace password.') })

export async function unlockWorkspace(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const parsed = unlockSchema.safeParse({ password: formData.get('password') })
  if (!parsed.success) return failValidation(parsed.error.issues)

  const settings = await getSettings()
  const db = await getDb()

  if (settings.unlockLockedUntil && new Date(settings.unlockLockedUntil) > new Date()) {
    return fail(
      'pin_throttled',
      'Too many incorrect attempts. Wait a few minutes and try again.',
      'password',
    )
  }

  const valid = verifySecret(parsed.data.password, {
    hash: settings.passwordHash,
    salt: settings.passwordSalt,
  })

  if (!valid) {
    const failures = settings.unlockFailedCount + 1
    await db
      .update(workspaceSettings)
      .set({
        unlockFailedCount: failures,
        unlockLockedUntil:
          failures >= UNLOCK_ATTEMPT_LIMIT
            ? new Date(Date.now() + UNLOCK_LOCK_MINUTES * 60_000).toISOString()
            : settings.unlockLockedUntil,
      })
      .where(eq(workspaceSettings.id, 'default'))
    // One message and one code path whether the password is wrong or the field was junk.
    return fail('invalid', 'That workspace password is not correct.', 'password')
  }

  await db
    .update(workspaceSettings)
    .set({ unlockFailedCount: 0, unlockLockedUntil: null })
    .where(eq(workspaceSettings.id, 'default'))

  await writeWorkspaceSession(null)
  revalidatePath('/', 'layout')
  return ok()
}

const actingSchema = z.object({ memberId: z.uuid('Choose a member.') })

export async function setActingMember(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const parsed = actingSchema.safeParse({ memberId: formData.get('memberId') })
  if (!parsed.success) return failValidation(parsed.error.issues)

  const db = await getDb()
  const rows = await db.select().from(members).where(eq(members.id, parsed.data.memberId)).limit(1)
  const member = rows[0]
  if (!member) return fail('not_found', 'That member no longer exists.')
  if (member.archivedAt) return fail('forbidden', `${member.name} is archived and cannot be used.`)

  await writeWorkspaceSession(member.id)
  revalidatePath('/', 'layout')
  return ok()
}

export async function lockWorkspace(): Promise<void> {
  await clearWorkspaceSession()
  await clearPortalSession()
  revalidatePath('/', 'layout')
}

/* ------------------------------------------------------------------ portal */

const pinSchema = z.object({
  token: z.string().min(10),
  pin: z.string().min(1, 'Enter your PIN.'),
})

export async function verifyPortalPin(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const parsed = pinSchema.safeParse({ token: formData.get('token'), pin: formData.get('pin') })
  if (!parsed.success) return failValidation(parsed.error.issues)
  const { token, pin } = parsed.data

  const db = await getDb()
  const rows = await db
    .select()
    .from(members)
    .where(and(eq(members.portalToken, token), eq(members.portalRevoked, false)))
    .limit(1)
  const member = rows[0]

  // Nothing about the member is disclosed before a correct PIN (FR-005).
  const generic = fail('pin_invalid', 'That PIN is not correct.', 'pin')
  if (!member || member.archivedAt) return generic

  if (member.pinLockedUntil && new Date(member.pinLockedUntil) > new Date()) {
    return fail(
      'pin_throttled',
      'Too many attempts. Try again in a few minutes, or ask an admin to reset your PIN.',
      'pin',
    )
  }

  const valid = verifySecret(pin, { hash: member.pinHash ?? '', salt: member.pinSalt ?? '' })
  if (!valid) {
    const failures = member.pinFailedCount + 1
    await db
      .update(members)
      .set({
        pinFailedCount: failures,
        pinLockedUntil:
          failures >= PIN_ATTEMPT_LIMIT
            ? new Date(Date.now() + PIN_LOCK_MINUTES * 60_000).toISOString()
            : member.pinLockedUntil,
      })
      .where(eq(members.id, member.id))
    return generic
  }

  await db
    .update(members)
    .set({ pinFailedCount: 0, pinLockedUntil: null })
    .where(eq(members.id, member.id))
  await writePortalSession(member.id, token)
  revalidatePath(`/portal/${token}`)
  return ok()
}

export async function leavePortal(token: string): Promise<void> {
  await clearPortalSession()
  revalidatePath(`/portal/${token}`)
}

/* ------------------------------------------------------------------ admin: PINs and links */

export async function resetMemberPin(memberId: string): Promise<ActionResult<{ pin: string }>> {
  const guard = await requireCapability('manage_security')
  if (!('ctx' in guard)) return guard

  const id = readId(memberId)
  if (!id) return fail('not_found', 'That member could not be identified.')

  const db = await getDb()
  const pin = generatePin()
  const { hash, salt } = hashSecret(pin)
  const updated = await db
    .update(members)
    .set({ pinHash: hash, pinSalt: salt, pinFailedCount: 0, pinLockedUntil: null })
    .where(eq(members.id, id))
    .returning({ id: members.id, name: members.name })

  if (updated.length === 0) return fail('not_found', 'That member no longer exists.')
  revalidatePath('/members')
  revalidatePath(`/members/${id}`)
  // The previous PIN stops working immediately (FR-006).
  return ok({ pin })
}

export async function setPortalRevoked(
  memberId: string,
  revoked: boolean,
): Promise<ActionResult<undefined>> {
  const guard = await requireCapability('manage_security')
  if (!('ctx' in guard)) return guard

  const id = readId(memberId)
  if (!id) return fail('not_found', 'That member could not be identified.')

  const db = await getDb()
  const updated = await db
    .update(members)
    .set({ portalRevoked: revoked })
    .where(eq(members.id, id))
    .returning({ id: members.id })
  if (updated.length === 0) return fail('not_found', 'That member no longer exists.')

  revalidatePath('/members')
  revalidatePath(`/members/${id}`)
  return ok()
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter the current password.'),
    newPassword: z.string().min(6, 'Use at least six characters.'),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'The new password must be different.',
    path: ['newPassword'],
  })

export async function changeWorkspacePassword(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const guard = await requireCapability('manage_security')
  if (!('ctx' in guard)) return guard

  const parsed = passwordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
  })
  if (!parsed.success) return failValidation(parsed.error.issues)

  const settings = await getSettings()
  if (!verifySecret(parsed.data.currentPassword, { hash: settings.passwordHash, salt: settings.passwordSalt })) {
    return fail('invalid', 'The current password is not correct.', 'currentPassword')
  }

  const db = await getDb()
  const { hash, salt } = hashSecret(parsed.data.newPassword)
  await db
    .update(workspaceSettings)
    .set({
      passwordHash: hash,
      passwordSalt: salt,
      unlockFailedCount: 0,
      unlockLockedUntil: null,
      updatedAt: sql`now()`,
    })
    .where(eq(workspaceSettings.id, 'default'))

  revalidatePath('/settings')
  return ok()
}
