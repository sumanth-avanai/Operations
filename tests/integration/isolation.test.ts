/**
 * What each role can and cannot READ.
 *
 * The action tests prove nobody can WRITE outside their remit. This file proves nobody
 * can SEE outside it either — which is the harder half, because a read leak is silent.
 * Every query function is run through the role that must not see everything, and the
 * returned rows are checked against what that role owns.
 *
 * If someone later widens a query, these fail.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootWorkspace, type Workspace } from './helpers'
import { CAPABILITIES, can, canTouchProject, capabilitiesFor } from '@/lib/auth/permissions'
import { MEMBER_ROLES, type MemberRoleName } from '@/lib/domain/types'
import { today } from '@/lib/domain/dates'
import { DEMO_TIME_ZONE } from '@/lib/db/seed'

let ws: Workspace

/**
 * The workspace's day, resolved in the demo workspace's own zone. Every query that
 * measures anything "as of today" now takes it as an argument, so these tests are
 * asking the same question the pages ask.
 */
const asOf = today(DEMO_TIME_ZONE)

beforeAll(async () => {
  ws = await bootWorkspace()
}, 180_000)

afterAll(() => ws?.cleanup())

type Pm = { id: string; name: string; projectIds: string[]; projectNames: string[] }

/** The two seeded Project Managers, with the engagements each of them owns. */
async function projectManagers(): Promise<Pm[]> {
  const rows = await ws.db.execute(ws.sql`
    select m.id, m.name, p.id as project_id, p.name as project_name
    from members m
    left join projects p on p.owner_member_id = m.id
    where m.role = 'project_manager'
    order by m.name
  `)
  const byId = new Map<string, Pm>()
  for (const row of rows.rows as unknown as {
    id: string
    name: string
    project_id: string | null
    project_name: string | null
  }[]) {
    const pm = byId.get(row.id) ?? { id: row.id, name: row.name, projectIds: [], projectNames: [] }
    if (row.project_id) {
      pm.projectIds.push(row.project_id)
      pm.projectNames.push(row.project_name!)
    }
    byId.set(row.id, pm)
  }
  return [...byId.values()]
}

describe('the role matrix is exactly what the PRD specifies', () => {
  // Pinned as data: widening a role fails here rather than silently shipping.
  const EXPECTED: Record<MemberRoleName, string[]> = {
    owner_admin: [...CAPABILITIES],
    operations_lead: CAPABILITIES.filter((c) => c !== 'manage_security'),
    resource_manager: [
      'manage_projects', 'manage_assignments', 'manage_bookings',
      'view_planner', 'view_projects', 'view_members', 'view_reports',
    ],
    project_manager: [
      'manage_projects', 'manage_assignments', 'manage_health',
      'view_projects', 'view_members', 'view_planner', 'view_billing', 'view_reports',
    ],
    finance: ['manage_billing', 'view_billing', 'view_reports', 'view_projects', 'view_members'],
    logger: [],
  }

  for (const role of MEMBER_ROLES) {
    it(`${role} has exactly its documented capabilities`, () => {
      expect([...capabilitiesFor(role)].sort()).toEqual([...EXPECTED[role]].sort())
    })
  }

  it('never lets a logger reach a single workspace capability', () => {
    for (const capability of CAPABILITIES) expect(can('logger', capability)).toBe(false)
  })

  it('keeps workspace security to the Owner alone', () => {
    for (const role of MEMBER_ROLES) {
      expect(can(role, 'manage_security')).toBe(role === 'owner_admin')
    }
  })

  it('keeps invoicing away from everyone who plans or delivers', () => {
    expect(can('resource_manager', 'manage_billing')).toBe(false)
    expect(can('project_manager', 'manage_billing')).toBe(false)
    expect(can('logger', 'manage_billing')).toBe(false)
  })

  it('keeps money entirely away from the Resource Manager', () => {
    expect(can('resource_manager', 'view_billing')).toBe(false)
    expect(can('resource_manager', 'manage_billing')).toBe(false)
  })
})

