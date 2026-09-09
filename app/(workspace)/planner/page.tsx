import { getDb } from '@/lib/db/client'
import { allBookableAssignments, getPlannerData } from '@/lib/db/queries/planner'
import { listMemberOptions } from '@/lib/db/queries/projects'
import { loadRoleConsumption } from '@/lib/db/queries/consumption'
import { guardPage } from '@/lib/auth/context'
import { can, isProjectScoped } from '@/lib/auth/permissions'
import { makeFormatter } from '@/lib/format'
import { formatHours } from '@/lib/domain/money'
import { shiftTimeline, today, type TimelineScale } from '@/lib/domain/dates'
import { PageHeader } from '@/components/shared/page-header'
import { ForbiddenPanel } from '@/components/shared/forbidden'
import { Stat, StatRow } from '@/components/shared/stat'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ParamSelect, PeriodStepper } from '@/components/shared/param-controls'
import { Timeline } from '@/components/planner/timeline'
import { BookingDialog } from '@/components/planner/booking-dialog'
import { BookingList } from '@/components/planner/booking-list'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Resource Planner' }

const SCALES: TimelineScale[] = ['week', 'month', 'quarter', 'year']

export default async function PlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ scale?: string; from?: string }>
}) {
  const guard = await guardPage('view_planner', '/planner')
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
  const scale = (SCALES.includes(params.scale as TimelineScale) ? params.scale : 'month') as TimelineScale
  const ref = params.from ?? today
  const canManage = can(actingMember.role, 'manage_bookings')
  // A Project Manager sees availability for everyone but only their own projects' plans.
  const ownerScope = isProjectScoped(actingMember.role) ? actingMember.id : undefined

  const db = await getDb()
  const [data, memberOptions, assignments, consumption] = await Promise.all([
    getPlannerData(db, {
      scale,
      ref,
      weekStartDay: settings.weekStartDay,
      asOf: today,
      ...(ownerScope ? { ownerMemberId: ownerScope } : {}),
    }),
    listMemberOptions(db),
    allBookableAssignments(db, ownerScope),
    loadRoleConsumption(db, { asOf: today }),
  ])

  const weekdayLabels = Object.fromEntries(
    data.buckets.map((bucket) => [
      bucket.key,
      scale === 'week' || scale === 'month'
        ? fmt.weekday(bucket.from)
        : scale === 'year'
          ? fmt.monthYear(bucket.from).slice(0, 3)
          : '',
    ]),
  )

  const slippedIds = new Set(consumption.slipped.map((s) => s.bookingId))
  const bookableMembers = memberOptions.map((m) => ({ id: m.id, name: m.name }))

  const totals = data.rows.reduce(
    (acc, row) => ({
      available: acc.available + row.availableMinutes,
      confirmed: acc.confirmed + row.confirmedMinutes,
      tentative: acc.tentative + row.tentativeMinutes,
      logged: acc.logged + row.loggedMinutes,
    }),
    { available: 0, confirmed: 0, tentative: 0, logged: 0 },
  )
  const free = Math.max(0, totals.available - totals.confirmed - totals.tentative)

  return (
    <>
      <PageHeader
        title="Resource Planner"
        description="Who is booked, who is free, and whether a role still has budget before you confirm."
      >
        <ParamSelect
          param="scale"
          value={scale}
          label="Zoom"
          options={SCALES.map((option) => ({
            value: option,
            label: option.charAt(0).toUpperCase() + option.slice(1),
          }))}
        />
        <PeriodStepper
          param="from"
          ariaLabel="Timeline window"
          label={fmt.range(data.from, data.to)}
          previousValue={shiftTimeline(scale, ref, -1)}
          nextValue={shiftTimeline(scale, ref, 1)}
          todayValue={params.from ? today : undefined}
        />
        {canManage ? (
          <BookingDialog
            members={bookableMembers}
            assignments={assignments}
            defaultStart={data.from}
            defaultEnd={data.to}
          />
        ) : null}
      </PageHeader>

      <StatRow>
        <Stat
          label="Available"
          value={`${formatHours(totals.available, { zero: '0' })}h`}
          hint="After holidays, leave, part-time patterns and contract dates"
        />
        <Stat
          label="Confirmed"
          value={`${formatHours(totals.confirmed, { zero: '0' })}h`}
          hint="Committed work in this window"
          tone="info"
        />
        <Stat
          label="Tentative"
          value={`${formatHours(totals.tentative, { zero: '0' })}h`}
          hint="Pencilled in, not consuming budget"
        />
        <Stat
          label="Free capacity"
          value={`${formatHours(free, { zero: '0' })}h`}
          hint={free === 0 ? 'Fully booked' : 'Room for more work'}
          tone={free === 0 ? 'warn' : 'ok'}
        />
      </StatRow>

      {data.scopedToOwner ? (
        <p className="rounded-lg bg-info-soft px-3 py-2 text-[13px] text-foreground/90">
          Availability shows the whole team, but the bookings below and the density in the
          timeline cover only the engagements you manage.
        </p>
      ) : null}

      <Timeline data={data} weekdayLabels={weekdayLabels} />

      <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded" style={{ backgroundColor: 'var(--ok-soft)' }} /> well booked
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded" style={{ backgroundColor: 'var(--warn-soft)' }} /> at capacity
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded" style={{ backgroundColor: 'var(--danger-soft)' }} /> over capacity
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="size-3 rounded"
            style={{
              backgroundImage:
                'repeating-linear-gradient(135deg, var(--info-soft) 0 3px, transparent 3px 6px)',
            }}
          />{' '}
          tentative
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="size-3 rounded"
            style={{
              backgroundImage:
                'repeating-linear-gradient(135deg, transparent 0 3px, var(--border) 3px 5px)',
            }}
          />{' '}
          holiday, leave or non-working
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bookings in this window</CardTitle>
          <CardDescription>
            Confirmed work consumes role budget; tentative work does not. Anything planned in the
            past and not fully logged is flagged.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BookingList
            canManage={canManage}
            members={bookableMembers}
            assignments={assignments}
            bookings={data.bookings.map((booking) => ({
              id: booking.id,
              memberId: booking.memberId,
              memberName: booking.memberName,
              memberColor:
                data.rows.find((row) => row.memberId === booking.memberId)?.color ?? 'var(--hue-1)',
              projectRoleId: booking.projectRoleId,
              projectName: booking.projectName,
              roleName: booking.roleName,
              projectColor: booking.projectColor,
              clientName: booking.clientName,
              startDate: booking.startDate,
              endDate: booking.endDate,
              minutesPerDay: booking.minutesPerDay,
              status: booking.status,
              note: booking.note,
              rangeLabel: fmt.range(booking.startDate, booking.endDate),
              effectiveLabel: `${formatHours(booking.effectiveMinutes, { zero: '0' })}h in this window`,
              slipped: slippedIds.has(booking.id),
            }))}
          />
        </CardContent>
      </Card>
    </>
  )
}
