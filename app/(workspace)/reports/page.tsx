import Link from 'next/link'
import { DownloadIcon, InfoIcon } from 'lucide-react'
import { getDb } from '@/lib/db/client'
import { getReportData, listSavedViews, type ReportGroupBy } from '@/lib/db/queries/reports'
import { listClientOptions, listMemberOptions } from '@/lib/db/queries/projects'
import { guardPage } from '@/lib/auth/context'
import { isProjectScoped } from '@/lib/auth/permissions'
import { makeFormatter } from '@/lib/format'
import { rangeToQuery, resolveRange } from '@/lib/range'
import { RANGE_PRESET_LABELS, type RangePreset } from '@/lib/domain/dates'
import { formatHours } from '@/lib/domain/money'
import { UTILIZATION_BAND_STYLE } from '@/lib/domain/utilization'
import { PageHeader } from '@/components/shared/page-header'
import { ForbiddenPanel } from '@/components/shared/forbidden'
import { Stat, StatRow } from '@/components/shared/stat'
import { Meter } from '@/components/shared/meter'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ParamSelect } from '@/components/shared/param-controls'
import { RangePicker } from '@/components/shared/range-picker'
import { SavedViews, type SavedViewRow } from '@/components/reports/saved-views'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reports' }

const GROUPS: { value: ReportGroupBy; label: string }[] = [
  { value: 'member', label: 'By person' },
  { value: 'project', label: 'By project' },
  { value: 'client', label: 'By client' },
]

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    preset?: string; from?: string; to?: string; groupBy?: string
    client?: string; project?: string; member?: string
  }>
}) {
  const guard = await guardPage('view_reports', '/reports')
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
  const range = resolveRange(params, {
    asOf: today,
    weekStartDay: settings.weekStartDay,
    fallback: 'this_month',
  })
  const groupBy = (GROUPS.some((g) => g.value === params.groupBy) ? params.groupBy : 'member') as ReportGroupBy

  const db = await getDb()
  const [data, clientOptions, memberOptions, views] = await Promise.all([
    getReportData(db, {
      from: range.from,
      to: range.to,
      groupBy,
      ...(params.client ? { clientId: params.client } : {}),
      ...(params.project ? { projectId: params.project } : {}),
      ...(params.member ? { memberId: params.member } : {}),
      // A Project Manager may not see other managers' projects or global finance.
      ...(isProjectScoped(actingMember.role) ? { ownerMemberId: actingMember.id } : {}),
    }),
    listClientOptions(db),
    listMemberOptions(db),
    listSavedViews(db, 'reports'),
  ])

  const rangeLabel =
    range.preset === 'custom'
      ? fmt.range(range.from, range.to)
      : RANGE_PRESET_LABELS[range.preset as RangePreset]
  const exportQuery = rangeToQuery(range, {
    groupBy,
    client: params.client,
    project: params.project,
    member: params.member,
  })

  return (
    <>
      <PageHeader
        title="Reports"
        description={`Billable utilization is billable hours over available hours — after holidays, leave, part-time patterns and contract dates. ${fmt.range(range.from, range.to)}.`}
      >
        <ParamSelect
          param="client"
          value={params.client ?? 'all'}
          label="Client"
          options={[
            { value: 'all', label: 'All clients' },
            ...clientOptions.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <ParamSelect
          param="member"
          value={params.member ?? 'all'}
          label="Person"
          options={[
            { value: 'all', label: 'Everyone' },
            ...memberOptions.map((m) => ({ value: m.id, label: m.name })),
          ]}
        />
        <ParamSelect param="groupBy" value={groupBy} label="Group by" options={GROUPS} />
        <RangePicker preset={range.preset} from={range.from} to={range.to} label={rangeLabel} />
        <SavedViews panel="reports" views={views as SavedViewRow[]} />
        <Button asChild variant="outline" size="sm">
          <Link href={`/api/export/report?${exportQuery}`} prefetch={false}>
            <DownloadIcon />
            Export
          </Link>
        </Button>
      </PageHeader>

      <StatRow>
        <Stat
          label="Available"
          value={`${formatHours(data.totals.availableMinutes, { zero: '0' })}h`}
          hint="Honest capacity for this range"
        />
        <Stat
          label="Logged"
          value={`${formatHours(data.totals.loggedMinutes, { zero: '0' })}h`}
          hint={`${formatHours(data.totals.billableMinutes, { zero: '0' })}h of it billable`}
        />
        <Stat
          label="Billable utilization"
          value={fmt.percent(data.totals.utilizationPct)}
          hint="Billable hours over available hours"
          tone={
            data.totals.utilizationPct === null
              ? 'default'
              : data.totals.utilizationPct >= 60
                ? 'ok'
                : 'warn'
          }
        />
        <Stat
          label="Revenue delivered"
          value={fmt.moneyShort(data.totals.revenueCents)}
          hint="Billable hours priced at their role rate"
        />
      </StatRow>

      {data.numeratorFiltered ? (
        <p className="flex items-start gap-2 rounded-lg bg-info-soft px-3 py-2 text-[13px]">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" style={{ color: 'var(--info)' }} />
          <span className="text-foreground/90">
            {data.scopedToOwner
              ? 'This report counts only work on the engagements you manage, while availability is left whole — so these percentages show what share of the team’s real capacity went to your projects.'
              : 'A filter is narrowing which work counts, but availability is deliberately left whole — so these percentages show what share of everyone’s real capacity went to the filtered work.'}
          </span>
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{GROUPS.find((g) => g.value === groupBy)?.label}</CardTitle>
          <CardDescription>
            {groupBy === 'member'
              ? 'Each person against their own availability and target.'
              : 'Hours and revenue by ' + groupBy + '. Utilization is a per-person figure, so it is shown when grouping by person.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          {data.rows.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">
              Nothing logged in this range.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {groupBy === 'member' ? 'Person' : groupBy === 'project' ? 'Project' : 'Client'}
                  </TableHead>
                  {groupBy === 'member' ? <TableHead className="text-right">Available</TableHead> : null}
                  <TableHead className="text-right">Logged</TableHead>
                  <TableHead className="text-right">Billable</TableHead>
                  {groupBy === 'member' ? (
                    <>
                      <TableHead className="w-40">Utilization</TableHead>
                      <TableHead className="text-right">Target</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                    </>
                  ) : (
                    <TableHead className="text-right">Share</TableHead>
                  )}
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => {
                  const band = row.utilization ? UTILIZATION_BAND_STYLE[row.utilization.band] : null
                  return (
                    <TableRow key={row.key}>
                      <TableCell>
                        <span className="font-medium">{row.label}</span>
                        {row.sublabel ? (
                          <span className="block text-[11px] text-muted-foreground">{row.sublabel}</span>
                        ) : null}
                      </TableCell>
                      {groupBy === 'member' ? (
                        <TableCell className="text-right tnum text-muted-foreground">
                          {formatHours(row.availableMinutes ?? 0, { zero: '0' })}
                        </TableCell>
                      ) : null}
                      <TableCell className="text-right tnum">
                        {formatHours(row.loggedMinutes, { zero: '0' })}
                      </TableCell>
                      <TableCell className="text-right tnum">
                        {formatHours(row.billableMinutes, { zero: '0' })}
                      </TableCell>
                      {groupBy === 'member' && row.utilization ? (
                        <>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Meter
                                value={row.billableMinutes}
                                max={row.availableMinutes || 1}
                                color={band?.color}
                                marker={
                                  row.utilization.targetPct === null
                                    ? null
                                    : row.utilization.targetPct / 100
                                }
                                label={`${row.label} utilization`}
                              />
                              <span
                                className="w-10 shrink-0 text-right text-[12px] font-semibold tnum"
                                style={{ color: band?.color }}
                              >
                                {fmt.percent(row.utilization.pct)}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right tnum text-muted-foreground">
                            {row.utilization.targetPct === null ? '—' : `${row.utilization.targetPct}%`}
                          </TableCell>
                          <TableCell
                            className="text-right font-semibold tnum"
                            style={{
                              color:
                                row.utilization.variancePct === null
                                  ? undefined
                                  : row.utilization.variancePct >= 0
                                    ? 'var(--ok)'
                                    : 'var(--warn)',
                            }}
                          >
                            {row.utilization.variancePct === null
                              ? '—'
                              : `${row.utilization.variancePct > 0 ? '+' : ''}${row.utilization.variancePct}`}
                          </TableCell>
                        </>
                      ) : (
                        <TableCell className="text-right tnum text-muted-foreground">
                          {fmt.percent(row.sharePct)}
                        </TableCell>
                      )}
                      <TableCell className="text-right tnum">{fmt.money(row.revenueCents)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  {groupBy === 'member' ? (
                    <TableCell className="text-right tnum">
                      {formatHours(data.totals.availableMinutes, { zero: '0' })}
                    </TableCell>
                  ) : null}
                  <TableCell className="text-right font-semibold tnum">
                    {formatHours(data.totals.loggedMinutes, { zero: '0' })}
                  </TableCell>
                  <TableCell className="text-right font-semibold tnum">
                    {formatHours(data.totals.billableMinutes, { zero: '0' })}
                  </TableCell>
                  {groupBy === 'member' ? (
                    <>
                      <TableCell className="text-right font-semibold tnum">
                        {fmt.percent(data.totals.utilizationPct)}
                      </TableCell>
                      <TableCell />
                      <TableCell />
                    </>
                  ) : (
                    <TableCell className="text-right tnum">100%</TableCell>
                  )}
                  <TableCell className="text-right font-semibold tnum">
                    {fmt.money(data.totals.revenueCents)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  )
}
