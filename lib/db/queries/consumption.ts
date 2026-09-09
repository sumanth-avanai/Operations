import 'server-only'
import { and, eq, gte, inArray, lte, notInArray, sql } from 'drizzle-orm'
import { eachDay, maxDate, minDate } from '@/lib/domain/dates'
import { workingMinutesOn } from '@/lib/domain/capacity'
import { roleBudget, type RoleBudget } from '@/lib/domain/budget'
import { splitPlan, EMPTY_SPLIT, type PlanCell } from '@/lib/domain/plan'
import type { ISODate } from '@/lib/domain/types'
import type { Db } from '../client'
import { bookings, projectRoles, timeEntries } from '../schema'
import { loadCapacityContexts } from './capacity-context'

/**
 * Budget consumption per project role.
 *
 * This query's only real job is to lay every booking onto its member+role+day cells,
 * capped by real availability, and hand them to `splitPlan` — which owns the rules that
 * stop planned and delivered from double counting (see `lib/domain/plan.ts`).
 *
 * Laying the cells out BEFORE subtracting is what makes two bookings on the same day one
 * commitment of their sum, and keying them by member is what stops one person's overtime
 * from cancelling another person's plan. Availability is applied first, so a booking
 * drawn across a holiday never invents committed spend.
 *
 * `committedMinutes` is the shortfall from `asOf` onward and is spend. `staleMinutes` is
 * the shortfall on days already gone: flagged so it can be re-planned or written off,
 * and never charged to remaining budget again.
 */
export type RoleConsumption = {
  roleId: string
  projectId: string
  rateCents: number
  budgetCents: number
  invoicedCents: number
  invoicedMinutes: number
  unbilledMinutes: number
  loggedMinutes: number
  /** Confirmed shortfall on days from `asOf` onward. Consumes budget. */
  committedMinutes: number
  tentativeMinutes: number
  /** Confirmed shortfall on days before `asOf`. Reported for re-planning, never spent. */
  staleMinutes: number
  budget: RoleBudget
}

export type SlippedBooking = {
  bookingId: string
  memberId: string
  projectRoleId: string
  endDate: ISODate
  bookedMinutes: number
  loggedMinutes: number
}

export type ConsumptionResult = {
  byRole: Map<string, RoleConsumption>
  slipped: SlippedBooking[]
}

