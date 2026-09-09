'use client'
import { useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BellIcon } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { markAllNotificationsRead } from '@/lib/actions/notifications'
import type { NotificationRow } from '@/lib/db/queries/notifications'

const KIND_TONE: Record<string, string> = {
  booked: 'var(--info)',
  onboarded: 'var(--ok)',
  over_commitment: 'var(--danger)',
  slipped_work: 'var(--warn)',
}

export function NotificationBell({ notifications }: { notifications: NotificationRow[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const unread = notifications.filter((n) => !n.readAt).length

  return (
    <Popover>
      <PopoverTrigger
        className="relative flex size-8 items-center justify-center rounded-md border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 outline-none"
        aria-label={unread > 0 ? `${unread} unread notifications` : 'Notifications'}
      >
        <BellIcon className="size-4" />
        {unread > 0 ? (
          <span className="absolute -top-1 -right-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
            {unread}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-[13px] font-semibold">Notifications</p>
          {unread > 0 ? (
            <Button
              variant="ghost"
              size="xs"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await markAllNotificationsRead()
                  router.refresh()
                })
              }
            >
              Mark all read
            </Button>
          ) : null}
        </div>
        {notifications.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
            Nothing yet. Bookings and onboarding show up here.
          </p>
        ) : (
          <ul className="max-h-80 overflow-y-auto">
            {notifications.map((item) => {
              const content = (
                <>
                  <span
                    className="mt-1.5 size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: item.readAt ? 'transparent' : KIND_TONE[item.kind] ?? 'var(--primary)' }}
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{item.title}</span>
                    {item.body ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">{item.body}</span>
                    ) : null}
                  </span>
                </>
              )
              return (
                <li key={item.id} className="border-b last:border-b-0">
                  {item.link ? (
                    <Link href={item.link} className="flex gap-2.5 px-3 py-2.5 hover:bg-muted">
                      {content}
                    </Link>
                  ) : (
                    <div className="flex gap-2.5 px-3 py-2.5">{content}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
