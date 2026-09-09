import 'server-only'
import { eq, isNull, sql } from 'drizzle-orm'
import { endOfWeek, startOfWeek } from '@/lib/domain/dates'
import { utilization, type Utilization } from '@/lib/domain/utilization'
import { overCapacityWarning, slippedWorkWarning, type Warning } from '@/lib/domain/guardrails'
import type { ISODate } from '@/lib/domain/types'
import type { Db } from '../client'
import { clients, members, projects } from '../schema'
import { dailyAvailability, loadCapacityContexts, loggedMinutesByMember } from './capacity-context'
import { loadRoleConsumption } from './consumption'
import { priceCents, toNumber } from '../sql-money'

export type HomeMemberRow = {
  memberId: string
  name: string
  color: string
  role: string
  availableMinutes: number
  loggedMinutes: number
  billableMinutes: number
  utilization: Utilization
  /** Enough of the week is filled in to trust the numbers. */
  complete: boolean
}

export type HomeSnapshot = {
  weekStart: ISODate
  weekEnd: ISODate
  totalMinutes: number
  billableMinutes: number
  availableMinutes: number
  members: HomeMemberRow[]
  unbilledCents: number
  unbilledMinutes: number
  guardrails: Warning[]
  counts: { clients: number; projects: number; members: number }
  completeCount: number
  /** True when money and slipped work were limited to the caller's own engagements. */
  scopedToOwner: boolean
}

const COMPLETE_THRESHOLD = 0.95

/**
 * The weekly snapshot: nine bounded queries whatever the size of the team.
 *
 * `ownerMemberId` limits the money figure and the slipped-work callouts to the caller's
 * own engagements. A Project Manager has `view_billing` for their own projects but must
 * never see a global unbilled total, nor a warning naming another manager's project.
 */
