import { AlertTriangleIcon } from 'lucide-react'
import type { Warning } from '@/lib/domain/guardrails'
import { cn } from '@/lib/utils'

/** Guardrails are shown, never hidden — but they never look like failures either. */
export function WarningList({ warnings, className }: { warnings: Warning[]; className?: string }) {
  if (warnings.length === 0) return null
  return (
    <ul className={cn('flex flex-col gap-1.5', className)}>
      {warnings.map((warning, index) => (
        <li
          key={`${warning.code}-${warning.date ?? index}`}
          className="flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn"
        >
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span className="text-foreground/90">{warning.message}</span>
        </li>
      ))}
    </ul>
  )
}
