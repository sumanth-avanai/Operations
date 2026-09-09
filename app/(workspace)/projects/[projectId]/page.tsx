import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeftIcon } from 'lucide-react'
import { getDb } from '@/lib/db/client'
import {
  getProjectDetail, getProjectOwner, listClientOptions, listMemberOptions,
} from '@/lib/db/queries/projects'
import { guardPage } from '@/lib/auth/context'
import { can, canTouchProject } from '@/lib/auth/permissions'
import { makeFormatter } from '@/lib/format'
import { formatHours } from '@/lib/domain/money'
import { BILLING_METHOD_LABELS, PROJECT_STATUS_LABELS, RISK_LABELS } from '@/lib/domain/types'
import { PageHeader } from '@/components/shared/page-header'
import { ForbiddenPanel } from '@/components/shared/forbidden'
import { Stat, StatRow } from '@/components/shared/stat'
import { BudgetBar, BudgetMeter } from '@/components/shared/budget-bar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ProjectDialog } from '@/components/projects/project-dialog'
import { RoleDialog } from '@/components/projects/role-dialog'
import { AssignmentEditor } from '@/components/projects/assignment-editor'
import { ArchiveToggle } from '@/components/projects/archive-toggle'
import { HealthDialog } from '@/components/status/health-dialog'
import { HealthHistory } from '@/components/status/health-history'

export const dynamic = 'force-dynamic'