describe('credentials never leave the query layer', () => {
  it('strips the PIN hash and portal token from the members list', async () => {
    const { listMembers } = await import('@/lib/db/queries/members')
    const rows = await listMembers(ws.db, { from: '2020-01-01', to: today() })
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const keys = Object.keys(row.member)
      expect(keys).not.toContain('pinHash')
      expect(keys).not.toContain('pinSalt')
      expect(keys).not.toContain('portalToken')
    }
    // and the whole serialized payload contains no token-shaped string
    const serialized = JSON.stringify(rows)
    const tokens = await ws.db.execute(ws.sql`select portal_token from members`)
    for (const row of tokens.rows as unknown as { portal_token: string }[]) {
      expect(serialized).not.toContain(row.portal_token)
    }
  })

  it('strips them from the member detail too, exposing the link only as its own field', async () => {
    const { getMemberDetail } = await import('@/lib/db/queries/members')
    const [member] = (
      await ws.db.execute(ws.sql`select id from members order by name limit 1`)
    ).rows as unknown as { id: string }[]
    const detail = await getMemberDetail(ws.db, member!.id, { from: '2020-01-01', to: today() })
    expect(detail).toBeTruthy()
    if (!detail) return

    const keys = Object.keys(detail.member)
    expect(keys).not.toContain('pinHash')
    expect(keys).not.toContain('pinSalt')
    expect(keys).not.toContain('portalToken')

    // The token is reachable, but only through the field a page must gate.
    expect(detail.portal.token.length).toBeGreaterThan(30)
    expect(typeof detail.portal.hasPin).toBe('boolean')
    expect(JSON.stringify(detail.member)).not.toContain(detail.portal.token)
  })

  it('strips them from the timesheet week and the acting context too', async () => {
    const { getTimesheetWeek } = await import('@/lib/db/queries/timesheet')
    const [row] = (
      await ws.db.execute(ws.sql`select member_id from time_entries limit 1`)
    ).rows as unknown as { member_id: string }[]
    const week = await getTimesheetWeek(ws.db, row!.member_id, asOf, { weekStartDay: 1, asOf })
    expect(week).toBeTruthy()
    if (!week) return
    for (const key of ['pinHash', 'pinSalt', 'portalToken']) {
      expect(Object.keys(week.member)).not.toContain(key)
    }

    // And the identity a page acts as.
    const { actAs } = await import('./helpers')
    await actAs(ws, 'owner_admin')
    const { getWorkspaceContext } = await import('@/lib/auth/context')
    const ctx = await getWorkspaceContext()
    expect(ctx?.actingMember).toBeTruthy()
    for (const key of ['pinHash', 'pinSalt', 'portalToken']) {
      expect(Object.keys(ctx!.actingMember!)).not.toContain(key)
    }
  })

  it('never exposes a workspace password hash through the settings the pages read', async () => {
    // getSettings intentionally returns the row, so the risk is a page passing it to a
    // client component. Assert the hash is not something a formatter would carry.
    const { makeFormatter } = await import('@/lib/format')
    const { getSettings } = await import('@/lib/auth/context')
    const settings = await getSettings()
    const formatter = makeFormatter(settings)
    expect(JSON.stringify(Object.keys(formatter))).not.toContain('password')
    expect(settings.passwordHash.length).toBeGreaterThan(0)
  })
})

