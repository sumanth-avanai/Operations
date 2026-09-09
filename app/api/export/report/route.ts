import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db/client'
import { getReportData, type ReportGroupBy } from '@/lib/db/queries/reports'
import { getWorkspaceContext } from '@/lib/auth/context'
import { can, isProjectScoped } from '@/lib/auth/permissions'
import { makeFormatter } from '@/lib/format'
import { resolveRange } from '@/lib/range'
import { buildWorkbook, centsToUnits, downloadHeaders, minutesToHoursValue } from '@/lib/export/workbook'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const ctx = await getWorkspaceContext()
  if (!ctx?.actingMember) {
    return NextResponse.json({ error: 'Unlock the workspace first.' }, { status: 401 })
  }
  if (!can(ctx.actingMember.role, 'view_reports')) {
    return NextResponse.json({ error: 'Your role cannot view reports.' }, { status: 403 })
  }

  const params = Object.fromEntries(request.nextUrl.searchParams)
  const range = resolveRange(params, {
    asOf: ctx.today,
    weekStartDay: ctx.settings.weekStartDay,
    fallback: 'this_month',
  })
  const groupBy = (['member', 'project', 'client'].includes(params.groupBy ?? '')
    ? params.groupBy
    : 'member') as ReportGroupBy

  const db = await getDb()
  const data = await getReportData(db, {
    from: range.from,
    to: range.to,
    groupBy,
    ...(params.client ? { clientId: params.client } : {}),
    ...(params.project ? { projectId: params.project } : {}),
    ...(params.member ? { memberId: params.member } : {}),
    // The export must be scoped exactly like the page it mirrors.
    ...(isProjectScoped(ctx.actingMember.role) ? { ownerMemberId: ctx.actingMember.id } : {}),
  })
  const fmt = makeFormatter(ctx.settings)

  const buffer = await buildWorkbook({
    title: 'Report',
    currency: ctx.settings.currency,
    sheets: [
      {
        name: groupBy === 'member' ? 'By person' : groupBy === 'project' ? 'By project' : 'By client',
        caption: [
          `${ctx.settings.agencyName} — utilization ${fmt.range(range.from, range.to)}`,
          data.scopedToOwner
            ? 'Limited to the engagements you manage; availability is left whole.'
            : data.numeratorFiltered
              ? 'A filter narrows which work counts; availability is left whole.'
              : 'Billable utilization is billable hours over available hours.',
        ],
        columns: [
          {
            header: groupBy === 'member' ? 'Person' : groupBy === 'project' ? 'Project' : 'Client',
            key: 'label',
            width: 30,
          },
          { header: 'Detail', key: 'sublabel', width: 22 },
          { header: 'Available h', key: 'available', type: 'hours' },
          { header: 'Logged h', key: 'logged', type: 'hours' },
          { header: 'Billable h', key: 'billable', type: 'hours' },
          { header: 'Utilization', key: 'utilization', type: 'percent' },
          { header: 'Target', key: 'target', type: 'percent' },
          { header: 'Variance', key: 'variance', type: 'percent' },
          { header: 'Revenue', key: 'revenue', type: 'money', width: 16 },
        ],
        rows: data.rows.map((row) => ({
          label: row.label,
          sublabel: row.sublabel,
          available: row.availableMinutes === null ? null : minutesToHoursValue(row.availableMinutes),
          logged: minutesToHoursValue(row.loggedMinutes),
          billable: minutesToHoursValue(row.billableMinutes),
          utilization: row.utilization?.pct ?? null,
          target: row.utilization?.targetPct ?? null,
          variance: row.utilization?.variancePct ?? null,
          revenue: centsToUnits(row.revenueCents),
        })),
        totalsRow: {
          label: 'Total',
          sublabel: null,
          available: minutesToHoursValue(data.totals.availableMinutes),
          logged: minutesToHoursValue(data.totals.loggedMinutes),
          billable: minutesToHoursValue(data.totals.billableMinutes),
          utilization: data.totals.utilizationPct,
          target: null,
          variance: null,
          revenue: centsToUnits(data.totals.revenueCents),
        },
      },
    ],
  })

  return new NextResponse(new Uint8Array(buffer), {
    headers: downloadHeaders(`report-${range.from}-to-${range.to}.xlsx`),
  })
}