const STATUS_VARIANT = { on_track: 'ok', at_risk: 'warn', on_hold: 'idle', done: 'info' } as const
const RISK_VARIANT = { low: 'ok', medium: 'warn', high: 'danger' } as const

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const guard = await guardPage('view_projects', `/projects/${projectId}`)
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
  const db = await getDb()

  // Ownership is resolved BEFORE the engagement is read, so a scoped role never causes
  // the project's figures to be loaded at all.
  const owner = await getProjectOwner(db, projectId)
  if (!owner) notFound()
  if (!canTouchProject(actingMember.role, actingMember.id, owner)) {
    return (
      <ForbiddenPanel
        capability="view_projects"
        memberName={actingMember.name}
        role={actingMember.role}
      />
    )
  }

  const [detail, clientOptions, memberOptions] = await Promise.all([
    getProjectDetail(db, projectId, today),
    listClientOptions(db),
    listMemberOptions(db),
  ])
  if (!detail) notFound()

  const canManage = can(actingMember.role, 'manage_projects')
  const canAssign = can(actingMember.role, 'manage_assignments')
  const canHealth = can(actingMember.role, 'manage_health')

  const loggedMinutes = detail.roles.reduce((sum, role) => sum + (role.consumption?.loggedMinutes ?? 0), 0)
  const committedMinutes = detail.roles.reduce(
    (sum, role) => sum + (role.consumption?.committedMinutes ?? 0),
    0,
  )
  const staleMinutes = detail.roles.reduce(
    (sum, role) => sum + (role.consumption?.staleMinutes ?? 0),
    0,
  )
  const assignable = memberOptions.map((m) => ({ id: m.id, name: m.name, color: m.color }))
  const managers = memberOptions.filter((m) => m.role !== 'logger')

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href="/projects">
          <ArrowLeftIcon />
          All projects
        </Link>
      </Button>

      <PageHeader
        title={detail.project.name}
        description={`${detail.client.name} · ${BILLING_METHOD_LABELS[detail.project.billingMethod]}${
          detail.ownerName ? ` · managed by ${detail.ownerName}` : ''
        }${detail.project.billable ? '' : ' · non-billable'}`}
      >
        {detail.health ? (
          <>
            <Badge variant={STATUS_VARIANT[detail.health.status]}>
              {PROJECT_STATUS_LABELS[detail.health.status]}
            </Badge>
            <Badge variant={RISK_VARIANT[detail.health.risk]}>{RISK_LABELS[detail.health.risk]}</Badge>
          </>
        ) : (
          <Badge variant="outline">No health update yet</Badge>
        )}
        {canHealth ? (
          <HealthDialog
            projectId={detail.project.id}
            projectName={detail.project.name}
            current={detail.health}
            today={today}
          />
        ) : null}
        {canManage ? (
          <>
            <ProjectDialog
              clients={clientOptions}
              managers={managers}
              project={{
                id: detail.project.id,
                clientId: detail.project.clientId,
                name: detail.project.name,
                code: detail.project.code,
                color: detail.project.color,
                billable: detail.project.billable,
                billingMethod: detail.project.billingMethod,
                startDate: detail.project.startDate,
                endDate: detail.project.endDate,
                ownerMemberId: detail.project.ownerMemberId,
                notes: detail.project.notes,
              }}
              trigger={<Button size="sm">Edit project</Button>}
            />
            <ArchiveToggle
              kind="project"
              id={detail.project.id}
              name={detail.project.name}
              archived={Boolean(detail.project.archivedAt)}
            />
          </>
        ) : null}
      </PageHeader>

      <StatRow>
        <Stat
          label="Budget"
          value={detail.budget.budgetCents === 0 ? '—' : fmt.moneyShort(detail.budget.budgetCents)}
          hint="Sum of this project's role budgets"
        />
        <Stat
          label="Delivered"
          value={fmt.moneyShort(detail.budget.deliveredCents)}
          hint={`${formatHours(loggedMinutes, { zero: '0' })}h logged`}
        />
        <Stat
          label="Committed"
          value={fmt.moneyShort(detail.budget.committedCents)}
          hint={`${formatHours(committedMinutes, { zero: '0' })}h still to deliver from today`}
          tone="info"
        />
        <Stat
          label={detail.budget.remainingCents < 0 ? 'Over budget by' : 'Remaining'}
          value={fmt.moneyShort(Math.abs(detail.budget.remainingCents))}
          tone={detail.budget.remainingCents < 0 ? 'danger' : 'ok'}
          hint={fmt.percent(detail.budget.consumedPct) + ' of budget consumed'}
        />
      </StatRow>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Roles, rates and budgets</CardTitle>
            <CardDescription>
              Each role holds its own rate and budget. Delivered comes from logged hours;
              committed comes from confirmed bookings from today onward that have not been
              delivered yet. Booked days already past are shown as slipped instead — they no
              longer hold budget.
            </CardDescription>
          </div>
          {canManage ? (
            <RoleDialog
              projectId={detail.project.id}
              currency={settings.currency}
              defaultRate={(settings.defaultRateCents / 100).toFixed(2)}
              nextSortOrder={detail.roles.length}
            />
          ) : null}
        </CardHeader>
        <CardContent className="px-0 pb-2">
          {detail.roles.length === 0 ? (
            <p className="px-5 py-6 text-center text-[13px] text-muted-foreground">
              No roles yet. Add one to set a rate and a budget — until then nobody can log time
              against this project.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>People</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Budget</TableHead>
                  <TableHead className="text-right">Delivered</TableHead>
                  <TableHead className="text-right">Committed</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead className="w-32">Consumed</TableHead>
                  {canManage ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.roles.map((role) => {
                  const budget = role.consumption?.budget
                  const over = budget ? budget.remainingCents < 0 : false
                  return (
                    <TableRow key={role.id}>
                      <TableCell>
                        <span className="font-medium">{role.name}</span>
                        {role.archivedAt ? (
                          <Badge variant="idle" className="ml-2">
                            Archived
                          </Badge>
                        ) : null}
                        {role.consumption ? (
                          <span className="block text-[11px] text-muted-foreground tnum">
                            {formatHours(role.consumption.loggedMinutes, { zero: '0' })}h logged
                            {role.budgetMinutes
                              ? ` of ${formatHours(role.budgetMinutes, { zero: '0' })}h budgeted`
                              : ''}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <AssignmentEditor
                          projectRoleId={role.id}
                          roleName={role.name}
                          assigned={role.assignees}
                          members={assignable}
                          canManage={canAssign}
                        />
                      </TableCell>
                      <TableCell className="text-right tnum">{fmt.money(role.rateCents)}</TableCell>
                      <TableCell className="text-right tnum">
                        {role.budgetCents === 0 ? '—' : fmt.moneyShort(role.budgetCents)}
                      </TableCell>
                      <TableCell className="text-right tnum">
                        {fmt.moneyShort(budget?.deliveredCents ?? 0)}
                      </TableCell>
                      <TableCell className="text-right tnum text-muted-foreground">
                        {fmt.moneyShort(budget?.committedCents ?? 0)}
                      </TableCell>
                      <TableCell
                        className="text-right font-semibold tnum"
                        style={{ color: over ? 'var(--danger)' : undefined }}
                      >
                        {budget
                          ? over
                            ? `−${fmt.moneyShort(Math.abs(budget.remainingCents))}`
                            : fmt.moneyShort(budget.remainingCents)
                          : '—'}
                      </TableCell>
                      <TableCell>
                        {budget ? <BudgetMeter budget={budget} /> : null}
                        {budget ? (
                          <span className="mt-1 block text-[10px] text-muted-foreground tnum">
                            {fmt.percent(budget.consumedPct)}
                            {budget.tentativeCents > 0
                              ? ` · ${fmt.moneyShort(budget.tentativeCents)} tentative`
                              : ''}
                          </span>
                        ) : null}
                      </TableCell>
                      {canManage ? (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <RoleDialog
                              projectId={detail.project.id}
                              currency={settings.currency}
                              defaultRate={(settings.defaultRateCents / 100).toFixed(2)}
                              nextSortOrder={role.sortOrder}
                              role={{
                                id: role.id,
                                name: role.name,
                                rate: (role.rateCents / 100).toFixed(2),
                                budget: (role.budgetCents / 100).toFixed(2),
                                budgetHours: role.budgetMinutes ? String(role.budgetMinutes / 60) : '',
                                sortOrder: role.sortOrder,
                              }}
                              trigger={
                                <button className="rounded-md px-2 py-1 text-[12px] font-medium text-primary hover:bg-muted">
                                  Edit
                                </button>
                              }
                            />
                            <ArchiveToggle
                              kind="role"
                              id={role.id}
                              name={role.name}
                              archived={Boolean(role.archivedAt)}
                              size="xs"
                            />
                          </div>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[2fr_3fr]">
        <Card>
          <CardHeader>
            <CardTitle>Budget at a glance</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <BudgetBar budget={detail.budget} money={fmt.moneyShort} />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
              <dt className="text-muted-foreground">Dates</dt>
              <dd className="tnum">
                {detail.project.startDate ? fmt.date(detail.project.startDate) : '—'}
                {detail.project.endDate ? ` – ${fmt.date(detail.project.endDate)}` : ''}
              </dd>
              <dt className="text-muted-foreground">Client satisfaction</dt>
              <dd>
                {detail.health?.satisfaction ? `${detail.health.satisfaction} / 5` : 'Not recorded'}
              </dd>
              <dt className="text-muted-foreground">Tentative work</dt>
              <dd className="tnum">{fmt.moneyShort(detail.budget.tentativeCents)}</dd>
              <dt className="text-muted-foreground">Slipped, not re-planned</dt>
              <dd className="tnum">
                {staleMinutes === 0
                  ? '—'
                  : `${fmt.moneyShort(detail.budget.staleCents)} · ${formatHours(staleMinutes)}h`}
              </dd>
            </dl>
            {detail.project.notes ? (
              <p className="rounded-lg bg-muted px-3 py-2 text-[13px] whitespace-pre-line">
                {detail.project.notes}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Health history</CardTitle>
            <CardDescription>Every update is kept — ideal for a status meeting.</CardDescription>
          </CardHeader>
          <CardContent>
            <HealthHistory
              updates={detail.healthHistory.map((update) => ({
                id: update.id,
                status: update.status,
                risk: update.risk,
                satisfaction: update.satisfaction,
                comment: update.comment,
                authorName: update.authorName,
                dateLabel: fmt.date(update.updateDate),
              }))}
            />
          </CardContent>
        </Card>
      </div>
    </>
  )
}