describe('a Project Manager reads only their own engagements', () => {
  it('sees only their own projects in the projects hub', async () => {
    const { listClientsWithProjects } = await import('@/lib/db/queries/projects')
    const [pm, other] = await projectManagers()
    expect(pm && other, 'the seed must have two project managers').toBeTruthy()
    if (!pm || !other) return

    const scoped = await listClientsWithProjects(ws.db, { asOf, ownerMemberId: pm.id })
    const visible = scoped.flatMap((group) => group.projects.map((p) => p.project.id))
    expect(visible.length).toBeGreaterThan(0)
    for (const id of visible) expect(pm.projectIds).toContain(id)
    for (const id of other.projectIds) expect(visible).not.toContain(id)

    // and unscoped really is wider, so the test above is meaningful
    const unscoped = await listClientsWithProjects(ws.db, { asOf })
    const all = unscoped.flatMap((group) => group.projects.map((p) => p.project.id))
    expect(all.length).toBeGreaterThan(visible.length)
  })

  it('cannot open another manager’s project', async () => {
    const { getProjectOwner } = await import('@/lib/db/queries/projects')
    const [pm, other] = await projectManagers()
    if (!pm || !other || other.projectIds.length === 0) return

    const owner = await getProjectOwner(ws.db, other.projectIds[0]!)
    expect(owner).toBeTruthy()
    expect(canTouchProject('project_manager', pm.id, owner!)).toBe(false)
    expect(canTouchProject('project_manager', other.id, owner!)).toBe(true)
    // and nobody else is scoped
    expect(canTouchProject('operations_lead', pm.id, owner!)).toBe(true)
    expect(canTouchProject('finance', pm.id, owner!)).toBe(true)
  })

  it('sees billing figures only for their own projects', async () => {
    const { getBillingData } = await import('@/lib/db/queries/billing')
    const [pm, other] = await projectManagers()
    if (!pm || !other) return
    const range = { from: '2020-01-01', to: asOf }

    const scoped = await getBillingData(ws.db, {
      ...range,
      asOf,
      groupBy: 'project',
      ownerMemberId: pm.id,
    })
    const global = await getBillingData(ws.db, { ...range, asOf, groupBy: 'project' })

    for (const row of scoped.rows) {
      expect(pm.projectIds, `${row.label} is not theirs`).toContain(row.projectId!)
    }
    for (const row of scoped.invoiceable) expect(pm.projectIds).toContain(row.projectId)
    expect(scoped.totals.loggedCents).toBeLessThan(global.totals.loggedCents)
    expect(scoped.totals.loggedCents).toBeGreaterThan(0)
    // the identity still holds inside the narrower scope
    expect(scoped.totals.loggedCents).toBe(
      scoped.totals.invoicedCents + scoped.totals.unbilledCents,
    )
    // no other manager's project name appears anywhere in the payload
    const serialized = JSON.stringify(scoped)
    for (const name of other.projectNames) {
      if (pm.projectNames.includes(name)) continue
      expect(serialized).not.toContain(name)
    }
  })

  it('sees report revenue only from their own projects', async () => {
    const { getReportData } = await import('@/lib/db/queries/reports')
    const [pm, other] = await projectManagers()
    if (!pm || !other) return
    const range = { from: '2020-01-01', to: today() }

    const scoped = await getReportData(ws.db, { ...range, groupBy: 'project', ownerMemberId: pm.id })
    const global = await getReportData(ws.db, { ...range, groupBy: 'project' })

    expect(scoped.scopedToOwner).toBe(true)
    expect(scoped.numeratorFiltered).toBe(true)
    for (const row of scoped.rows) expect(pm.projectIds).toContain(row.key)
    expect(scoped.totals.revenueCents).toBeLessThan(global.totals.revenueCents)
    expect(scoped.totals.revenueCents).toBeGreaterThan(0)

    // Availability is deliberately NOT narrowed — that asymmetry is the documented
    // behaviour, and the report says so.
    expect(scoped.totals.availableMinutes).toBe(global.totals.availableMinutes)
  })

  it('sees planner bookings only on their own projects, but everyone’s availability', async () => {
    const { getPlannerData, allBookableAssignments } = await import('@/lib/db/queries/planner')
    const [pm, other] = await projectManagers()
    if (!pm || !other) return

    const scoped = await getPlannerData(ws.db, {
      scale: 'quarter',
      ref: asOf,
      weekStartDay: 1,
      asOf,
      ownerMemberId: pm.id,
    })
    const global = await getPlannerData(ws.db, {
      scale: 'quarter',
      ref: asOf,
      weekStartDay: 1,
      asOf,
    })

    expect(scoped.scopedToOwner).toBe(true)
    for (const booking of scoped.bookings) expect(pm.projectIds).toContain(booking.projectId)
    expect(scoped.bookings.length).toBeLessThan(global.bookings.length)
    // availability rows are unchanged — who is free is staffing information
    expect(scoped.rows.length).toBe(global.rows.length)
    expect(scoped.rows.reduce((s, r) => s + r.availableMinutes, 0)).toBe(
      global.rows.reduce((s, r) => s + r.availableMinutes, 0),
    )

    const assignments = await allBookableAssignments(ws.db, pm.id)
    for (const assignment of assignments) expect(pm.projectIds).toContain(assignment.projectId)
    expect((await allBookableAssignments(ws.db)).length).toBeGreaterThan(assignments.length)
  })

  it('sees a status board of only their own projects', async () => {
    const { getStatusBoard } = await import('@/lib/db/queries/health')
    const [pm, other] = await projectManagers()
    if (!pm || !other) return

    const scoped = await getStatusBoard(ws.db, { asOf, ownerMemberId: pm.id })
    const global = await getStatusBoard(ws.db, { asOf })
    expect(scoped.length).toBeGreaterThan(0)
    for (const row of scoped) expect(pm.projectIds).toContain(row.projectId)
    expect(global.length).toBeGreaterThan(scoped.length)
  })

  it('sees no global unbilled total and no other manager’s slipped work on Home', async () => {
    const { getHomeSnapshot } = await import('@/lib/db/queries/home')
    const [pm, other] = await projectManagers()
    if (!pm || !other) return

    const scoped = await getHomeSnapshot(ws.db, asOf, {
      weekStartDay: 1,
      asOf,
      ownerMemberId: pm.id,
    })
    const global = await getHomeSnapshot(ws.db, asOf, { weekStartDay: 1, asOf })

    expect(scoped.scopedToOwner).toBe(true)
    expect(global.scopedToOwner).toBe(false)
    expect(scoped.unbilledCents).toBeLessThan(global.unbilledCents)

    // No warning may name a project this manager does not own.
    const serialized = JSON.stringify(scoped.guardrails)
    for (const name of other.projectNames) {
      if (pm.projectNames.includes(name)) continue
      expect(serialized).not.toContain(name)
    }
  })

  it('produces no consumption at all when a manager owns nothing', async () => {
    const { getHomeSnapshot } = await import('@/lib/db/queries/home')
    // A member who owns no project must see zero money, not everything.
    const [logger] = (
      await ws.db.execute(ws.sql`
        select id from members
        where role = 'logger' and id not in (select coalesce(owner_member_id, id) from projects)
        limit 1
      `)
    ).rows as unknown as { id: string }[]
    if (!logger) return
    const scoped = await getHomeSnapshot(ws.db, asOf, {
      weekStartDay: 1,
      asOf,
      ownerMemberId: logger.id,
    })
    expect(scoped.unbilledCents).toBe(0)
    expect(scoped.guardrails.filter((w) => w.code === 'slipped_work')).toHaveLength(0)
  })
})

