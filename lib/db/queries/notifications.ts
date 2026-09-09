import 'server-only'
import { desc, eq } from 'drizzle-orm'
import type { Db } from '../client'
import { notifications } from '../schema'

export type NotificationRow = {
  id: string
  kind: string
  title: string
  body: string | null
  link: string | null
  readAt: string | null
  createdAt: string
}

/**
 * One member's notifications.
 *
 * This is a QUERY, not a server action, and that distinction is the security boundary:
 * every export of a `'use server'` module is callable from the browser with arbitrary
 * arguments, so a function taking a `memberId` and returning that member's rows must
 * never live in one. Callers pass the acting member's id, which the page resolved from
 * a signed cookie.
 */
export async function listNotificationsFor(db: Db, memberId: string, limit = 20): Promise<NotificationRow[]> {
  return db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      link: notifications.link,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.memberId, memberId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
}
