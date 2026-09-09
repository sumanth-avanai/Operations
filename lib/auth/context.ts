/**
 * Resolving a request to "who is acting, and what may they do".
 *
 * Every page and every action starts here. A portal request can only ever resolve to
 * its own member — there is no code path from a portal session to another member's
 * data, which is what makes logger isolation structural rather than careful.
 */
import 'server-only'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { getDb } from '@/lib/db/client'
import { members, workspaceSettings } from '@/lib/db/schema'
import { toPublicMember, type PublicMember, type WorkspaceSettings } from '@/lib/db/schema'
import { fail, type ActionResult } from '@/lib/actions/result'
import { today } from '@/lib/domain/dates'
import type { ISODate } from '@/lib/domain/types'
import { CAPABILITY_LABELS, can, type Capability } from './permissions'
import { readPortalSession, readWorkspaceSession } from './session'

export type WorkspaceContext = {
  settings: WorkspaceSettings
  /**
   * The workspace's own calendar day, resolved once for the request in the configured
   * time zone. Everything that means "as of today" reads this, so a page and the
   * queries behind it can never disagree about the date — and nothing has to trust the
   * server's zone, which on Vercel is UTC.
   */
  today: ISODate
  /** null right after unlocking, before a member has been chosen. Never carries a credential. */
  actingMember: PublicMember | null
}

export type ActingContext = WorkspaceContext & { actingMember: PublicMember }

export async function getSettings(): Promise<WorkspaceSettings> {
  const db = await getDb()
  const rows = await db.select().from(workspaceSettings).where(eq(workspaceSettings.id, 'default')).limit(1)
  const settings = rows[0]
  if (!settings) throw new Error('Workspace settings are missing — the database did not seed.')
  return settings
}

export async function getWorkspaceContext(): Promise<WorkspaceContext | null> {
  const session = await readWorkspaceSession()
  if (!session?.ws) return null
  const db = await getDb()
  const settings = await getSettings()
  const now = today(settings.timeZone)
  if (!session.memberId) return { settings, today: now, actingMember: null }
  const rows = await db.select().from(members).where(eq(members.id, session.memberId)).limit(1)
  const member = rows[0]
  // An archived member is no longer a valid identity to act as.
  if (!member || member.archivedAt) return { settings, today: now, actingMember: null }
  return { settings, today: now, actingMember: toPublicMember(member) }
}

/** Members an unlocked user may choose to act as. */
export async function selectableMembers(): Promise<
  Pick<PublicMember, 'id' | 'name' | 'role' | 'color'>[]
> {
  const db = await getDb()
  return db
    .select({ id: members.id, name: members.name, role: members.role, color: members.color })
    .from(members)
    .where(isNull(members.archivedAt))
    .orderBy(asc(members.name))
}

/* ------------------------------------------------------------------ page guards */

/** For pages: no session at all sends the user to unlock. */
export async function requireWorkspace(nextPath?: string): Promise<WorkspaceContext> {
  const ctx = await getWorkspaceContext()
  if (!ctx) redirect(nextPath ? `/unlock?next=${encodeURIComponent(nextPath)}` : '/unlock')
  return ctx
}

/** For pages that need an identity: unlocked but no member chosen goes back to pick one. */
export async function requireActing(nextPath?: string): Promise<ActingContext> {
  const ctx = await requireWorkspace(nextPath)
  if (!ctx.actingMember) redirect(nextPath ? `/unlock?next=${encodeURIComponent(nextPath)}` : '/unlock')
  return ctx as ActingContext
}

export type PageGuard =
  | { allowed: true; ctx: ActingContext }
  | { allowed: false; ctx: ActingContext; capability: Capability }

/**
 * A page the acting role may not open renders a forbidden panel naming the missing
 * capability. It does not 404 and it does not silently hide data it is holding.
 */
export async function guardPage(capability: Capability, nextPath?: string): Promise<PageGuard> {
  const ctx = await requireActing(nextPath)
  if (!can(ctx.actingMember.role, capability)) return { allowed: false, ctx, capability }
  return { allowed: true, ctx }
}

/* ------------------------------------------------------------------ action guards */

export type Guarded = { ctx: ActingContext }

/**
 * For server actions. Returns the uniform failure result rather than throwing, so an
 * action reads as a straight line: guard, validate, write.
 */
export async function requireCapability(
  capability: Capability,
): Promise<{ ok: true; ctx: ActingContext } | ActionResult<never>> {
  const ctx = await getWorkspaceContext()
  if (!ctx) return fail('forbidden', 'Your session has expired. Unlock the workspace again.')
  if (!ctx.actingMember) {
    return fail('forbidden', 'Choose which member you are acting as before making changes.')
  }
  if (!can(ctx.actingMember.role, capability)) {
    return fail(
      'forbidden',
      `${ctx.actingMember.name} cannot ${CAPABILITY_LABELS[capability]} as ${ctx.actingMember.role.replace(/_/g, ' ')}.`,
    )
  }
  return { ok: true, ctx: ctx as ActingContext }
}

/* ------------------------------------------------------------------ portal */

export type PortalContext = {
  /** The one member this link belongs to, without their PIN hash or token. */
  member: PublicMember
  settings: WorkspaceSettings
  /** The workspace's day, as in WorkspaceContext. A logger's week must match everyone else's. */
  today: ISODate
}

export type PortalState =
  | { state: 'inactive' }
  | { state: 'locked'; memberId: string; lockedUntil: string | null; hasPin: boolean }
  | { state: 'open'; ctx: PortalContext }

/**
 * Resolves a portal token to a state. An unknown, revoked, or archived-member token is
 * reported as `inactive` with no detail whatsoever, so a link cannot be used to probe
 * for members.
 */
export async function getPortalState(token: string): Promise<PortalState> {
  const db = await getDb()
  const rows = await db
    .select()
    .from(members)
    .where(and(eq(members.portalToken, token), eq(members.portalRevoked, false)))
    .limit(1)
  const member = rows[0]
  if (!member || member.archivedAt) return { state: 'inactive' }

  const session = await readPortalSession()
  if (session && session.memberId === member.id && session.token === token) {
    const settings = await getSettings()
    return {
      state: 'open',
      ctx: { member: toPublicMember(member), settings, today: today(settings.timeZone) },
    }
  }
  return {
    state: 'locked',
    memberId: member.id,
    lockedUntil: member.pinLockedUntil,
    hasPin: Boolean(member.pinHash),
  }
}

/** For portal actions: the member whose PIN was verified, or a refusal. */
export async function requirePortalMember(
  token: string,
): Promise<{ ok: true; ctx: PortalContext } | ActionResult<never>> {
  const state = await getPortalState(token)
  if (state.state !== 'open') {
    return fail('forbidden', 'This link is not active. Enter your PIN again.')
  }
  return { ok: true, ctx: state.ctx }
}
