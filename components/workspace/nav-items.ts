import type { Capability } from '@/lib/auth/permissions'

export type NavItem = {
  href: string
  label: string
  /** What the acting role must be able to do for this panel to appear. */
  capability: Capability | null
  icon: 'home' | 'clock' | 'calendar' | 'briefcase' | 'users' | 'receipt' | 'chart' | 'heart' | 'settings'
  group: 'work' | 'money' | 'admin'
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Home', capability: null, icon: 'home', group: 'work' },
  { href: '/timesheet', label: 'Timesheet', capability: 'log_time_for_others', icon: 'clock', group: 'work' },
  { href: '/planner', label: 'Resource Planner', capability: 'view_planner', icon: 'calendar', group: 'work' },
  { href: '/projects', label: 'Projects', capability: 'view_projects', icon: 'briefcase', group: 'work' },
  { href: '/members', label: 'Members', capability: 'view_members', icon: 'users', group: 'work' },
  { href: '/billing', label: 'Billing', capability: 'view_billing', icon: 'receipt', group: 'money' },
  { href: '/reports', label: 'Reports', capability: 'view_reports', icon: 'chart', group: 'money' },
  { href: '/status', label: 'Project Status', capability: 'view_projects', icon: 'heart', group: 'money' },
  { href: '/settings', label: 'Settings', capability: 'manage_settings', icon: 'settings', group: 'admin' },
]
