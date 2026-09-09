import { can } from '@/lib/auth/permissions'
import { requireActing, selectableMembers } from '@/lib/auth/context'
import { getDb } from '@/lib/db/client'
import { listNotificationsFor } from '@/lib/db/queries/notifications'
import { NAV_ITEMS } from '@/components/workspace/nav-items'
import { SideNav } from '@/components/workspace/side-nav'
import { ActingSwitcher } from '@/components/workspace/acting-switcher'
import { NotificationBell } from '@/components/workspace/notification-bell'

export const dynamic = 'force-dynamic'

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { settings, actingMember } = await requireActing()
  const db = await getDb()
  const [options, notifications] = await Promise.all([
    selectableMembers(),
    listNotificationsFor(db, actingMember.id),
  ])

  // The nav shows what this role can actually open. The pages check again server-side —
  // this is tidiness, not the guard.
  const items = NAV_ITEMS.filter(
    (item) => item.capability === null || can(actingMember.role, item.capability),
  )

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
              <path d="M4 19V7m0 12h16M8 19v-6m4 6V9m4 10v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold leading-tight">
              {settings.agencyName}
            </span>
            <span className="hidden text-[11px] leading-tight text-muted-foreground sm:block">
              Agency Operations
            </span>
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <NotificationBell notifications={notifications} />
          <ActingSwitcher
            current={{
              id: actingMember.id,
              name: actingMember.name,
              role: actingMember.role,
              color: actingMember.color,
            }}
            options={options.filter((m) => m.role !== 'logger')}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 lg:flex-row">
        <SideNav items={items} />
        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <div className="mx-auto flex max-w-[1500px] flex-col gap-5">{children}</div>
        </main>
      </div>
    </div>
  )
}
