/**
 * The personal portal: one private link, one PIN, one person's own week.
 *
 * This route never renders another member's data and its session cannot resolve to
 * one. An unknown, revoked, or archived-member token renders the same neutral page as
 * a wrong PIN, so the link cannot be used to discover who works here.
 */
import { getDb } from '@/lib/db/client'
import { getPortalState } from '@/lib/auth/context'
import { getTimesheetWeek } from '@/lib/db/queries/timesheet'
import { makeFormatter } from '@/lib/format'
import { addDays, startOfWeek, today } from '@/lib/domain/dates'
import { formatHours } from '@/lib/domain/money'
import { WeekGrid, type GridDay } from '@/components/grid/week-grid'
import { PinForm } from '@/components/access/pin-form'
import { PortalHeader } from '@/components/access/portal-header'
import { PeriodStepper } from '@/components/shared/param-controls'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'My timesheet', robots: { index: false, follow: false } }

export default async function PortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ week?: string }>
}) {
  const { token } = await params
  const { week: weekParam } = await searchParams
  const state = await getPortalState(token)

  if (state.state === 'inactive') {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-muted/40 p-6">
        <div className="w-full max-w-sm rounded-xl border bg-card px-6 py-8 text-center shadow-xs">
          <p className="text-sm font-semibold">This link is not active</p>
          <p className="mt-2 text-[13px] text-muted-foreground">
            It may have been replaced or turned off. Ask your operations lead for a new one.
          </p>
        </div>
      </main>
    )
  }

  if (state.state === 'locked') {
    const lockedUntil =
      state.lockedUntil && new Date(state.lockedUntil) > new Date() ? state.lockedUntil : null
    return (
      <main className="flex min-h-dvh items-center justify-center bg-muted/40 p-6">
        <div className="w-full max-w-sm">
          <PinForm token={token} lockedUntil={lockedUntil} hasPin={state.hasPin} />
        </div>
      </main>
    )
  }

  const { member, settings, today } = state.ctx
  const fmt = makeFormatter(settings)
  const db = await getDb()
  const week = await getTimesheetWeek(db, member.id, weekParam ?? today, {
    weekStartDay: settings.weekStartDay,
    asOf: today,
  })

  if (!week) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <p className="text-[13px] text-muted-foreground">Your week could not be loaded.</p>
      </main>
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
    <main className="min-h-dvh bg-muted/30">
      <PortalHeader
        agencyName={settings.agencyName}
        memberName={member.name}
        memberColor={member.color}
        token={token}
      />
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">My week</h1>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Fill in the hours you spent, add a note if it helps, and save. The grey column shows
              what was planned for you.
            </p>
          </div>
          <PeriodStepper
            param="week"
            ariaLabel="Week"
            label={fmt.range(week.weekStart, week.weekEnd)}
            previousValue={addDays(week.weekStart, -7)}
            nextValue={addDays(week.weekStart, 7)}
            todayValue={week.weekStart === weekStartOfToday ? undefined : weekStartOfToday}
          />
        </div>

        <WeekGrid
          memberId={member.id}
          memberName={member.name}
          weekStart={week.weekStart}
          days={days}
          rows={week.rows}
          baseUpdatedAt={week.baseUpdatedAt}
          portalToken={token}
          availableLabel={`${formatHours(week.availableMinutes, { zero: '0' })}h available this week`}
        />
      </div>
    </main>
  )
}
