import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeftIcon, ClockIcon } from 'lucide-react'
import { getDb } from '@/lib/db/client'
import { getMemberDetail, listHolidayCalendars } from '@/lib/db/queries/members'
import { guardPage } from '@/lib/auth/context'
import { can } from '@/lib/auth/permissions'
import { makeFormatter } from '@/lib/format'
import { presetRange, today } from '@/lib/domain/dates'
import { formatHours } from '@/lib/domain/money'
import { UTILIZATION_BAND_STYLE } from '@/lib/domain/utilization'
import { MEMBER_ROLE_LABELS, WEEKDAY_KEYS } from '@/lib/domain/types'
import { PageHeader } from '@/components/shared/page-header'
import { ForbiddenPanel } from '@/components/shared/forbidden'
import { Avatar } from '@/components/shared/avatar'
import { Stat, StatRow } from '@/components/shared/stat'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MemberDialog } from '@/components/members/member-dialog'
import { PortalLink } from '@/components/members/portal-link'
import { LeaveEditor } from '@/components/members/leave-editor'
import { ArchiveMemberButton } from '@/components/members/archive-button'

export const dynamic = 'force-dynamic'

const WEEKDAY_LABELS: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
}

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ memberId: string }>
}) {
  const { memberId } = await params
  const guard = await guardPage('view_members', `/members/${memberId}`)
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
  const range = presetRange('this_month', today, settings.weekStartDay)
  const [detail, calendars] = await Promise.all([
    getMemberDetail(db, memberId, range),
    listHolidayCalendars(db),
  ])
  if (!detail) notFound()

  const canManage = can(actingMember.role, 'manage_members')
  const canSecure = can(actingMember.role, 'manage_security')
  const band = UTILIZATION_BAND_STYLE[detail.utilization.band]
  const lockedDays = detail.days.filter((day) => day.minutes === 0 && day.reason !== 'non_working_day')

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href="/members">
          <ArrowLeftIcon />
          All members
        </Link>
      </Button>

      <PageHeader
        title={detail.member.name}
        description={`${MEMBER_ROLE_LABELS[detail.member.role]} · ${detail.member.email}`}
      >
        {can(actingMember.role, 'log_time_for_others') ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/timesheet?member=${detail.member.id}`}>
              <ClockIcon />
              Open timesheet
            </Link>
          </Button>
        ) : null}
        {canManage ? (
          <>
            <MemberDialog
              calendars={calendars}
              today={today}
              member={{
                id: detail.member.id,
                name: detail.member.name,
                email: detail.member.email,
                role: detail.member.role,
                workingMinutes: detail.member.workingMinutes,
                contractStart: detail.member.contractStart,
                contractEnd: detail.member.contractEnd,
                utilizationTargetPct: detail.member.utilizationTargetPct,
                holidayCalendarId: detail.member.holidayCalendarId,
                color: detail.member.color,
              }}
              trigger={<Button size="sm">Edit member</Button>}
            />
            <ArchiveMemberButton
              memberId={detail.member.id}
              memberName={detail.member.name}
              archived={Boolean(detail.member.archivedAt)}
            />
          </>
        ) : null}
      </PageHeader>

      <StatRow>
        <Stat
          label="Weekly capacity"
          value={`${formatHours(detail.weeklyCapacityMinutes, { zero: '0' })}h`}
          hint="Sum of their working-day pattern"
        />
        <Stat
          label={`Available in ${fmt.monthYear(range.from)}`}
          value={`${formatHours(detail.availableMinutes, { zero: '0' })}h`}
          hint="After holidays, leave and contract dates"
        />
        <Stat
          label="Logged this month"
          value={`${formatHours(detail.loggedMinutes, { zero: '0' })}h`}
          hint={`${formatHours(detail.billableMinutes, { zero: '0' })}h of it billable`}
        />
        <Stat
          label="Billable utilization"
          value={fmt.percent(detail.utilization.pct)}
          hint={
            detail.member.utilizationTargetPct === null
              ? 'No target set'
              : `Target ${detail.member.utilizationTargetPct}% · ${
                  detail.utilization.variancePct === null
                    ? '—'
                    : `${detail.utilization.variancePct > 0 ? '+' : ''}${detail.utilization.variancePct} pts`
                }`
          }
          tone={
            detail.utilization.band === 'on_target'
              ? 'ok'
              : detail.utilization.band === 'under'
                ? 'warn'
                : detail.utilization.band === 'over'
                  ? 'danger'
                  : 'default'
          }
        />
      </StatRow>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Working pattern and contract</CardTitle>
            <CardDescription>
              These four things — pattern, contract dates, holiday calendar and leave — are the only
              inputs to availability.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-7 gap-1.5">
              {WEEKDAY_KEYS.map((key) => {
                const minutes = detail.member.workingMinutes[key]
                return (
                  <div
                    key={key}
                    className="rounded-lg border px-1 py-2 text-center"
                    style={{ backgroundColor: minutes > 0 ? 'var(--card)' : 'var(--muted)' }}
                  >
                    <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {WEEKDAY_LABELS[key]}
                    </span>
                    <span className="block text-[13px] font-semibold tnum">
                      {minutes > 0 ? `${formatHours(minutes)}h` : '—'}
                    </span>
                  </div>
                )
              })}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-muted-foreground">Contract</dt>
              <dd className="tnum">
                {fmt.date(detail.member.contractStart)}
                {detail.member.contractEnd ? ` – ${fmt.date(detail.member.contractEnd)}` : ' – open'}
              </dd>
              <dt className="text-muted-foreground">Holiday calendar</dt>
              <dd>{detail.calendarName ?? 'None'}</dd>
              <dt className="text-muted-foreground">Utilization target</dt>
              <dd>
                {detail.member.utilizationTargetPct === null
                  ? 'Not set'
                  : `${detail.member.utilizationTargetPct}%`}
              </dd>
              <dt className="text-muted-foreground">Non-working days this month</dt>
              <dd>
                {lockedDays.length === 0 ? (
                  'None'
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {lockedDays.slice(0, 6).map((day) => (
                      <Badge key={day.date} variant="idle" title={day.label ?? undefined}>
                        {fmt.dayShort(day.date)}
                      </Badge>
                    ))}
                    {lockedDays.length > 6 ? (
                      <span className="text-xs text-muted-foreground">+{lockedDays.length - 6}</span>
                    ) : null}
                  </span>
                )}
              </dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Private timesheet link</CardTitle>
            <CardDescription>
              No account and no install. This link plus a PIN shows this person their own week and
              nothing else.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PortalLink
              memberId={detail.member.id}
              memberName={detail.member.name}
              /* The link is a credential: only the roles that manage members see it. */
              token={canManage ? detail.portal.token : null}
              revoked={detail.portal.revoked}
              hasPin={detail.portal.hasPin}
              canManage={canSecure}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Leave</CardTitle>
            <CardDescription>Vacation, sick, unpaid and other all reduce availability.</CardDescription>
          </CardHeader>
          <CardContent>
            <LeaveEditor
              memberId={detail.member.id}
              canManage={canManage}
              today={today}
              leave={detail.leave.map((row) => ({
                id: row.id,
                leaveType: row.leaveType,
                startDate: row.startDate,
                endDate: row.endDate,
                portion: row.portion,
                note: row.note,
                rangeLabel: fmt.range(row.startDate, row.endDate),
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assigned roles</CardTitle>
            <CardDescription>What this person may log time against and be booked on.</CardDescription>
          </CardHeader>
          <CardContent>
            {detail.assignments.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                Not assigned to any project role yet, so there is nothing for them to log against.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {detail.assignments.map((assignment) => (
                  <li key={assignment.projectRoleId} className="flex items-center gap-2.5 px-3 py-2">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: assignment.projectColor }}
                      aria-hidden
                    />
                    <Link
                      href={`/projects/${assignment.projectId}`}
                      className="min-w-0 flex-1 hover:underline"
                    >
                      <span className="block truncate text-[13px] font-medium">
                        {assignment.projectName}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {assignment.roleName}
                        {assignment.billable ? '' : ' · non-billable'}
                      </span>
                    </Link>
                    {assignment.billable ? (
                      <span className="text-xs text-muted-foreground tnum">
                        {fmt.money(assignment.rateCents)}/h
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
