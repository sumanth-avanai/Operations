import { getDb } from '@/lib/db/client'
import { getTimesheetWeek, timesheetMemberOptions } from '@/lib/db/queries/timesheet'
import { guardPage } from '@/lib/auth/context'
import { makeFormatter } from '@/lib/format'
import { addDays, startOfWeek, today } from '@/lib/domain/dates'
import { formatHours } from '@/lib/domain/money'
import { PageHeader } from '@/components/shared/page-header'
import { ForbiddenPanel } from '@/components/shared/forbidden'
import { ParamSelect, PeriodStepper } from '@/components/shared/param-controls'
import { WeekGrid, type GridDay } from '@/components/grid/week-grid'
import { EmptyState } from '@/components/shared/empty'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Timesheet' }

export default async function TimesheetPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string; week?: string }>
}) {
  const guard = await guardPage('log_time_for_others', '/timesheet')
  if (!guard.allowed) {
    return (
      <ForbiddenPanel
        capability={guard.capability}
        memberName={guard.ctx.actingMember.name}
        role={guard.ctx.actingMember.role}
      />
    )
  }

  const { settings, today } = guard.ctx
  const fmt = makeFormatter(settings)
  const params = await searchParams
  const db = await getDb()
  const options = await timesheetMemberOptions(db)

  const memberId = params.member && options.some((o) => o.id === params.member)
    ? params.member
    : (options[0]?.id ?? null)

  if (!memberId) {
    return (
      <>
        <PageHeader title="Timesheet" description="Fill in or correct anyone's week." />
        <EmptyState
          title="No members yet"
          description="Add someone on the Members panel and their week will be editable here."
        />
      </>
    )
  }

  const weekParam = params.week ?? today
  const week = await getTimesheetWeek(db, memberId, weekParam, {
    weekStartDay: settings.weekStartDay,
    asOf: today,
  })
  if (!week) {
    return (
      <>
        <PageHeader title="Timesheet" />
        <EmptyState title="That member could not be loaded" />
      </>
    )
  }

  const days: GridDay[] = week.days.map((day) => ({
    date: day.date,
    availableMinutes: day.minutes,
    reason: day.reason,
    label: day.label,
    isToday: day.isToday,
    weekdayLabel: fmt.weekday(day.date),
    dayLabel: fmt.dayShort(day.date),
  }))

  const weekStartOfToday = startOfWeek(today, settings.weekStartDay)

  return (
    <>
      <PageHeader
        title="Timesheet"
        description="The same grid the team uses on their private links, with the same guardrails."
      >
        <ParamSelect
          param="member"
          value={memberId}
          label="Member"
          options={options.map((o) => ({ value: o.id, label: o.name }))}
        />
        <PeriodStepper
          param="week"
          ariaLabel="Week"
          label={fmt.range(week.weekStart, week.weekEnd)}
          previousValue={addDays(week.weekStart, -7)}
          nextValue={addDays(week.weekStart, 7)}
          todayValue={week.weekStart === weekStartOfToday ? undefined : weekStartOfToday}
        />
      </PageHeader>

      <WeekGrid
        memberId={week.member.id}
        memberName={week.member.name}
        weekStart={week.weekStart}
        days={days}
        rows={week.rows}
        baseUpdatedAt={week.baseUpdatedAt}
        availableLabel={`${week.member.name} · ${formatHours(week.availableMinutes, { zero: '0' })}h available this week`}
      />
    </>
  )
}