describe('the personal portal discloses nothing before the PIN', () => {
  it('treats an unknown token exactly like a real one that is off', async () => {
    const { getPortalState } = await import('@/lib/auth/context')
    const unknown = await getPortalState('this-token-does-not-exist-at-all-000000')
    expect(unknown.state).toBe('inactive')
    expect(JSON.stringify(unknown)).toBe(JSON.stringify({ state: 'inactive' }))
  })

  it('reports a revoked link as inactive, with no member detail', async () => {
    const { getPortalState } = await import('@/lib/auth/context')
    const [member] = (
      await ws.db.execute(ws.sql`select id, name, email, portal_token from members limit 1`)
    ).rows as unknown as { id: string; name: string; email: string; portal_token: string }[]

    await ws.db.execute(ws.sql`update members set portal_revoked = true where id = ${member!.id}`)
    const revoked = await getPortalState(member!.portal_token)
    expect(revoked.state).toBe('inactive')
    expect(JSON.stringify(revoked)).not.toContain(member!.name)
    expect(JSON.stringify(revoked)).not.toContain(member!.email)
    await ws.db.execute(ws.sql`update members set portal_revoked = false where id = ${member!.id}`)
  })

  it('reports an archived member’s link as inactive', async () => {
    const { getPortalState } = await import('@/lib/auth/context')
    const [member] = (
      await ws.db.execute(ws.sql`select id, name, portal_token from members where role = 'logger' limit 1`)
    ).rows as unknown as { id: string; name: string; portal_token: string }[]

    await ws.db.execute(ws.sql`update members set archived_at = now() where id = ${member!.id}`)
    const archived = await getPortalState(member!.portal_token)
    expect(archived.state).toBe('inactive')
    await ws.db.execute(ws.sql`update members set archived_at = null where id = ${member!.id}`)
  })

  it('leaks no name or email in the locked state', async () => {
    const { getPortalState } = await import('@/lib/auth/context')
    const [member] = (
      await ws.db.execute(ws.sql`select id, name, email, portal_token from members where role = 'logger' limit 1`)
    ).rows as unknown as { id: string; name: string; email: string; portal_token: string }[]

    const locked = await getPortalState(member!.portal_token)
    expect(locked.state).toBe('locked')
    const serialized = JSON.stringify(locked)
    expect(serialized).not.toContain(member!.name)
    expect(serialized).not.toContain(member!.email)
    expect(serialized).not.toContain('pinHash')
  })
})

