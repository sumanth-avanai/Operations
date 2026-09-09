import { cn } from '@/lib/utils'

/**
 * One bar, used for capacity, utilization and budget alike, so the same shape always
 * means the same thing. `value` and `max` are in the same unit; `marker` draws the
 * target or budget line.
 */
export function Meter({
  value,
  max,
  color = 'var(--primary)',
  marker,
  className,
  label,
  height = 8,
}: {
  value: number
  max: number
  color?: string
  /** 0–1 position of a target line. */
  marker?: number | null
  className?: string
  label?: string
  height?: number
}) {
  const ratio = max > 0 ? value / max : 0
  const filled = Math.min(1, Math.max(0, ratio))
  const overflow = ratio > 1 ? Math.min(1, ratio - 1) : 0

  return (
    <div
      className={cn('relative w-full overflow-hidden rounded-full bg-muted', className)}
      style={{ height }}
      role="meter"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full transition-[width]"
        style={{ width: `${filled * 100}%`, backgroundColor: color }}
      />
      {overflow > 0 ? (
        <div
          className="absolute inset-y-0 right-0 rounded-full"
          style={{
            width: `${overflow * 100}%`,
            backgroundColor: 'var(--danger)',
            backgroundImage:
              'repeating-linear-gradient(135deg, transparent 0 3px, rgba(255,255,255,.35) 3px 6px)',
          }}
        />
      ) : null}
      {marker != null && marker > 0 && marker <= 1 ? (
        <div
          className="absolute inset-y-[-1px] w-0.5 bg-foreground/45"
          style={{ left: `calc(${marker * 100}% - 1px)` }}
        />
      ) : null}
    </div>
  )
}
