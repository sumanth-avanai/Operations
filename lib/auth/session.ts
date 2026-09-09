/**
 * Signed, HTTP-only session cookies. Two independent sessions:
 *
 *  - workspace: proves the shared password was entered, and carries which member the
 *    user is acting as (that member's role is what the permission matrix is applied to)
 *  - portal: proves a PIN was entered for ONE member's private link, and can never
 *    resolve to anybody else
 *
 * The payload is signed, not encrypted — it holds no secret, and a tampered cookie
 * fails verification.
 */
import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

const WORKSPACE_COOKIE = 'aops_ws'
const PORTAL_COOKIE = 'aops_portal'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30

export type WorkspaceSession = { v: 1; ws: true; memberId: string | null; iat: number }
export type PortalSession = { v: 1; memberId: string; token: string; iat: number }

function secret(): string {
  const fromEnv = process.env.SESSION_SECRET
  if (fromEnv && fromEnv.length >= 16) return fromEnv
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SESSION_SECRET is missing. Set it in the environment before running a production build.',
    )
  }
  // Local convenience so `npm run dev` works straight after a clone.
  return 'development-only-insecure-session-secret'
}

function sign(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const mac = createHmac('sha256', secret()).update(body).digest('base64url')
  return `${body}.${mac}`
}

function verify<T>(raw: string | undefined): T | null {
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot <= 0) return null
  const body = raw.slice(0, dot)
  const mac = raw.slice(dot + 1)
  const expected = createHmac('sha256', secret()).update(body).digest('base64url')
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { iat?: number }
    if (typeof parsed.iat !== 'number' || Date.now() / 1000 - parsed.iat > MAX_AGE_SECONDS) return null
    return parsed as T
  } catch {
    return null
  }
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: MAX_AGE_SECONDS,
  secure: process.env.NODE_ENV === 'production',
} as const

/* ------------------------------------------------------------------ workspace */

export async function readWorkspaceSession(): Promise<WorkspaceSession | null> {
  const jar = await cookies()
  return verify<WorkspaceSession>(jar.get(WORKSPACE_COOKIE)?.value)
}

/** Call only from a server action or route handler. */
export async function writeWorkspaceSession(memberId: string | null): Promise<void> {
  const jar = await cookies()
  const payload: WorkspaceSession = {
    v: 1,
    ws: true,
    memberId,
    iat: Math.floor(Date.now() / 1000),
  }
  jar.set(WORKSPACE_COOKIE, sign(payload), COOKIE_OPTIONS)
}

export async function clearWorkspaceSession(): Promise<void> {
  const jar = await cookies()
  jar.delete(WORKSPACE_COOKIE)
}

/* ------------------------------------------------------------------ portal */

export async function readPortalSession(): Promise<PortalSession | null> {
  const jar = await cookies()
  return verify<PortalSession>(jar.get(PORTAL_COOKIE)?.value)
}

export async function writePortalSession(memberId: string, token: string): Promise<void> {
  const jar = await cookies()
  const payload: PortalSession = { v: 1, memberId, token, iat: Math.floor(Date.now() / 1000) }
  jar.set(PORTAL_COOKIE, sign(payload), COOKIE_OPTIONS)
}

export async function clearPortalSession(): Promise<void> {
  const jar = await cookies()
  jar.delete(PORTAL_COOKIE)
}

export { WORKSPACE_COOKIE, PORTAL_COOKIE }
