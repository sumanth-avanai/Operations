import Link from 'next/link'
import { ArrowRightIcon, BriefcaseBusinessIcon, UserPlusIcon, UsersIcon } from 'lucide-react'
import { getDb } from '@/lib/db/client'
import { getHomeSnapshot } from '@/lib/db/queries/home'
import { requireActing } from '@/lib/auth/context'
import { can, isProjectScoped } from '@/lib/auth/permissions'
import { makeFormatter } from '@/lib/format'
import { addDays, startOfWeek, today } from '@/lib/domain/dates'
import { formatHours, percentOf } from '@/lib/domain/money'
import { UTILIZATION_BAND_STYLE } from '@/lib/domain/utilization'
import { PageHeader } from '@/components/shared/page-header'
import { Stat, StatRow } from '@/components/shared/stat'
import { Meter } from '@/components/shared/meter'
import { Avatar } from '@/components/shared/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { WarningList } from '@/components/shared/warnings'
import { PeriodStepper } from '@/components/shared/param-controls'
import { MEMBER_ROLE_LABELS, type MemberRoleName } from '@/lib/domain/types'

export const dynamic = 'force-dynamic'

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>
}) {
  const { settings, actingMember, today } = await requireActing('/')
  const fmt = makeFormatter(settings)
  const { week } = await searchParams
  const db = await getDb()
  // A Project Manager's money figure and warnings are limited to their own engagements.
  const snapshot = await getHomeSnapshot(db, week ?? today, {
    weekStartDay: settings.weekStartDay,
    asOf: today,
    ...(isProjectScoped(actingMember.role) ? { ownerMemberId: actingMember.id } : {}),
  })

  const billablePct = percentOf(snapshot.billableMinutes, snapshot.availableMinutes)
  const loggedPct = percentOf(snapshot.totalMinutes, snapshot.availableMinutes)
  const weekStartOfToday = startOfWeek(today, settings.weekStartDay)
  const showMoney = can(actingMember.role, 'view_billing')

  return (
    <>
      <PageHeader
        title={`Good to see you, ${actingMember.name.split(' ')[0]}`}
        description={`Week of ${fmt.range(snapshot.weekStart, snapshot.weekEnd)} · ${snapshot.counts.members} people, ${snapshot.counts.projects} live projects across ${snapshot.counts.clients} clients.`}
      >
        <PeriodStepper
          param="week"
          ariaLabel="Week"
          label={fmt.range(snapshot.weekStart, snapshot.weekEnd)}
          previousValue={addDays(snapshot.weekStart, -7)}
          nextValue={addDays(snapshot.weekStart, 7)}
          todayValue={snapshot.weekStart === weekStartOfToday ? undefined : weekStartOfToday}
        />
      </PageHeader>

      <StatRow>
        <Stat
          label="Hours logged"
          value={`${formatHours(snapshot.totalMinutes, { zero: '0' })}h`}
          hint={`of ${formatHours(snapshot.availableMinutes, { zero: '0' })}h available · ${fmt.percent(loggedPct)}`}
        />
        <Stat
          label="Billable hours"
          value={`${formatHours(snapshot.billableMinutes, { zero: '0' })}h`}
          hint={`${fmt.percent(billablePct)} billable utilization this week`}
          tone={billablePct !== null && billablePct >= 60 ? 'ok' : 'warn'}
        />
        <Stat
          label="Timesheets in"
          value={`${snapshot.completeCount}/${snapshot.members.length}`}
          hint="People who have filled in most of their week"
          tone={snapshot.completeCount === snapshot.members.length ? 'ok' : 'warn'}
        />
        {showMoney ? (
          <Stat
            label={snapshot.scopedToOwner ? 'Unbilled on your projects' : 'Unbilled work'}
            value={fmt.moneyShort(snapshot.unbilledCents)}
            hint={`${formatHours(snapshot.unbilledMinutes, { zero: '0' })}h delivered and not yet invoiced`}
            tone={snapshot.unbilledCents > 0 ? 'info' : 'default'}
          />
        ) : (
          <Stat
            label="Capacity left"
            value={`${formatHours(Math.max(0, snapshot.availableMinutes - snapshot.totalMinutes), { zero: '0' })}h`}
            hint="Unlogged availability across the team this week"
          />
        )}
      </StatRow>

      {snapshot.guardrails.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Worth a look</CardTitle>
          </CardHeader>
          <CardContent>
            <WarningList warnings={snapshot.guardrails.slice(0, 6)} />
            {snapshot.guardrails.length > 6 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                and {snapshot.guardrails.length - 6} more.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>How the team is tracking</CardTitle>
          {can(actingMember.role, 'log_time_for_others') ? (
            <Button asChild variant="ghost" size="xs">
              <Link href="/timesheet">
                Open a timesheet
                <ArrowRightIcon />
              </Link>
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="px-0 pb-2">
          <ul className="divide-y">
            {snapshot.members.map((member) => {
              const band = UTILIZATION_BAND_STYLE[member.utilization.band]
              return (
                <li key={member.memberId} className="flex items-center gap-3 px-5 py-2.5">
                  <Avatar name={member.name} color={member.color} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">
                        {member.name}
                        <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                          {MEMBER_ROLE_LABELS[member.role as MemberRoleName]}
                        </span>
                      </span>
                      <span className="shrink-0 text-[13px] tnum">
                        <span className="font-semibold">
                          {formatHours(member.loggedMinutes, { zero: '0' })}h
                        </span>
                        <span className="text-muted-foreground">
                          {' / '}
                          {formatHours(member.availableMinutes, { zero: '0' })}h
                        </span>
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Meter
                        value={member.loggedMinutes}
                        max={member.availableMinutes || 1}
                        color={band.color}
                        marker={
                          member.utilization.targetPct === null
                            ? null
                            : member.utilization.targetPct / 100
                        }
                        label={`${member.name} logged against available`}
                      />
                      <span className="w-12 shrink-0 text-right text-[11px] tnum text-muted-foreground">
                        {fmt.percent(member.utilization.pct)}
                      </span>
                    </div>
                  </div>
                  {member.availableMinutes === 0 ? (
                    <Badge variant="idle">No capacity</Badge>
                  ) : member.complete ? (
                    <Badge variant="ok">In</Badge>
                  ) : (
                    <Badge variant="warn">Missing</Badge>
                  )}
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>

      {can(actingMember.role, 'manage_projects') || can(actingMember.role, 'manage_members') ? (
        <div className="flex flex-wrap gap-2">
          {can(actingMember.role, 'manage_projects') ? (
            <>
              <Button asChild variant="outline" size="sm">
                <Link href="/projects?new=client">
                  <UsersIcon />
                  Add a client
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/projects?new=project">
                  <BriefcaseBusinessIcon />
                  Add a project
                </Link>
              </Button>
            </>
          ) : null}
          {can(actingMember.role, 'manage_members') ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/members?new=1">
                <UserPlusIcon />
                Add a team member
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
