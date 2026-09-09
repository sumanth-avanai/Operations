/**
 * Cheap cookie-presence guard (Next.js 16 proxy) so an unauthenticated request never reaches a panel.
 *
 * It deliberately does NOT verify the signature or read the database: every real
 * authorization decision happens in the page or the action against the database
 * (constitution III). This is a redirect, not a security boundary.
 */
import { NextResponse, type NextRequest } from 'next/server'

const WORKSPACE_COOKIE = 'aops_ws'

export function proxy(request: NextRequest) {
  if (request.cookies.has(WORKSPACE_COOKIE)) return NextResponse.next()
  const url = request.nextUrl.clone()
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`
  url.pathname = '/unlock'
  url.search = next === '/' ? '' : `?next=${encodeURIComponent(next)}`
  return NextResponse.redirect(url)
}

export const config = {
  // Everything except the unlock screen, the account-free portal, API routes and assets.
  matcher: [
    '/((?!unlock|portal|api|_next/static|_next/image|favicon.ico|robots.txt).*)',
  ],
}
