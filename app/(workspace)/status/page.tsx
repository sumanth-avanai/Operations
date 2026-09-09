import Link from 'next/link'
import { getDb } from '@/lib/db/client'
import { getStatusBoard } from '@/lib/db/queries/health'
import { guardPage } from '@/lib/auth/context'
import { can, isProjectScoped } from '@/lib/auth/permissions'
import { makeFormatter } from '@/lib/format'
import {
  PROJECT_STATUSES, PROJECT_STATUS_LABELS, RISK_LABELS, RISK_LEVELS,
  type ProjectStatusName, type RiskLevelName,
} from '@/lib/domain/types'
import { PageHeader } from '@/components/shared/page-header'
import { ForbiddenPanel } from '@/components/shared/forbidden'
import { Stat, StatRow } from '@/components/shared/stat'
import { BudgetBar } from '@/components/shared/budget-bar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ParamSelect } from '@/components/shared/param-controls'
import { HealthDialog } from '@/components/status/health-dialog'
import { EmptyState } from '@/components/shared/empty'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Project Status' }

const STATUS_VARIANT = { on_track: 'ok', at_risk: 'warn', on_hold: 'idle', done: 'info' } as const
const RISK_VARIANT = { low: 'ok', medium: 'warn', high: 'danger' } as const

export default async function StatusPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; risk?: string }>
}) {
  const guard = await guardPage('view_projects', '/status')
  if (!guard.allowed) {
    return (
      <ForbiddenPanel
        capability={guard.capability}
        memberName={guard.ctx.actingMember.name}
        role={guard.ctx.actingMember.role}
      />
    )
  }

  const { settings, actingMember, today } = guard.ctx
  const fmt = makeFormatter(settings)
  const params = await searchParams
  const canHealth = can(actingMember.role, 'manage_health')
  const scoped = isProjectScoped(actingMember.role)

  const db = await getDb()
  const all = await getStatusBoard(db, {
    asOf: today,
    ...(scoped ? { ownerMemberId: actingMember.id } : {}),
  })

  const rows = all.filter((row) => {
    if (params.status && params.status !== 'all' && row.health?.status !== params.status) return false
    if (params.risk && params.risk !== 'all' && row.health?.risk !== params.risk) return false
    return true
  })

  const atRisk = all.filter((row) => row.health?.status === 'at_risk').length
  const highRisk = all.filter((row) => row.health?.risk === 'high').length
  const overBudget = all.filter((row) => row.budget.remainingCents < 0).length
  const satisfactionValues = all
    .map((row) => row.health?.satisfaction)
    .filter((value): value is number => typeof value === 'number')
  const avgSatisfaction =
    satisfactionValues.length === 0
      ? null
      : Math.round((satisfactionValues.reduce((a, b) => a + b, 0) / satisfactionValues.length) * 10) / 10

  return (
    <>
      <PageHeader
        title="Project Status"
        description="Every project's current health, risk, client satisfaction and how much of its budget is gone."
      >
        <ParamSelect
          param="status"
          value={params.status ?? 'all'}
          label="Status"
          options={[
            { value: 'all', label: 'Any status' },
            ...PROJECT_STATUSES.map((s) => ({ value: s, label: PROJECT_STATUS_LABELS[s] })),
          ]}
        />
        <ParamSelect
          param="risk"
          value={params.risk ?? 'all'}
          label="Risk"
          options={[
            { value: 'all', label: 'Any risk' },
            ...RISK_LEVELS.map((r) => ({ value: r, label: RISK_LABELS[r] })),
          ]}
        />
      </PageHeader>

      <StatRow>
        <Stat label="Projects" value={all.length} hint="Live engagements on the board" />
        <Stat label="At risk" value={atRisk} tone={atRisk > 0 ? 'warn' : 'ok'} hint="Flagged in their latest update" />
        <Stat label="High risk" value={highRisk} tone={highRisk > 0 ? 'danger' : 'ok'} hint="Risk level high" />
        <Stat
          label="Over budget"
          value={overBudget}
          tone={overBudget > 0 ? 'danger' : 'ok'}
          hint={
            avgSatisfaction === null
              ? 'No satisfaction readings yet'
              : `Average client satisfaction ${avgSatisfaction}/5`
          }
        />
      </StatRow>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing matches those filters"
          description="Clear the status or risk filter to see the whole portfolio."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <Card key={row.projectId} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col gap-3 px-5 pt-4 pb-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/projects/${row.projectId}`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: row.projectColor }}
                        aria-hidden
                      />
                      <span className="truncate text-[13px] font-semibold">{row.projectName}</span>
                    </Link>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {row.clientName}
                      {row.ownerName ? ` · ${row.ownerName}` : ''}
                      {row.billable ? '' : ' · non-billable'}
                    </p>
                  </div>
                  {row.health?.satisfaction ? (
                    <span className="shrink-0 text-[11px] text-muted-foreground tnum">
                      {row.health.satisfaction}/5
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {row.health ? (
                    <>
                      <Badge variant={STATUS_VARIANT[row.health.status as ProjectStatusName]}>
                        {PROJECT_STATUS_LABELS[row.health.status as ProjectStatusName]}
                      </Badge>
                      <Badge variant={RISK_VARIANT[row.health.risk as RiskLevelName]}>
                        {RISK_LABELS[row.health.risk as RiskLevelName]}
                      </Badge>
                    </>
                  ) : (
                    <Badge variant="outline">No health update yet</Badge>
                  )}
                  {row.budget.remainingCents < 0 ? (
                    <Badge variant="danger">
                      {row.budget.overBudget ? 'Over budget' : 'Over-committed'}
                    </Badge>
                  ) : null}
                </div>

                {row.billable && row.budget.budgetCents > 0 ? (
                  <BudgetBar budget={row.budget} money={fmt.moneyShort} />
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    {row.billable ? 'No budget set' : 'Internal work'}
                  </p>
                )}

                {row.latestComment ? (
                  <p className="line-clamp-3 text-[12px] text-foreground/85">{row.latestComment}</p>
                ) : null}

                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <span className="text-[11px] text-muted-foreground">
                    {row.updateCount === 0
                      ? 'No history'
                      : `${row.updateCount} update${row.updateCount === 1 ? '' : 's'}${
                          row.health ? ` · latest ${fmt.date(row.health.updateDate)}` : ''
                        }`}
                  </span>
                  {canHealth ? (
                    <HealthDialog
                      projectId={row.projectId}
                      projectName={row.projectName}
                      current={row.health}
                      today={today}
                      trigger={
                        <button className="rounded-md border px-2 py-1 text-[12px] font-medium hover:bg-muted">
                          Log health
                        </button>
                      }
                    />
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
