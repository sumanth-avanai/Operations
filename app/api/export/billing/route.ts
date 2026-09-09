import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db/client'
import { getBillingData, type BillingGroupBy } from '@/lib/db/queries/billing'
import { getWorkspaceContext } from '@/lib/auth/context'
import { can, isProjectScoped } from '@/lib/auth/permissions'
import { makeFormatter } from '@/lib/format'
import { resolveRange } from '@/lib/range'
import { buildWorkbook, centsToUnits, downloadHeaders, minutesToHoursValue } from '@/lib/export/workbook'

export const dynamic = 'force-dynamic'

/**
 * Exactly the same query parameters and the same query function as /billing, so the
 * workbook cannot disagree with the screen (SC-010).
 */
export async function GET(request: NextRequest) {
  const ctx = await getWorkspaceContext()
  if (!ctx?.actingMember) {
    return NextResponse.json({ error: 'Unlock the workspace first.' }, { status: 401 })
  }
  if (!can(ctx.actingMember.role, 'view_billing')) {
    return NextResponse.json({ error: 'Your role cannot view billing figures.' }, { status: 403 })
  }

  const params = Object.fromEntries(request.nextUrl.searchParams)
  const range = resolveRange(params, {
    asOf: ctx.today,
    weekStartDay: ctx.settings.weekStartDay,
    fallback: 'last_month',
  })
  const groupBy = (['project', 'role', 'member'].includes(params.groupBy ?? '')
    ? params.groupBy
    : 'project') as BillingGroupBy

  const db = await getDb()
  const data = await getBillingData(db, {
    from: range.from,
    to: range.to,
    groupBy,
    asOf: ctx.today,
    ...(params.client ? { clientId: params.client } : {}),
    ...(isProjectScoped(ctx.actingMember.role) ? { ownerMemberId: ctx.actingMember.id } : {}),
  })
  const fmt = makeFormatter(ctx.settings)

  const buffer = await buildWorkbook({
    title: 'Billing',
    currency: ctx.settings.currency,
    sheets: [
      {
        name: groupBy === 'member' ? 'By person' : groupBy === 'role' ? 'By role' : 'By project',
        caption: [
          `${ctx.settings.agencyName} — billing ${fmt.range(range.from, range.to)}`,
          'Logged is invoiced plus unbilled. Non-billable projects are excluded.',
        ],
        columns: [
          { header: groupBy === 'member' ? 'Person' : groupBy === 'role' ? 'Role' : 'Project', key: 'label', width: 32 },
          { header: 'Detail', key: 'sublabel', width: 24 },
          { header: 'Hours', key: 'hours', type: 'hours' },
          { header: 'Logged', key: 'logged', type: 'money', width: 16 },
          { header: 'Invoiced', key: 'invoiced', type: 'money', width: 16 },
          { header: 'Unbilled', key: 'unbilled', type: 'money', width: 16 },
        ],
        rows: data.rows.map((row) => ({
          label: row.label,
          sublabel: row.sublabel,
          hours: minutesToHoursValue(row.split.loggedMinutes),
          logged: centsToUnits(row.split.loggedCents),
          invoiced: centsToUnits(row.split.invoicedCents),
          unbilled: centsToUnits(row.split.unbilledCents),
        })),
        totalsRow: {
          label: 'Total',
          sublabel: null,
          hours: minutesToHoursValue(data.totals.loggedMinutes),
          logged: centsToUnits(data.totals.loggedCents),
          invoiced: centsToUnits(data.totals.invoicedCents),
          unbilled: centsToUnits(data.totals.unbilledCents),
        },
      },
      {
        name: 'Ready to invoice',
        columns: [
          { header: 'Project', key: 'project', width: 32 },
          { header: 'Client', key: 'client', width: 24 },
          { header: 'Hours', key: 'hours', type: 'hours' },
          { header: 'Unbilled', key: 'unbilled', type: 'money', width: 16 },
          { header: 'Entries', key: 'entries', type: 'number' },
          { header: 'Oldest entry', key: 'oldest', width: 14 },
        ],
        rows: data.invoiceable.map((row) => ({
          project: row.projectName,
          client: row.clientName,
          hours: minutesToHoursValue(row.unbilledMinutes),
          unbilled: centsToUnits(row.unbilledCents),
          entries: row.entryCount,
          oldest: fmt.date(row.oldestDate),
        })),
      },
      {
        name: 'Invoices',
        columns: [
          { header: 'Reference', key: 'reference', width: 22 },
          { header: 'Project', key: 'project', width: 30 },
          { header: 'Issued', key: 'issued', width: 14 },
          { header: 'Period', key: 'period', width: 26 },
          { header: 'Entries', key: 'entries', type: 'number' },
          { header: 'Amount', key: 'amount', type: 'money', width: 16 },
        ],
        rows: data.invoices.map((invoice) => ({
          reference: invoice.reference,
          project: invoice.projectName ?? 'Several projects',
          issued: fmt.date(invoice.issuedDate),
          period: `${fmt.date(invoice.periodStart)} – ${fmt.date(invoice.periodEnd)}`,
          entries: invoice.entryCount,
          amount: centsToUnits(invoice.amountCents),
        })),
      },
    ],
  })

  return new NextResponse(new Uint8Array(buffer), {
    headers: downloadHeaders(`billing-${range.from}-to-${range.to}.xlsx`),
  })
}
