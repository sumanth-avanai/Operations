import 'server-only'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { rollUpBudgets, type RoleBudget } from '@/lib/domain/budget'
import type { ISODate, ProjectStatusName, RiskLevelName } from '@/lib/domain/types'
import type { Db } from '../client'
import {
  clients, members, projectHealthUpdates, projectRoles, projects, roleAssignments,
  type Client, type Project, type ProjectHealthUpdate,
} from '../schema'
import { loadRoleConsumption, type RoleConsumption } from './consumption'

export type CurrentHealth = {
  status: ProjectStatusName
  risk: RiskLevelName
  satisfaction: number | null
  updateDate: string
  comment: string | null
}

/** Current health is the newest update — projects store no status of their own. */
export async function loadCurrentHealth(db: Db): Promise<Map<string, CurrentHealth>> {
  const res = await db.execute<{
    project_id: string
    status: ProjectStatusName
    risk: RiskLevelName
    satisfaction: number | null
    update_date: string
    comment: string | null
  }>(sql`
    select distinct on (project_id)
           project_id, status, risk, satisfaction, update_date, comment
    from project_health_updates
    order by project_id, update_date desc, created_at desc
  `)
  const rows = res.rows as unknown as {
    project_id: string
    status: ProjectStatusName
    risk: RiskLevelName
    satisfaction: number | null
    update_date: string
    comment: string | null
  }[]
  return new Map(
    rows.map((r) => [
      r.project_id,
      {
        status: r.status,
        risk: r.risk,
        satisfaction: r.satisfaction === null ? null : Number(r.satisfaction),
        updateDate: r.update_date,
        comment: r.comment,
      },
    ]),
  )
}

export type ProjectListRow = {
  project: Project
  clientName: string
  clientColor: string
  roleCount: number
  memberCount: number
  budget: RoleBudget
  health: CurrentHealth | null
}

export type ClientWithProjects = {
  client: Client
  projects: ProjectListRow[]
  budget: RoleBudget
}

/** The projects hub — six bounded queries whatever the size of the portfolio. */
export async function listClientsWithProjects(
  db: Db,
  opts: { asOf: ISODate; includeArchived?: boolean; ownerMemberId?: string },
): Promise<ClientWithProjects[]> {
  const [clientRows, projectRows, roleRows, assignmentRows, consumption, health] = await Promise.all([
    db.select().from(clients).orderBy(asc(clients.name)),
    db
      .select()
      .from(projects)
      .where(
        and(
          opts.includeArchived ? undefined : isNull(projects.archivedAt),
          opts.ownerMemberId ? eq(projects.ownerMemberId, opts.ownerMemberId) : undefined,
        ),
      )
      .orderBy(asc(projects.name)),
    db
      .select({ id: projectRoles.id, projectId: projectRoles.projectId })
      .from(projectRoles)
      .where(isNull(projectRoles.archivedAt)),
    db
      .select({ projectId: projectRoles.projectId, memberId: roleAssignments.memberId })
      .from(roleAssignments)
      .innerJoin(projectRoles, eq(projectRoles.id, roleAssignments.projectRoleId)),
    loadRoleConsumption(db, { asOf: opts.asOf }),
    loadCurrentHealth(db),
  ])

  const rolesByProject = new Map<string, string[]>()
  for (const role of roleRows) {
    const list = rolesByProject.get(role.projectId) ?? []
    list.push(role.id)
    rolesByProject.set(role.projectId, list)
  }

  const membersByProject = new Map<string, Set<string>>()
  for (const row of assignmentRows) {
    const set = membersByProject.get(row.projectId) ?? new Set<string>()
    set.add(row.memberId)
    membersByProject.set(row.projectId, set)
  }

  const clientById = new Map(clientRows.map((c) => [c.id, c]))

  const rows: ProjectListRow[] = projectRows.map((project) => {
    const roleIds = rolesByProject.get(project.id) ?? []
    const budgets = roleIds
      .map((id) => consumption.byRole.get(id)?.budget)
      .filter((b): b is RoleBudget => Boolean(b))
    const client = clientById.get(project.clientId)
    return {
      project,
      clientName: client?.name ?? 'Unknown client',
      clientColor: client?.color ?? 'var(--hue-1)',
      roleCount: roleIds.length,
      memberCount: membersByProject.get(project.id)?.size ?? 0,
      budget: rollUpBudgets(budgets),
      health: health.get(project.id) ?? null,
    }
  })

  const grouped: ClientWithProjects[] = clientRows
    .filter((client) => opts.includeArchived || !client.archivedAt)
    .map((client) => {
      const clientProjects = rows.filter((r) => r.project.clientId === client.id)
      return {
        client,
        projects: clientProjects,
        budget: rollUpBudgets(clientProjects.map((p) => p.budget)),
      }
    })
    .filter((group) => group.projects.length > 0 || !opts.ownerMemberId)

  return grouped
}

