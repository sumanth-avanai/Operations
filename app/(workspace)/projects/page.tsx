import Link from 'next/link'
import { ChevronRightIcon } from 'lucide-react'
import { getDb } from '@/lib/db/client'
import { listClientOptions, listClientsWithProjects, listMemberOptions } from '@/lib/db/queries/projects'
import { guardPage } from '@/lib/auth/context'
import { can, isProjectScoped } from '@/lib/auth/permissions'
import { makeFormatter } from '@/lib/format'
import { BILLING_METHOD_LABELS, PROJECT_STATUS_LABELS } from '@/lib/domain/types'
import { PageHeader } from '@/components/shared/page-header'
import { ForbiddenPanel } from '@/components/shared/forbidden'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BudgetBar } from '@/components/shared/budget-bar'
import { ParamToggle } from '@/components/shared/param-controls'
import { ClientDialog } from '@/components/projects/client-dialog'
import { ProjectDialog } from '@/components/projects/project-dialog'
import { EmptyState } from '@/components/shared/empty'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Projects' }

const STATUS_VARIANT = {
  on_track: 'ok', at_risk: 'warn', on_hold: 'idle', done: 'info',
} as const

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string; new?: string }>
}) {
  const guard = await guardPage('view_projects', '/projects')
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
  const includeArchived = params.archived === '1'
  const canManage = can(actingMember.role, 'manage_projects')
  const scoped = isProjectScoped(actingMember.role)

  const db = await getDb()
  const [groups, clientOptions, memberOptions] = await Promise.all([
    listClientsWithProjects(db, {
      asOf: today,
      includeArchived,
      ...(scoped ? { ownerMemberId: actingMember.id } : {}),
    }),
    listClientOptions(db),
    listMemberOptions(db),
  ])

  const managers = memberOptions.filter((m) => m.role !== 'logger')
  const visible = groups.filter((group) => group.projects.length > 0)

  return (
    <>
      <PageHeader
        title="Projects"
        description={
          scoped
            ? 'The engagements you own. Budgets are the sum of each project’s role budgets.'
            : 'Clients, their projects, and the roles that carry rates and budgets.'
        }
      >
        <ParamToggle param="archived" active={includeArchived} labelOn="Hide archived" labelOff="Show archived" />
        {canManage ? (
          <>
            <ClientDialog defaultOpen={params.new === 'client'} />
            <ProjectDialog
              clients={clientOptions}
              managers={managers}
              defaultOpen={params.new === 'project'}
            />
          </>
        ) : null}
      </PageHeader>

      {visible.length === 0 ? (
        <EmptyState
          title={scoped ? 'No projects assigned to you' : 'No clients or projects yet'}
          description={
            scoped
              ? 'A Project Manager sees only the engagements they own. Ask an operations lead to assign you.'
              : 'Start with a client, then add a project and the roles that carry its rates and budgets.'
          }
          action={canManage ? <ClientDialog /> : undefined}
        />
      ) : (
        <div className="flex flex-col gap-5">
          {visible.map((group) => (
            <Card key={group.client.id}>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: group.client.color }}
                      aria-hidden
                    />
                    <span className="truncate">{group.client.name}</span>
                    {group.client.archivedAt ? <Badge variant="idle">Archived</Badge> : null}
                  </CardTitle>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {group.projects.length} project{group.projects.length === 1 ? '' : 's'}
                    {group.budget.budgetCents > 0
                      ? ` · ${fmt.moneyShort(group.budget.budgetCents)} budgeted · ${fmt.moneyShort(group.budget.deliveredCents)} delivered`
                      : ''}
                  </p>
                </div>
                {canManage ? (
                  <div className="flex shrink-0 gap-2">
                    <ProjectDialog
                      clients={clientOptions}
                      managers={managers}
                      defaultClientId={group.client.id}
                      trigger={
                        <button className="rounded-md px-2 py-1 text-[13px] font-medium text-primary hover:bg-muted">
                          Add project
                        </button>
                      }
                    />
                  </div>
                ) : null}
              </CardHeader>
              <CardContent className="px-0 pb-1">
                <ul className="divide-y border-t">
                  {group.projects.map((row) => (
                    <li key={row.project.id}>
                      <Link
                        href={`/projects/${row.project.id}`}
                        className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-muted/50"
                      >
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: row.project.color }}
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="truncate text-[13px] font-semibold">{row.project.name}</span>
                            {row.project.code ? (
                              <span className="text-[11px] text-muted-foreground">{row.project.code}</span>
                            ) : null}
                            {!row.project.billable ? <Badge variant="idle">Non-billable</Badge> : null}
                            {row.project.archivedAt ? <Badge variant="idle">Archived</Badge> : null}
                            {row.health ? (
                              <Badge variant={STATUS_VARIANT[row.health.status]}>
                                {PROJECT_STATUS_LABELS[row.health.status]}
                              </Badge>
                            ) : (
                              <Badge variant="outline">No health update</Badge>
                            )}
                            {row.budget.overBudget ? <Badge variant="danger">Over budget</Badge> : null}
                            {!row.budget.overBudget && row.budget.overCommitted ? (
                              <Badge variant="warn">Over-committed</Badge>
                            ) : null}
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                            <span>{BILLING_METHOD_LABELS[row.project.billingMethod]}</span>
                            <span>
                              {row.roleCount} role{row.roleCount === 1 ? '' : 's'} · {row.memberCount}{' '}
                              {row.memberCount === 1 ? 'person' : 'people'}
                            </span>
                            {row.project.billable && row.budget.deliveredCents > 0 ? (
                              <span className="tnum">
                                {fmt.moneyShort(row.budget.deliveredCents)} delivered
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div className="hidden w-52 shrink-0 sm:block">
                          {row.project.billable && row.budget.budgetCents > 0 ? (
                            <BudgetBar budget={row.budget} money={fmt.moneyShort} />
                          ) : (
                            <p className="text-right text-[11px] text-muted-foreground">
                              {row.project.billable ? 'No budget set' : 'Internal work'}
                            </p>
                          )}
                        </div>

                        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