export async function getHomeSnapshot(
  db: Db,
  weekDate: ISODate,
  opts: { weekStartDay: number; asOf: ISODate; ownerMemberId?: string },
): Promise<HomeSnapshot> {
  const { weekStartDay, asOf, ownerMemberId } = opts
  const weekStart = startOfWeek(weekDate, weekStartDay)
  const weekEnd = endOfWeek(weekDate, weekStartDay)

  // When scoped, everything that touches money or project names is restricted to the
  // projects this member owns.
  const ownedProjectIds = ownerMemberId
    ? (
        await db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.ownerMemberId, ownerMemberId))
      ).map((row) => row.id)
    : undefined

  const [capacities, logged, dayTotals, consumption, unbilled, counts] = await Promise.all([
    loadCapacityContexts(db, { from: weekStart, to: weekEnd }),
    loggedMinutesByMember(db, { from: weekStart, to: weekEnd }),
    db.execute<{ member_id: string; entry_date: string; minutes: number }>(sql`
      select member_id, entry_date::text, sum(minutes)::bigint as minutes
      from time_entries
      where entry_date between ${weekStart} and ${weekEnd}
      group by member_id, entry_date
    `),
    // An empty owned-project list must produce no consumption at all, not everything.
    ownedProjectIds && ownedProjectIds.length === 0
      ? Promise.resolve({ byRole: new Map(), slipped: [] } as Awaited<ReturnType<typeof loadRoleConsumption>>)
      : loadRoleConsumption(db, ownedProjectIds ? { asOf, projectIds: ownedProjectIds } : { asOf }),
    db.execute<{ cents: number | string; minutes: number | string }>(sql`
      select coalesce(sum(${priceCents()}), 0)::bigint as cents,
             coalesce(sum(te.minutes), 0)::bigint as minutes
      from time_entries te
      join project_roles pr on pr.id = te.project_role_id
      join projects p on p.id = pr.project_id
      where p.billable = true and te.invoice_id is null
      ${ownerMemberId ? sql`and p.owner_member_id = ${ownerMemberId}` : sql``}
    `),
    Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(clients).where(isNull(clients.archivedAt)),
      db.select({ n: sql<number>`count(*)::int` }).from(projects).where(isNull(projects.archivedAt)),
      db.select({ n: sql<number>`count(*)::int` }).from(members).where(isNull(members.archivedAt)),
    ]),
  ])

  const memberRows: HomeMemberRow[] = [...capacities.values()]
    .map((capacity) => {
      const totals = logged.get(capacity.member.id) ?? { loggedMinutes: 0, billableMinutes: 0 }
      return {
        memberId: capacity.member.id,
        name: capacity.member.name,
        color: capacity.member.color,
        role: capacity.member.role,
        availableMinutes: capacity.availableMinutes,
        loggedMinutes: totals.loggedMinutes,
        billableMinutes: totals.billableMinutes,
        utilization: utilization({
          billableMinutes: totals.billableMinutes,
          loggedMinutes: totals.loggedMinutes,
          availableMinutes: capacity.availableMinutes,
          targetPct: capacity.member.utilizationTargetPct,
        }),
        complete:
          capacity.availableMinutes === 0 ||
          totals.loggedMinutes >= capacity.availableMinutes * COMPLETE_THRESHOLD,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  /* over-capacity days this week, compared against real availability */
  const guardrails: Warning[] = []
  const totalsByMemberDay = new Map<string, number>()
  for (const row of dayTotals.rows as unknown as { member_id: string; entry_date: string; minutes: number }[]) {
    totalsByMemberDay.set(`${row.member_id}|${row.entry_date}`, Number(row.minutes))
  }
  for (const capacity of capacities.values()) {
    for (const day of dailyAvailability(capacity, weekStart, weekEnd)) {
      const used = totalsByMemberDay.get(`${capacity.member.id}|${day.date}`) ?? 0
      if (used === 0) continue
      const warning = overCapacityWarning({
        date: day.date,
        usedMinutes: used,
        availableMinutes: day.minutes,
        dateLabel: `${capacity.member.name} · ${day.date}`,
      })
      if (warning) guardrails.push(warning)
    }
  }

  /* slipped work: planned in the past, not delivered */
  if (consumption.slipped.length > 0) {
    const memberNames = new Map([...capacities.values()].map((c) => [c.member.id, c.member.name]))
    const projectNames = await db.execute<{ role_id: string; project_name: string }>(sql`
      select pr.id as role_id, p.name as project_name
      from project_roles pr join projects p on p.id = pr.project_id
      where pr.id in ${consumption.slipped.map((s) => s.projectRoleId)}
    `)
    const nameByRole = new Map(
      (projectNames.rows as unknown as { role_id: string; project_name: string }[]).map((r) => [
        r.role_id,
        r.project_name,
      ]),
    )
    for (const slip of consumption.slipped.slice(0, 8)) {
      const warning = slippedWorkWarning({
        memberName: memberNames.get(slip.memberId) ?? 'Someone',
        projectName: nameByRole.get(slip.projectRoleId) ?? 'a project',
        endDate: slip.endDate,
        bookedMinutes: slip.bookedMinutes,
        loggedMinutes: slip.loggedMinutes,
      })
      if (warning) guardrails.push(warning)
    }
  }

  const unbilledRow = (unbilled.rows as unknown as { cents: number | string; minutes: number | string }[])[0]

  return {
    weekStart,
    weekEnd,
    totalMinutes: memberRows.reduce((sum, m) => sum + m.loggedMinutes, 0),
    billableMinutes: memberRows.reduce((sum, m) => sum + m.billableMinutes, 0),
    availableMinutes: memberRows.reduce((sum, m) => sum + m.availableMinutes, 0),
    members: memberRows,
    unbilledCents: toNumber(unbilledRow?.cents),
    unbilledMinutes: toNumber(unbilledRow?.minutes),
    guardrails,
    counts: {
      clients: Number(counts[0][0]?.n ?? 0),
      projects: Number(counts[1][0]?.n ?? 0),
      members: Number(counts[2][0]?.n ?? 0),
    },
    completeCount: memberRows.filter((m) => m.complete).length,
    scopedToOwner: Boolean(ownerMemberId),
  }
}
