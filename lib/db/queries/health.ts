import 'server-only'
import { asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { rollUpBudgets, type RoleBudget } from '@/lib/domain/budget'
import type { ISODate, ProjectStatusName, RiskLevelName } from '@/lib/domain/types'
import type { Db } from '../client'
import { clients, members, projectHealthUpdates, projectRoles, projects } from '../schema'
import { loadCurrentHealth, type CurrentHealth } from './projects'
import { loadRoleConsumption } from './consumption'

export type StatusBoardRow = {
  projectId: string
  projectName: string
  projectColor: string
  clientName: string
  billable: boolean
  ownerName: string | null
  health: CurrentHealth | null
  budget: RoleBudget
  updateCount: number
  latestComment: string | null
  /** Newest few updates, so the board can show the trail without a second page. */
  recent: {
    id: string
    status: ProjectStatusName
    risk: RiskLevelName
    satisfaction: number | null
    comment: string | null
    updateDate: string
    authorName: string | null
  }[]
}

/** The portfolio health board — five bounded queries. */
export async function getStatusBoard(
  db: Db,
  opts: { asOf: ISODate; includeArchived?: boolean; ownerMemberId?: string },
): Promise<StatusBoardRow[]> {
  const [projectRows, roleRows, consumption, health, updateRows] = await Promise.all([
    db
      .select({
        id: projects.id,
        name: projects.name,
        color: projects.color,
        billable: projects.billable,
        archivedAt: projects.archivedAt,
        clientName: clients.name,
        ownerName: members.name,
      })
      .from(projects)
      .innerJoin(clients, eq(clients.id, projects.clientId))
      .leftJoin(members, eq(members.id, projects.ownerMemberId))
      .where(
        opts.includeArchived
          ? opts.ownerMemberId
            ? eq(projects.ownerMemberId, opts.ownerMemberId)
            : undefined
          : opts.ownerMemberId
            ? sql`${projects.archivedAt} is null and ${projects.ownerMemberId} = ${opts.ownerMemberId}`
            : isNull(projects.archivedAt),
      )
      .orderBy(asc(clients.name), asc(projects.name)),
    db
      .select({ id: projectRoles.id, projectId: projectRoles.projectId })
      .from(projectRoles)
      .where(isNull(projectRoles.archivedAt)),
    loadRoleConsumption(db, { asOf: opts.asOf }),
    loadCurrentHealth(db),
    db
      .select({
        id: projectHealthUpdates.id,
        projectId: projectHealthUpdates.projectId,
        status: projectHealthUpdates.status,
        risk: projectHealthUpdates.risk,
        satisfaction: projectHealthUpdates.satisfaction,
        comment: projectHealthUpdates.comment,
        updateDate: projectHealthUpdates.updateDate,
        authorName: members.name,
      })
      .from(projectHealthUpdates)
      .leftJoin(members, eq(members.id, projectHealthUpdates.authorMemberId))
      .orderBy(desc(projectHealthUpdates.updateDate), desc(projectHealthUpdates.createdAt)),
  ])

  const rolesByProject = new Map<string, string[]>()
  for (const role of roleRows) {
    const list = rolesByProject.get(role.projectId) ?? []
    list.push(role.id)
    rolesByProject.set(role.projectId, list)
  }

  const updatesByProject = new Map<string, typeof updateRows>()
  for (const update of updateRows) {
    const list = updatesByProject.get(update.projectId) ?? []
    list.push(update)
    updatesByProject.set(update.projectId, list)
  }

  return projectRows.map((project) => {
    const budgets = (rolesByProject.get(project.id) ?? [])
      .map((roleId) => consumption.byRole.get(roleId)?.budget)
      .filter((b): b is RoleBudget => Boolean(b))
    const updates = updatesByProject.get(project.id) ?? []
    return {
      projectId: project.id,
      projectName: project.name,
      projectColor: project.color,
      clientName: project.clientName,
      billable: project.billable,
      ownerName: project.ownerName,
      health: health.get(project.id) ?? null,
      budget: rollUpBudgets(budgets),
      updateCount: updates.length,
      latestComment: updates[0]?.comment ?? null,
      recent: updates.slice(0, 3).map((update) => ({
        id: update.id,
        status: update.status,
        risk: update.risk,
        satisfaction: update.satisfaction,
        comment: update.comment,
        updateDate: update.updateDate,
        authorName: update.authorName,
      })),
    }
  })
}
