import { PROJECT_STATUS_LABELS, RISK_LABELS, type ProjectStatusName, type RiskLevelName } from '@/lib/domain/types'
import { Badge } from '@/components/ui/badge'

const STATUS_VARIANT = { on_track: 'ok', at_risk: 'warn', on_hold: 'idle', done: 'info' } as const
const RISK_VARIANT = { low: 'ok', medium: 'warn', high: 'danger' } as const

export type HealthHistoryRow = {
  id: string
  status: ProjectStatusName
  risk: RiskLevelName
  satisfaction: number | null
  comment: string | null
  authorName: string | null
  dateLabel: string
}

export function HealthHistory({ updates }: { updates: HealthHistoryRow[] }) {
  if (updates.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No health updates yet. The first one becomes the project&apos;s current status.
      </p>
    )
  }
  return (
    <ol className="flex flex-col gap-0">
      {updates.map((update, index) => (
        <li key={update.id} className="relative flex gap-3 pb-4 last:pb-0">
          <div className="flex flex-col items-center">
            <span
              className="mt-1 size-2 shrink-0 rounded-full"
              style={{
                backgroundColor:
                  index === 0 ? 'var(--primary)' : 'var(--border)',
              }}
              aria-hidden
            />
            {index < updates.length - 1 ? <span className="w-px flex-1 bg-border" aria-hidden /> : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={STATUS_VARIANT[update.status]}>{PROJECT_STATUS_LABELS[update.status]}</Badge>
              <Badge variant={RISK_VARIANT[update.risk]}>{RISK_LABELS[update.risk]}</Badge>
              {update.satisfaction ? (
                <span className="text-[11px] text-muted-foreground">{update.satisfaction}/5 happy</span>
              ) : null}
              <span className="ml-auto text-[11px] text-muted-foreground tnum">{update.dateLabel}</span>
              {index === 0 ? <Badge variant="outline">Current</Badge> : null}
            </div>
            {update.comment ? (
              <p className="mt-1 text-[13px] text-foreground/90">{update.comment}</p>
            ) : null}
            {update.authorName ? (
              <p className="mt-0.5 text-[11px] text-muted-foreground">{update.authorName}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  )
}
