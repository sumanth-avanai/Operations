import { cn } from '@/lib/utils'

export function StatRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-4', className)}>{children}</div>
  )
}

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
  className,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: 'default' | 'ok' | 'warn' | 'danger' | 'info'
  className?: string
}) {
  const toneColor = {
    default: 'var(--foreground)',
    ok: 'var(--ok)',
    warn: 'var(--warn)',
    danger: 'var(--danger)',
    info: 'var(--info)',
  }[tone]
  return (
    <div className={cn('rounded-xl border bg-card px-4 py-3.5 shadow-xs', className)}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight tnum" style={{ color: toneColor }}>
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  )
}