export async function loadRoleConsumption(
  db: Db,
  /**
   * `asOf` is required rather than defaulted, so the compiler — not diligence — is what
   * guarantees that slipped-work detection is asked against the workspace's day and can
   * be pinned in a test.
   */
  opts: {
    asOf: ISODate
    projectIds?: string[]
    roleIds?: string[]
    /**
     * Bookings to leave out of the plan entirely — the booking currently being edited,
     * so a probe for its replacement is not added on top of its own committed minutes.
     */
    excludeBookingIds?: string[]
  },
): Promise<ConsumptionResult> {
  const roleFilter = and(
    opts.projectIds && opts.projectIds.length > 0 ? inArray(projectRoles.projectId, opts.projectIds) : undefined,
    opts.roleIds && opts.roleIds.length > 0 ? inArray(projectRoles.id, opts.roleIds) : undefined,
  )

  const roles = await db
    .select({
      id: projectRoles.id,
      projectId: projectRoles.projectId,
      rateCents: projectRoles.rateCents,
      budgetCents: projectRoles.budgetCents,
    })
    .from(projectRoles)
    .where(roleFilter)

  const byRole = new Map<string, RoleConsumption>()
  if (roles.length === 0) return { byRole, slipped: [] }

  const roleIds = roles.map((r) => r.id)

  /* 1. delivered work, split into frozen (invoiced) and re-priceable (unbilled) */
  const deliveredRes = await db.execute<{
    project_role_id: string
    invoiced_cents: number
    invoiced_minutes: number
    unbilled_minutes: number
  }>(sql`
    select project_role_id,
           coalesce(sum(coalesce(invoiced_amount_cents, 0)), 0)::bigint as invoiced_cents,
           coalesce(sum(case when invoice_id is not null then minutes else 0 end), 0)::bigint as invoiced_minutes,
           coalesce(sum(case when invoice_id is null then minutes else 0 end), 0)::bigint as unbilled_minutes
    from time_entries
    where project_role_id in ${roleIds}
    group by project_role_id
  `)
  const delivered = new Map(
    (deliveredRes.rows as unknown as {
      project_role_id: string
      invoiced_cents: number
      invoiced_minutes: number
      unbilled_minutes: number
    }[]).map((r) => [r.project_role_id, r]),
  )

  /* 2. bookings on these roles */
  const bookingRows = await db
    .select({
      id: bookings.id,
      memberId: bookings.memberId,
      projectRoleId: bookings.projectRoleId,
      startDate: bookings.startDate,
      endDate: bookings.endDate,
      minutesPerDay: bookings.minutesPerDay,
      status: bookings.status,
    })
    .from(bookings)
    .where(
      and(
        inArray(bookings.projectRoleId, roleIds),
        opts.excludeBookingIds && opts.excludeBookingIds.length > 0
          ? notInArray(bookings.id, opts.excludeBookingIds)
          : undefined,
      ),
    )

  /** One entry per member+role+day, so delivery is subtracted from each day once. */
  const planCells = new Map<string, PlanCell>()
  const slipped: SlippedBooking[] = []

  if (bookingRows.length > 0) {
    const from = bookingRows.reduce<ISODate>((acc, b) => minDate(acc, b.startDate), bookingRows[0]!.startDate)
    const to = bookingRows.reduce<ISODate>((acc, b) => maxDate(acc, b.endDate), bookingRows[0]!.endDate)
    const memberIds = [...new Set(bookingRows.map((b) => b.memberId))]

    const capacities = await loadCapacityContexts(db, { from, to, memberIds, includeArchived: true })

    /* 3. which member+role+day combinations already have logged time */
    const entryRows = await db
      .select({
        memberId: timeEntries.memberId,
        projectRoleId: timeEntries.projectRoleId,
        entryDate: timeEntries.entryDate,
        minutes: timeEntries.minutes,
      })
      .from(timeEntries)
      .where(
        and(
          inArray(timeEntries.projectRoleId, roleIds),
          gte(timeEntries.entryDate, from),
          lte(timeEntries.entryDate, to),
        ),
      )

    const loggedByCell = new Map<string, number>()
    const cellKey = (memberId: string, roleId: string, date: ISODate) => `${memberId}|${roleId}|${date}`
    for (const entry of entryRows) {
      loggedByCell.set(
        cellKey(entry.memberId, entry.projectRoleId, entry.entryDate),
        entry.minutes,
      )
    }

    const now = opts.asOf

    /* 4. lay every booking onto its cells. Nothing is subtracted in this pass: a day
          touched by two bookings has to be summed before delivery is netted off it. */
    for (const booking of bookingRows) {
      const capacity = capacities.get(booking.memberId)
      if (!capacity) continue
      const member = {
        workingMinutes: capacity.member.workingMinutes,
        contractStart: capacity.member.contractStart,
        contractEnd: capacity.member.contractEnd,
      }
      const confirmed = booking.status === 'confirmed'

      let effective = 0
      let loggedInRange = 0

      for (const day of eachDay(booking.startDate, booking.endDate)) {
        const available = workingMinutesOn(member, day, capacity.holidays, capacity.leaves)
        if (available <= 0) continue
        const dayMinutes = Math.min(booking.minutesPerDay, available)
        effective += dayMinutes

        const key = cellKey(booking.memberId, booking.projectRoleId, day)
        const logged = loggedByCell.get(key) ?? 0
        loggedInRange += logged

        const cell = planCells.get(key)
        if (cell) {
          if (confirmed) cell.confirmedMinutes += dayMinutes
          else cell.tentativeMinutes += dayMinutes
        } else {
          planCells.set(key, {
            key: booking.projectRoleId,
            date: day,
            confirmedMinutes: confirmed ? dayMinutes : 0,
            tentativeMinutes: confirmed ? 0 : dayMinutes,
            loggedMinutes: logged,
          })
        }
      }

      if (confirmed && booking.endDate < now && loggedInRange < effective) {
        slipped.push({
          bookingId: booking.id,
          memberId: booking.memberId,
          projectRoleId: booking.projectRoleId,
          endDate: booking.endDate,
          bookedMinutes: effective,
          loggedMinutes: loggedInRange,
        })
      }
    }
  }

  /* 5. one subtraction per cell, then the split at `asOf`. */
  const split = splitPlan(planCells.values(), opts.asOf)

  for (const role of roles) {
    const d = delivered.get(role.id)
    const invoicedCents = Number(d?.invoiced_cents ?? 0)
    const invoicedMins = Number(d?.invoiced_minutes ?? 0)
    const unbilledMins = Number(d?.unbilled_minutes ?? 0)
    const owed = split.get(role.id) ?? EMPTY_SPLIT
    const committed = owed.committedMinutes
    const tentative = owed.tentativeMinutes
    const stale = owed.staleMinutes

    byRole.set(role.id, {
      roleId: role.id,
      projectId: role.projectId,
      rateCents: role.rateCents,
      budgetCents: role.budgetCents,
      invoicedCents,
      invoicedMinutes: invoicedMins,
      unbilledMinutes: unbilledMins,
      loggedMinutes: invoicedMins + unbilledMins,
      committedMinutes: committed,
      tentativeMinutes: tentative,
      staleMinutes: stale,
      budget: roleBudget({
        budgetCents: role.budgetCents,
        rateCents: role.rateCents,
        invoicedCents,
        unbilledMinutes: unbilledMins,
        committedMinutes: committed,
        tentativeMinutes: tentative,
        staleMinutes: stale,
      }),
    })
  }

  return { byRole, slipped }
}

/** Remaining budget for one role — the planner's on-the-spot answer (SC-004). */
export async function roleRemainingBudget(db: Db, roleId: string, asOf: ISODate) {
  const { byRole } = await loadRoleConsumption(db, { asOf, roleIds: [roleId] })
  return byRole.get(roleId) ?? null
}
