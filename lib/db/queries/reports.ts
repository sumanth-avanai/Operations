import 'server-only'
import { asc, eq, sql } from 'drizzle-orm'
import { utilization, type Utilization } from '@/lib/domain/utilization'
import { percentOf } from '@/lib/domain/money'
import type { ISODate } from '@/lib/domain/types'
import type { Db } from '../client'
import { savedViews } from '../schema'
import { loadCapacityContexts } from './capacity-context'
import { priceCents } from '../sql-money'

export type ReportGroupBy = 'member' | 'project' | 'client'

export type ReportRow = {
  key: string
  label: string
  sublabel: string | null
  loggedMinutes: number
  billableMinutes: number
  revenueCents: number
  /** Only for member rows: their real availability and utilization against target. */
  availableMinutes: number | null
  utilization: Utilization | null
  /** Share of the report's total billable hours. */
  sharePct: number | null
}

export type ReportData = {
  from: ISODate
  to: ISODate
  groupBy: ReportGroupBy
  rows: ReportRow[]
  totals: {
    availableMinutes: number
    loggedMinutes: number
    billableMinutes: number
    revenueCents: number
    utilizationPct: number | null
  }
  /**
   * True when a filter has narrowed which work counts. The availability denominator is
   * deliberately NOT narrowed (FR-042), and the page says so.
   */
  numeratorFiltered: boolean
  /** True when the caller is limited to the engagements they own. */
  scopedToOwner: boolean
}

export async function getReportData(
  db: Db,
  opts: {
    from: ISODate
    to: ISODate
    groupBy: ReportGroupBy
    clientId?: string
    projectId?: string
    memberId?: string
    /**
     * Restricts which work counts to projects this member owns. A Project Manager may
     * not see other managers' projects or global finance, so the revenue and hours in
     * this report must never include work outside their own engagements.
     */
    ownerMemberId?: string
  },
): Promise<ReportData> {
  const numeratorFiltered = Boolean(
    opts.clientId || opts.projectId || opts.memberId || opts.ownerMemberId,
  )

  const workFilters = sql`
    te.entry_date between ${opts.from} and ${opts.to}
    ${opts.clientId ? sql`and p.client_id = ${opts.clientId}` : sql``}
    ${opts.projectId ? sql`and p.id = ${opts.projectId}` : sql``}
    ${opts.memberId ? sql`and te.member_id = ${opts.memberId}` : sql``}
    ${opts.ownerMemberId ? sql`and p.owner_member_id = ${opts.ownerMemberId}` : sql``}
  `

  const groupSelect =
    opts.groupBy === 'member'
      ? sql`m.id as key, m.name as label, null::text as sublabel`
      : opts.groupBy === 'project'
        ? sql`p.id as key, p.name as label, c.name as sublabel`
        : sql`c.id as key, c.name as label, null::text as sublabel`

  const groupClause =
    opts.groupBy === 'member'
      ? sql`m.id, m.name`
      : opts.groupBy === 'project'
        ? sql`p.id, p.name, c.name`
        : sql`c.id, c.name`

  type WorkRow = {
    key: string
    label: string
    sublabel: string | null
    logged: number
    billable: number
    revenue: number
  }

  const [work, capacities] = await Promise.all([
    db.execute<WorkRow>(sql`
      select ${groupSelect},
             coalesce(sum(te.minutes), 0)::bigint as logged,
             coalesce(sum(case when p.billable then te.minutes else 0 end), 0)::bigint as billable,
             coalesce(sum(case when p.billable then ${priceCents()} else 0 end), 0)::bigint as revenue
      from time_entries te
      join project_roles pr on pr.id = te.project_role_id
      join projects p on p.id = pr.project_id
      join clients c on c.id = p.client_id
      join members m on m.id = te.member_id
      where ${workFilters}
      group by ${groupClause}
      order by 2
    `),
    loadCapacityContexts(db, { from: opts.from, to: opts.to }),
  ])

  const workRows = work.rows as unknown as WorkRow[]
  const totalBillable = workRows.reduce((sum, row) => sum + Number(row.billable), 0)

  let rows: ReportRow[]

  if (opts.groupBy === 'member') {
    const byMember = new Map(workRows.map((row) => [row.key, row]))
    rows = [...capacities.values()]
      .filter((capacity) => !opts.memberId || capacity.member.id === opts.memberId)
      .map((capacity) => {
        const row = byMember.get(capacity.member.id)
        const loggedMinutes = Number(row?.logged ?? 0)
        const billableMinutes = Number(row?.billable ?? 0)
        return {
          key: capacity.member.id,
          label: capacity.member.name,
          sublabel: null,
          loggedMinutes,
          billableMinutes,
          revenueCents: Number(row?.revenue ?? 0),
          availableMinutes: capacity.availableMinutes,
          utilization: utilization({
            billableMinutes,
            loggedMinutes,
            availableMinutes: capacity.availableMinutes,
            targetPct: capacity.member.utilizationTargetPct,
          }),
          sharePct: percentOf(billableMinutes, totalBillable),
        }
      })
      .sort((a, b) => a.label.localeCompare(b.label))
  } else {
    rows = workRows.map((row) => ({
      key: row.key,
      label: row.label,
      sublabel: row.sublabel,
      loggedMinutes: Number(row.logged),
      billableMinutes: Number(row.billable),
      revenueCents: Number(row.revenue),
      availableMinutes: null,
      utilization: null,
      sharePct: percentOf(Number(row.billable), totalBillable),
    }))
  }

  const availableMinutes = [...capacities.values()]
    .filter((capacity) => !opts.memberId || capacity.member.id === opts.memberId)
    .reduce((sum, capacity) => sum + capacity.availableMinutes, 0)
  const loggedMinutes = workRows.reduce((sum, row) => sum + Number(row.logged), 0)
  const revenueCents = workRows.reduce((sum, row) => sum + Number(row.revenue), 0)

  return {
    from: opts.from,
    to: opts.to,
    groupBy: opts.groupBy,
    rows,
    totals: {
      availableMinutes,
      loggedMinutes,
      billableMinutes: totalBillable,
      revenueCents,
      utilizationPct: percentOf(totalBillable, availableMinutes),
    },
    numeratorFiltered,
    scopedToOwner: Boolean(opts.ownerMemberId),
  }
}

export async function listSavedViews(db: Db, panel: string) {
  return db
    .select({ id: savedViews.id, name: savedViews.name, config: savedViews.config })
    .from(savedViews)
    .where(eq(savedViews.panel, panel))
    .orderBy(asc(savedViews.name))
}
