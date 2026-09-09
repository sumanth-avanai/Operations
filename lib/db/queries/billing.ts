import 'server-only'
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { splitFromParts, type BillingSplit, agingBucket, type AgingBucket } from '@/lib/domain/billing'
import { diffDays } from '@/lib/domain/dates'
import type { ISODate } from '@/lib/domain/types'
import type { Db } from '../client'
import { invoices, projects } from '../schema'
import { priceCents } from '../sql-money'

export type BillingGroupBy = 'project' | 'role' | 'member'

export type BillingGroupRow = {
  key: string
  label: string
  sublabel: string | null
  split: BillingSplit
  /** Only meaningful when grouping by project: the invoicing scope. */
  projectId: string | null
  billable: boolean
}

export type BillingInvoiceRow = {
  id: string
  reference: string
  issuedDate: ISODate
  periodStart: ISODate
  periodEnd: ISODate
  amountCents: number
  projectName: string | null
  entryCount: number
  note: string | null
}

export type BillingData = {
  from: ISODate
  to: ISODate
  groupBy: BillingGroupBy
  totals: BillingSplit
  rows: BillingGroupRow[]
  /** Projects with unbilled work in the period — what can be invoiced right now. */
  invoiceable: {
    projectId: string
    projectName: string
    clientName: string
    unbilledCents: number
    unbilledMinutes: number
    entryCount: number
    oldestDate: ISODate
  }[]
  aging: { bucket: AgingBucket; cents: number }[]
  invoices: BillingInvoiceRow[]
}

/**
 * `logged` is never queried: it is defined as invoiced + unbilled, which is what makes
 * SC-002 true by construction. Unbilled work is priced per entry at the role's current
 * rate — the same half-up rounding the domain layer uses — while invoiced work carries
 * its frozen amount.
 */