describe('per-member data stays per-member', () => {
  it('returns only the requested member’s week, entries and bookings', async () => {
    const { getTimesheetWeek } = await import('@/lib/db/queries/timesheet')
    const rows = (
      await ws.db.execute(ws.sql`
        select distinct member_id from time_entries limit 2
      `)
    ).rows as unknown as { member_id: string }[]
    if (rows.length < 2) return
    const [a, b] = rows

    const week = await getTimesheetWeek(ws.db, a!.member_id, asOf, { weekStartDay: 1, asOf })
    expect(week).toBeTruthy()
    if (!week) return
    expect(week.member.id).toBe(a!.member_id)
    expect(JSON.stringify(week)).not.toContain(b!.member_id)
  })

  it('returns only the requested member’s notifications', async () => {
    const { listNotificationsFor } = await import('@/lib/db/queries/notifications')
    const rows = (
      await ws.db.execute(ws.sql`select distinct member_id from notifications limit 2`)
    ).rows as unknown as { member_id: string }[]
    if (rows.length < 2) return

    const mine = await listNotificationsFor(ws.db, rows[0]!.member_id)
    const theirs = await listNotificationsFor(ws.db, rows[1]!.member_id)
    expect(mine.length).toBeGreaterThan(0)
    const mineIds = new Set(mine.map((n) => n.id))
    for (const notification of theirs) expect(mineIds.has(notification.id)).toBe(false)
  })

  it('exposes no notification READ as a server action', async () => {
    // Every export of a 'use server' module is an endpoint the browser can call with
    // arbitrary arguments. A read that takes a memberId must therefore live in the query
    // layer, not here — this asserts nobody moves it back.
    const actions = await import('@/lib/actions/notifications')
    const exported = Object.keys(actions)
    expect(exported.sort()).toEqual(['markAllNotificationsRead', 'markNotificationsRead'])
    for (const name of exported) expect(name.startsWith('list')).toBe(false)
  })

  it('marks only the acting member’s notifications read, whatever ids are passed', async () => {
    const { actAs } = await import('./helpers')
    const { markNotificationsRead } = await import('@/lib/actions/notifications')

    const acting = await actAs(ws, 'owner_admin')
    // Somebody else's unread notification.
    const [victim] = (
      await ws.db.execute(ws.sql`
        select id, member_id from notifications
        where member_id <> ${acting.id} and read_at is null limit 1
      `)
    ).rows as unknown as { id: string; member_id: string }[]
    if (!victim) return

    const result = await markNotificationsRead([victim.id])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.count).toBe(0)

    const after = (
      await ws.db.execute(ws.sql`select read_at from notifications where id = ${victim.id}`)
    ).rows as unknown as { read_at: string | null }[]
    expect(after[0]!.read_at).toBeNull()
  })

  it('rejects a malformed notification id instead of raising from the database', async () => {
    const { actAs } = await import('./helpers')
    const { markNotificationsRead } = await import('@/lib/actions/notifications')
    await actAs(ws, 'owner_admin')
    const result = await markNotificationsRead(['not-a-uuid'])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid')
  })
})
