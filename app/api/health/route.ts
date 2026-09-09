import { NextResponse } from 'next/server'
import { getDbInfo } from '@/lib/db/client'
import { getWorkspaceContext } from '@/lib/auth/context'

export const dynamic = 'force-dynamic'

/**
 * A readiness probe, not an information endpoint.
 *
 * Unauthenticated callers get `{ ok }` and nothing else — no driver, no table count, no
 * error text — because this route sits outside the session guard by design. Details are
 * for someone who has already unlocked the workspace.
 */
export async function GET() {
  const ctx = await getWorkspaceContext().catch(() => null)
  try {
    const info = await getDbInfo()
    return NextResponse.json(ctx ? { ok: true, ...info } : { ok: true })
  } catch (error) {
    if (!ctx) return NextResponse.json({ ok: false }, { status: 500 })
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
