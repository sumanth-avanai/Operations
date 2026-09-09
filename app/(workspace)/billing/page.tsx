import Link from 'next/link'
import { DownloadIcon } from 'lucide-react'
import { getDb } from '@/lib/db/client'
import { getBillingData, type BillingGroupBy } from '@/lib/db/queries/billing'
import { listClientOptions } from '@/lib/db/queries/projects'
import { guardPage } from '@/lib/auth/context'
import { can, isProjectScoped } from '@/lib/auth/permissions'
import { makeFormatter } from '@/lib/format'
import { resolveRange, rangeToQuery } from '@/lib/range'
import { RANGE_PRESET_LABELS, type RangePreset } from '@/lib/domain/dates'
import { AGING_LABELS } from '@/lib/domain/billing'
import { formatHours } from '@/lib/domain/money'
import { PageHeader } from '@/components/shared/page-header'
import { ForbiddenPanel } from '@/components/shared/forbidden'
import { Stat, StatRow } from '@/components/shared/stat'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ParamSelect } from '@/components/shared/param-controls'
import { RangePicker } from '@/components/shared/range-picker'
import { InvoiceDialog } from '@/components/billing/invoice-dialog'
import { UnmarkInvoiceButton } from '@/components/billing/unmark-button'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Billing' }

const GROUPS: { value: BillingGroupBy; label: string }[] = [
  { value: 'project', label: 'By project' },
  { value: 'role', label: 'By role' },
  { value: 'member', label: 'By person' },
]

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string; groupBy?: string; client?: string }>
}) {
  const guard = await guardPage('view_billing', '/billing')
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
    fallback: 'last_month',
  })
  const groupBy = (GROUPS.some((g) => g.value === params.groupBy) ? params.groupBy : 'project') as BillingGroupBy
  const canInvoice = can(actingMember.role, 'manage_billing')
  const scoped = isProjectScoped(actingMember.role)

  const db = await getDb()
  const [data, clientOptions] = await Promise.all([
    getBillingData(db, {
      from: range.from,
      to: range.to,
      groupBy,
      asOf: today,
      ...(params.client ? { clientId: params.client } : {}),
      ...(scoped ? { ownerMemberId: actingMember.id } : {}),
    }),
    listClientOptions(db),
  ])

  const rangeLabel =
    range.preset === 'custom'
      ? fmt.range(range.from, range.to)
      : RANGE_PRESET_LABELS[range.preset as RangePreset]
  const exportQuery = rangeToQuery(range, { groupBy, client: params.client })
  const totalsBalance =
    data.totals.loggedCents === data.totals.invoicedCents + data.totals.unbilledCents

  return (
    <>
      <PageHeader
        title="Billing"
        description={`What has been delivered, what has been invoiced, and what is still waiting to be billed. ${fmt.range(range.from, range.to)}.`}
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
        <ParamSelect param="groupBy" value={groupBy} label="Group by" options={GROUPS} />
        <RangePicker preset={range.preset} from={range.from} to={range.to} label={rangeLabel} />
        <Button asChild variant="outline" size="sm">
          <Link href={`/api/export/billing?${exportQuery}`} prefetch={false}>
            <DownloadIcon />
            Export
          </Link>
        </Button>
      </PageHeader>

      <StatRow>
        <Stat
          label="Logged"
          value={fmt.moneyShort(data.totals.loggedCents)}
          hint={`${formatHours(data.totals.loggedMinutes, { zero: '0' })}h of billable work delivered`}
        />
        <Stat
          label="Invoiced"
          value={fmt.moneyShort(data.totals.invoicedCents)}
          hint={`${formatHours(data.totals.invoicedMinutes, { zero: '0' })}h already billed`}
          tone="ok"
        />
        <Stat
          label="Unbilled"
          value={fmt.moneyShort(data.totals.unbilledCents)}
          hint={`${formatHours(data.totals.unbilledMinutes, { zero: '0' })}h waiting to be invoiced`}
          tone={data.totals.unbilledCents > 0 ? 'warn' : 'default'}
        />
        <Stat
          label="Unbilled ageing"
          value={fmt.moneyShort(data.aging.find((a) => a.bucket === 'over_90')?.cents ?? 0)}
          hint="Over 90 days old, across all periods"
          tone={
            (data.aging.find((a) => a.bucket === 'over_90')?.cents ?? 0) > 0 ? 'danger' : 'default'
          }
        />
      </StatRow>

      {!totalsBalance ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
          Logged does not equal invoiced plus unbilled. This should be impossible — please report it.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{GROUPS.find((g) => g.value === groupBy)?.label}</CardTitle>
          <CardDescription>
            Logged is always invoiced plus unbilled. Non-billable projects are excluded entirely.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          {data.rows.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">
              No billable work in this period.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{groupBy === 'member' ? 'Person' : groupBy === 'role' ? 'Role' : 'Project'}</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Logged</TableHead>
                  <TableHead className="text-right">Invoiced</TableHead>
                  <TableHead className="text-right">Unbilled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>
                      {row.projectId && groupBy === 'project' ? (
                        <Link href={`/projects/${row.projectId}`} className="font-medium hover:underline">
                          {row.label}
                        </Link>
                      ) : (
                        <span className="font-medium">{row.label}</span>
                      )}
                      {row.sublabel ? (
                        <span className="block text-[11px] text-muted-foreground">{row.sublabel}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tnum text-muted-foreground">
                      {formatHours(row.split.loggedMinutes, { zero: '0' })}
                    </TableCell>
                    <TableCell className="text-right tnum">{fmt.money(row.split.loggedCents)}</TableCell>
                    <TableCell className="text-right tnum" style={{ color: 'var(--ok)' }}>
                      {fmt.money(row.split.invoicedCents)}
                    </TableCell>
                    <TableCell
                      className="text-right font-semibold tnum"
                      style={{ color: row.split.unbilledCents > 0 ? 'var(--warn)' : undefined }}
                    >
                      {fmt.money(row.split.unbilledCents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right tnum">
                    {formatHours(data.totals.loggedMinutes, { zero: '0' })}
                  </TableCell>
                  <TableCell className="text-right font-semibold tnum">
                    {fmt.money(data.totals.loggedCents)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tnum">
                    {fmt.money(data.totals.invoicedCents)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tnum">
                    {fmt.money(data.totals.unbilledCents)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Ready to invoice</CardTitle>
            <CardDescription>
              Unbilled billable work in this period, per project. Marking it invoiced freezes each
              amount at the current rate.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            {data.invoiceable.length === 0 ? (
              <p className="px-5 py-6 text-center text-[13px] text-muted-foreground">
                Nothing unbilled in this period — everything delivered has been invoiced.
              </p>
            ) : (
              <ul className="divide-y border-t">
                {data.invoiceable.map((row) => (
                  <li key={row.projectId} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{row.projectName}</span>
                      <span className="block text-[11px] text-muted-foreground tnum">
                        {row.clientName} · {formatHours(row.unbilledMinutes, { zero: '0' })}h ·{' '}
                        {row.entryCount} entries · oldest {fmt.date(row.oldestDate)}
                      </span>
                    </span>
                    <span className="text-[13px] font-semibold tnum">{fmt.money(row.unbilledCents)}</span>
                    {canInvoice ? (
                      <InvoiceDialog
                        projectId={row.projectId}
                        projectName={row.projectName}
                        today={today}
                        periodStart={range.from}
                        periodEnd={range.to}
                        amountLabel={fmt.money(row.unbilledCents)}
                        entryCount={row.entryCount}
                        suggestedReference={`INV-${range.to.slice(0, 4)}-${range.to.slice(5, 7)}-${row.projectName
                          .replace(/[^A-Za-z0-9]/g, '')
                          .slice(0, 6)
                          .toUpperCase()}`}
                        trigger={
                          <button className="rounded-md border px-2 py-1 text-[12px] font-medium hover:bg-muted">
                            Invoice
                          </button>
                        }
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Unbilled ageing</CardTitle>
              <CardDescription>All unbilled work, by how long it has been sitting.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1.5">
                {data.aging.map((bucket) => (
                  <li key={bucket.bucket} className="flex items-center justify-between text-[13px]">
                    <span className="text-muted-foreground">{AGING_LABELS[bucket.bucket]}</span>
                    <span
                      className="font-semibold tnum"
                      style={{
                        color:
                          bucket.bucket === 'over_90' && bucket.cents > 0 ? 'var(--danger)' : undefined,
                      }}
                    >
                      {fmt.money(bucket.cents)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Invoices touching this period</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-2">
              {data.invoices.length === 0 ? (
                <p className="px-5 py-4 text-[13px] text-muted-foreground">No invoices yet.</p>
              ) : (
                <ul className="divide-y border-t">
                  {data.invoices.map((invoice) => (
                    <li key={invoice.id} className="flex items-center gap-2 px-5 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">
                          {invoice.reference}
                        </span>
                        <span className="block text-[11px] text-muted-foreground tnum">
                          {invoice.projectName ?? 'Several projects'} · {fmt.date(invoice.issuedDate)} ·{' '}
                          {invoice.entryCount} entries
                        </span>
                      </span>
                      <Badge variant="ok">{fmt.moneyShort(invoice.amountCents)}</Badge>
                      {canInvoice ? (
                        <UnmarkInvoiceButton invoiceId={invoice.id} reference={invoice.reference} />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
