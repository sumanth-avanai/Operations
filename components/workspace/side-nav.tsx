'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BriefcaseBusinessIcon, CalendarRangeIcon, ClockIcon, HeartPulseIcon, HouseIcon,
  ReceiptTextIcon, Settings2Icon, UsersIcon, ChartNoAxesColumnIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NavItem } from './nav-items'

const ICONS = {
  home: HouseIcon,
  clock: ClockIcon,
  calendar: CalendarRangeIcon,
  briefcase: BriefcaseBusinessIcon,
  users: UsersIcon,
  receipt: ReceiptTextIcon,
  chart: ChartNoAxesColumnIcon,
  heart: HeartPulseIcon,
  settings: Settings2Icon,
} as const

const GROUP_LABELS: Record<NavItem['group'], string> = {
  work: 'Delivery',
  money: 'Money & insight',
  admin: 'Workspace',
}

export function SideNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname()
  const groups: NavItem['group'][] = ['work', 'money', 'admin']

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)

  return (
    <>
      {/* Desktop rail */}
      <nav aria-label="Panels" className="hidden w-56 shrink-0 flex-col gap-5 border-r bg-card px-3 py-4 lg:flex">
        {groups.map((group) => {
          const groupItems = items.filter((i) => i.group === group)
          if (groupItems.length === 0) return null
          return (
            <div key={group} className="flex flex-col gap-0.5">
              <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                {GROUP_LABELS[group]}
              </p>
              {groupItems.map((item) => {
                const Icon = ICONS[item.icon]
                const active = isActive(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                      active
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className={cn('size-4 shrink-0', active ? '' : 'opacity-70')} />
                    <span className="truncate">{item.label}</span>
                  </Link>
                )
              })}
            </div>
          )
        })}
      </nav>

      {/* Mobile strip */}
      <nav
        aria-label="Panels"
        className="flex gap-1 overflow-x-auto border-b bg-card px-3 py-2 lg:hidden"
      >
        {items.map((item) => {
          const Icon = ICONS[item.icon]
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium',
                active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </>
  )
}