export async function getBillingData(
  db: Db,
  opts: {
    from: ISODate
    to: ISODate
    groupBy: BillingGroupBy
    /** The day aging is measured from. Required, so an aging bucket is never the server's guess. */
    asOf: ISODate
    projectId?: string
    clientId?: string
    /** Project Managers see only their own engagements. */
    ownerMemberId?: string
  },
): Promise<BillingData> {
  const filters = sql`
    p.billable = true
    and te.entry_date between ${opts.from} and ${opts.to}
    ${opts.projectId ? sql`and p.id = ${opts.projectId}` : sql``}
    ${opts.clientId ? sql`and p.client_id = ${opts.clientId}` : sql``}
    ${opts.ownerMemberId ? sql`and p.owner_member_id = ${opts.ownerMemberId}` : sql``}
  `

  const groupSelect =
    opts.groupBy === 'project'
      ? sql`p.id as key, p.name as label, c.name as sublabel, p.id as project_id`
      : opts.groupBy === 'role'
        ? sql`pr.id as key, pr.name as label, p.name as sublabel, p.id as project_id`
        : sql`m.id as key, m.name as label, null::text as sublabel, null::uuid as project_id`

  const groupBy =
    opts.groupBy === 'project'
      ? sql`p.id, p.name, c.name`
      : opts.groupBy === 'role'
        ? sql`pr.id, pr.name, p.name, p.id`
        : sql`m.id, m.name`

  type GroupRow = {
    key: string
    label: string
    sublabel: string | null
    project_id: string | null
    invoiced_cents: number
    unbilled_cents: number
    invoiced_minutes: number
    unbilled_minutes: number
  }

  const [groups, invoiceableRows, agingRows, invoiceRows] = await Promise.all([
    db.execute<GroupRow>(sql`
      select ${groupSelect},
             coalesce(sum(case when te.invoice_id is not null then te.invoiced_amount_cents else 0 end), 0)::bigint as invoiced_cents,
             coalesce(sum(case when te.invoice_id is null then ${priceCents()} else 0 end), 0)::bigint as unbilled_cents,
             coalesce(sum(case when te.invoice_id is not null then te.minutes else 0 end), 0)::bigint as invoiced_minutes,
             coalesce(sum(case when te.invoice_id is null then te.minutes else 0 end), 0)::bigint as unbilled_minutes
      from time_entries te
      join project_roles pr on pr.id = te.project_role_id
      join projects p on p.id = pr.project_id
      join clients c on c.id = p.client_id
      join members m on m.id = te.member_id
      where ${filters}
      group by ${groupBy}
      order by 2
    `),

    db.execute<{
      project_id: string
      project_name: string
      client_name: string
      unbilled_cents: number
      unbilled_minutes: number
      entry_count: number
      oldest_date: string
    }>(sql`
      select p.id as project_id, p.name as project_name, c.name as client_name,
             coalesce(sum(${priceCents()}), 0)::bigint as unbilled_cents,
             coalesce(sum(te.minutes), 0)::bigint as unbilled_minutes,
             count(*)::int as entry_count,
             min(te.entry_date)::text as oldest_date
      from time_entries te
      join project_roles pr on pr.id = te.project_role_id
      join projects p on p.id = pr.project_id
      join clients c on c.id = p.client_id
      where ${filters} and te.invoice_id is null
      group by p.id, p.name, c.name
      having sum(te.minutes) > 0
      order by 4 desc
    `),

    db.execute<{ entry_date: string; cents: number }>(sql`
      select te.entry_date::text,
             coalesce(sum(${priceCents()}), 0)::bigint as cents
      from time_entries te
      join project_roles pr on pr.id = te.project_role_id
      join projects p on p.id = pr.project_id
      where p.billable = true and te.invoice_id is null
      ${opts.ownerMemberId ? sql`and p.owner_member_id = ${opts.ownerMemberId}` : sql``}
      group by te.entry_date
    `),

    // Invoices are global finance. A scoped caller sees only invoices raised against a
    // project they own — which also excludes any invoice spanning several projects,
    // because its reference, amount and note describe work that is not all theirs.
    (opts.ownerMemberId
      ? db
          .select({
            id: invoices.id,
            reference: invoices.reference,
            issuedDate: invoices.issuedDate,
            periodStart: invoices.periodStart,
            periodEnd: invoices.periodEnd,
            amountCents: invoices.amountCents,
            note: invoices.note,
            projectName: projects.name,
            entryCount: sql<number>`(select count(*)::int from time_entries where invoice_id = ${invoices.id})`,
          })
          .from(invoices)
          .innerJoin(projects, eq(projects.id, invoices.projectId))
          .where(
            and(
              gte(invoices.periodEnd, opts.from),
              lte(invoices.periodStart, opts.to),
              eq(projects.ownerMemberId, opts.ownerMemberId),
            ),
          )
          .orderBy(desc(invoices.issuedDate))
      : db
          .select({
            id: invoices.id,
            reference: invoices.reference,
            issuedDate: invoices.issuedDate,
            periodStart: invoices.periodStart,
            periodEnd: invoices.periodEnd,
            amountCents: invoices.amountCents,
            note: invoices.note,
            projectName: projects.name,
            entryCount: sql<number>`(select count(*)::int from time_entries where invoice_id = ${invoices.id})`,
          })
          .from(invoices)
          .leftJoin(projects, eq(projects.id, invoices.projectId))
          .where(and(gte(invoices.periodEnd, opts.from), lte(invoices.periodStart, opts.to)))
          .orderBy(desc(invoices.issuedDate))),
  ])

  const rows: BillingGroupRow[] = (groups.rows as unknown as GroupRow[]).map((row) => ({
    key: row.key,
    label: row.label,
    sublabel: row.sublabel,
    projectId: row.project_id,
    billable: true,
    split: splitFromParts({
      invoicedCents: Number(row.invoiced_cents),
      unbilledCents: Number(row.unbilled_cents),
      invoicedMinutes: Number(row.invoiced_minutes),
      unbilledMinutes: Number(row.unbilled_minutes),
    }),
  }))

  const totals = splitFromParts({
    invoicedCents: rows.reduce((sum, r) => sum + r.split.invoicedCents, 0),
    unbilledCents: rows.reduce((sum, r) => sum + r.split.unbilledCents, 0),
    invoicedMinutes: rows.reduce((sum, r) => sum + r.split.invoicedMinutes, 0),
    unbilledMinutes: rows.reduce((sum, r) => sum + r.split.unbilledMinutes, 0),
  })

  const now = opts.asOf
  const agingTotals = new Map<AgingBucket, number>()
  for (const row of agingRows.rows as unknown as { entry_date: string; cents: number }[]) {
    const bucket = agingBucket(diffDays(row.entry_date, now))
    agingTotals.set(bucket, (agingTotals.get(bucket) ?? 0) + Number(row.cents))
  }

  return {
    from: opts.from,
    to: opts.to,
    groupBy: opts.groupBy,
    totals,
    rows,
    invoiceable: (invoiceableRows.rows as unknown as {
      project_id: string
      project_name: string
      client_name: string
      unbilled_cents: number
      unbilled_minutes: number
      entry_count: number
      oldest_date: string
    }[]).map((row) => ({
      projectId: row.project_id,
      projectName: row.project_name,
      clientName: row.client_name,
      unbilledCents: Number(row.unbilled_cents),
      unbilledMinutes: Number(row.unbilled_minutes),
      entryCount: Number(row.entry_count),
      oldestDate: row.oldest_date,
    })),
    aging: (['0_30', '31_60', '61_90', 'over_90'] as AgingBucket[]).map((bucket) => ({
      bucket,
      cents: agingTotals.get(bucket) ?? 0,
    })),
    invoices: (invoiceRows as unknown as BillingInvoiceRow[]).map((row) => ({
      ...row,
      entryCount: Number(row.entryCount),
    })),
  }
}