export type ProjectRoleDetail = {
  id: string
  name: string
  rateCents: number
  budgetCents: number
  budgetMinutes: number | null
  sortOrder: number
  archivedAt: string | null
  consumption: RoleConsumption | null
  assignees: { id: string; name: string; color: string }[]
}

export type ProjectDetail = {
  project: Project
  client: Client
  ownerName: string | null
  roles: ProjectRoleDetail[]
  budget: RoleBudget
  health: CurrentHealth | null
  healthHistory: (ProjectHealthUpdate & { authorName: string | null })[]
}

/**
 * Just enough to answer "may this role open this project?" before anything else is
 * read. Ownership is checked against this, so a scoped role's page never even loads
 * the engagement it is not allowed to see.
 */
export async function getProjectOwner(
  db: Db,
  projectId: string,
): Promise<{ id: string; name: string; ownerMemberId: string | null } | null> {
  const rows = await db
    .select({ id: projects.id, name: projects.name, ownerMemberId: projects.ownerMemberId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  return rows[0] ?? null
}

export async function getProjectDetail(
  db: Db,
  projectId: string,
  asOf: ISODate,
): Promise<ProjectDetail | null> {
  const projectRows = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
  const project = projectRows[0]
  if (!project) return null

  const [clientRows, roleRows, assignmentRows, consumption, historyRows, ownerRows] = await Promise.all([
    db.select().from(clients).where(eq(clients.id, project.clientId)).limit(1),
    db
      .select()
      .from(projectRoles)
      .where(eq(projectRoles.projectId, projectId))
      .orderBy(asc(projectRoles.sortOrder), asc(projectRoles.name)),
    db
      .select({
        projectRoleId: roleAssignments.projectRoleId,
        memberId: members.id,
        memberName: members.name,
        memberColor: members.color,
      })
      .from(roleAssignments)
      .innerJoin(projectRoles, eq(projectRoles.id, roleAssignments.projectRoleId))
      .innerJoin(members, eq(members.id, roleAssignments.memberId))
      .where(eq(projectRoles.projectId, projectId))
      .orderBy(asc(members.name)),
    loadRoleConsumption(db, { asOf, projectIds: [projectId] }),
    db
      .select({
        id: projectHealthUpdates.id,
        projectId: projectHealthUpdates.projectId,
        updateDate: projectHealthUpdates.updateDate,
        status: projectHealthUpdates.status,
        risk: projectHealthUpdates.risk,
        satisfaction: projectHealthUpdates.satisfaction,
        comment: projectHealthUpdates.comment,
        authorMemberId: projectHealthUpdates.authorMemberId,
        createdAt: projectHealthUpdates.createdAt,
        authorName: members.name,
      })
      .from(projectHealthUpdates)
      .leftJoin(members, eq(members.id, projectHealthUpdates.authorMemberId))
      .where(eq(projectHealthUpdates.projectId, projectId))
      .orderBy(desc(projectHealthUpdates.updateDate), desc(projectHealthUpdates.createdAt)),
    project.ownerMemberId
      ? db.select({ name: members.name }).from(members).where(eq(members.id, project.ownerMemberId)).limit(1)
      : Promise.resolve([]),
  ])

  const client = clientRows[0]
  if (!client) return null

  const assigneesByRole = new Map<string, { id: string; name: string; color: string }[]>()
  for (const row of assignmentRows) {
    const list = assigneesByRole.get(row.projectRoleId) ?? []
    list.push({ id: row.memberId, name: row.memberName, color: row.memberColor })
    assigneesByRole.set(row.projectRoleId, list)
  }

  const roles: ProjectRoleDetail[] = roleRows.map((role) => ({
    id: role.id,
    name: role.name,
    rateCents: role.rateCents,
    budgetCents: role.budgetCents,
    budgetMinutes: role.budgetMinutes,
    sortOrder: role.sortOrder,
    archivedAt: role.archivedAt,
    consumption: consumption.byRole.get(role.id) ?? null,
    assignees: assigneesByRole.get(role.id) ?? [],
  }))

  const current = historyRows[0]

  return {
    project,
    client,
    ownerName: ownerRows[0]?.name ?? null,
    roles,
    budget: rollUpBudgets(roles.map((r) => r.consumption?.budget).filter((b): b is RoleBudget => Boolean(b))),
    health: current
      ? {
          status: current.status,
          risk: current.risk,
          satisfaction: current.satisfaction,
          updateDate: current.updateDate,
          comment: current.comment,
        }
      : null,
    healthHistory: historyRows,
  }
}

export async function listClientOptions(db: Db) {
  return db
    .select({ id: clients.id, name: clients.name, color: clients.color })
    .from(clients)
    .where(isNull(clients.archivedAt))
    .orderBy(asc(clients.name))
}

export async function listMemberOptions(db: Db) {
  return db
    .select({ id: members.id, name: members.name, color: members.color, role: members.role })
    .from(members)
    .where(isNull(members.archivedAt))
    .orderBy(asc(members.name))
}
