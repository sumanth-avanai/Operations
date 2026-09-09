import { cn } from '@/lib/utils'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? '?'
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : ''
  return (first + last).toUpperCase()
}

export function Avatar({
  name,
  color,
  size = 'md',
  className,
}: {
  name: string
  color?: string
  size?: 'xs' | 'sm' | 'md'
  className?: string
}) {
  const dimension = { xs: 'size-5 text-[9px]', sm: 'size-6 text-[10px]', md: 'size-8 text-[11px]' }[size]
  return (
    <span
      aria-hidden
      title={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white/95 shadow-inner',
        dimension,
        className,
      )}
      style={{ backgroundColor: color ?? 'var(--hue-1)' }}
    >
      {initials(name)}
    </span>
  )
}
