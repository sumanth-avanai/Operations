import Link from 'next/link'
import { ChevronRightIcon } from 'lucide-react'
import { getDb } from '@/lib/db/client'
import { listMembers, listHolidayCalendars } from '@/lib/db/queries/members'
import { guardPage } from '@/lib/auth/context'
import { can } from '@/lib/auth/permissions'
import { makeFormatter } from '@/lib/format'
import { presetRange, today } from '@/lib/domain/dates'
import { formatHours } from '@/lib/domain/money'
import { UTILIZATION_BAND_STYLE } from '@/lib/domain/utilization'
import { MEMBER_ROLE_LABELS } from '@/lib/domain/types'
import { PageHeader } from '@/components/shared/page-header'
import { ForbiddenPanel } from '@/components/shared/forbidden'
import { Avatar } from '@/components/shared/avatar'
import { Meter } from '@/components/shared/meter'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ParamToggle } from '@/components/shared/param-controls'
import { MemberDialog } from '@/components/members/member-dialog'
import { EmptyState } from '@/components/shared/empty'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Members' }

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string; new?: string }>
}) {
  const guard = await guardPage('view_members', '/members')
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
  const canManage = can(actingMember.role, 'manage_members')

  const db = await getDb()
  const range = presetRange('this_month', today, settings.weekStartDay)
  const [rows, calendars] = await Promise.all([
    listMembers(db, { from: range.from, to: range.to, includeArchived }),
    listHolidayCalendars(db),
  ])

  return (
    <>
      <PageHeader
        title="Members"
        description={`Capacity, working days, contract dates and private links. Utilization shown for ${fmt.monthYear(range.from)}.`}
      >
        <ParamToggle param="archived" active={includeArchived} labelOn="Hide archived" labelOff="Show archived" />
        {canManage ? (
          <MemberDialog calendars={calendars} today={today} defaultOpen={params.new === '1'} />
        ) : null}
      </PageHeader>

      {rows.length === 0 ? (
        <EmptyState
          title="No members yet"
          description="Add the people who deliver work. Their working days and contract dates are what make capacity honest."
          action={canManage ? <MemberDialog calendars={calendars} today={today} /> : undefined}
        />
      ) : (
        <Card>
          <CardContent className="px-0 py-0">
            <ul className="divide-y">
              {rows.map((row) => {
                const band = UTILIZATION_BAND_STYLE[row.utilization.band]
                return (
                  <li key={row.member.id}>
                    <Link
                      href={`/members/${row.member.id}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 sm:px-5"
                    >
                      <Avatar name={row.member.name} color={row.member.color} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="truncate text-[13px] font-semibold">{row.member.name}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {MEMBER_ROLE_LABELS[row.member.role]}
                          </span>
                          {row.member.archivedAt ? <Badge variant="idle">Archived</Badge> : null}
                          {row.member.contractEnd ? (
                            <Badge variant="warn">Ends {fmt.date(row.member.contractEnd)}</Badge>
                          ) : null}
                          {row.portalState === 'revoked' ? (
                            <Badge variant="danger">Link revoked</Badge>
                          ) : row.portalState === 'no_pin' ? (
                            <Badge variant="warn">No PIN</Badge>
                          ) : null}
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                          <span className="tnum">
                            {formatHours(row.weeklyCapacityMinutes, { zero: '0' })}h per week
                          </span>
                          <span>{row.calendarName ?? 'No holiday calendar'}</span>
                          <span>{row.assignmentCount} role{row.assignmentCount === 1 ? '' : 's'}</span>
                        </div>
                      </div>

                      <div className="hidden w-44 shrink-0 sm:block">
                        <div className="flex items-baseline justify-between text-[11px] text-muted-foreground">
                          <span>Billable utilization</span>
                          <span className="font-semibold tnum" style={{ color: band.color }}>
                            {fmt.percent(row.utilization.pct)}
                          </span>
                        </div>
                        <Meter
                          className="mt-1"
                          value={row.billableMinutes}
                          max={row.availableMinutes || 1}
                          color={band.color}
                          marker={
                            row.member.utilizationTargetPct === null
                              ? null
                              : row.member.utilizationTargetPct / 100
                          }
                          label={`${row.member.name} utilization`}
                        />
                        <div className="mt-1 text-[10px] text-muted-foreground tnum">
                          {formatHours(row.billableMinutes, { zero: '0' })}h billable ·{' '}
                          {formatHours(row.availableMinutes, { zero: '0' })}h available
                          {row.member.utilizationTargetPct !== null
                            ? ` · target ${row.member.utilizationTargetPct}%`
                            : ''}
                        </div>
                      </div>

                      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  )
}
