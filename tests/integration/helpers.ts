/**
 * Harness for exercising the real server actions.
 *
 * Actions read cookies through next/headers and revalidate through next/cache, so both
 * are replaced with in-memory doubles. Everything else — validation, permissions, the
 * capacity gate, the transactions — is the real code path against a real database in a
 * temporary directory.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** The cookie jar the next/headers double reads and writes (see tests/setup). */
export const cookieJar: Map<string, string> = ((
  globalThis as { __aopsCookieJar?: Map<string, string> }
).__aopsCookieJar ??= new Map())

/** Kept for symmetry with the setup file; the doubles are installed globally. */
export function installNextDoubles(): void {}

export type Workspace = Awaited<ReturnType<typeof bootWorkspace>>

/**
 * Boots a throwaway workspace: a temp cwd with the real migrations, a real PGlite
 * database, and the real seed. Returns the modules under test, imported only after the
 * working directory is in place (the database module resolves its paths at load).
 */
export async function bootWorkspace() {
  const originalCwd = process.cwd()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aops-actions-'))
  fs.cpSync(path.join(originalCwd, 'drizzle'), path.join(dir, 'drizzle'), { recursive: true })
  process.chdir(dir)

  process.env.SESSION_SECRET = 'integration-test-secret-integration-test-secret'
  process.env.WORKSPACE_PASSWORD = 'test-password'

  const [client, schema, access, timesheet, members, projects, bookings, billing, health, settings, drizzleOrm] =
    await Promise.all([
      import('@/lib/db/client'),
      import('@/lib/db/schema'),
      import('@/lib/actions/access'),
      import('@/lib/actions/timesheet'),
      import('@/lib/actions/members'),
      import('@/lib/actions/projects'),
      import('@/lib/actions/bookings'),
      import('@/lib/actions/billing'),
      import('@/lib/actions/health'),
      import('@/lib/actions/settings'),
      import('drizzle-orm'),
    ])

  const db = await client.getDb()

  const cleanup = () => {
    process.chdir(originalCwd)
    fs.rmSync(dir, { recursive: true, force: true })
  }

  return {
    dir,
    db,
    schema,
    sql: drizzleOrm.sql,
    eq: drizzleOrm.eq,
    and: drizzleOrm.and,
    actions: { access, timesheet, members, projects, bookings, billing, health, settings },
    cleanup,
  }
}

export function form(values: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

/** Unlock and act as the member with the given role. */
export async function actAs(ws: Workspace, role: string): Promise<{ id: string; name: string }> {
  cookieJar.clear()
  const unlocked = await ws.actions.access.unlockWorkspace(null, form({ password: 'test-password' }))
  if (!unlocked.ok) throw new Error(`unlock failed: ${unlocked.error.message}`)

  const rows = await ws.db.execute(
    ws.sql`select id, name from members where role = ${role} and archived_at is null order by name limit 1`,
  )
  const member = (rows.rows as unknown as { id: string; name: string }[])[0]
  if (!member) throw new Error(`no member with role ${role}`)

  const set = await ws.actions.access.setActingMember(null, form({ memberId: member.id }))
  if (!set.ok) throw new Error(`setActingMember failed: ${set.error.message}`)
  return member
}

export async function scalar<T>(ws: Workspace, query: ReturnType<Workspace['sql']>): Promise<T> {
  const res = await ws.db.execute(query)
  const rows = res.rows as unknown as Record<string, unknown>[]
  return Object.values(rows[0] ?? {})[0] as T
}
