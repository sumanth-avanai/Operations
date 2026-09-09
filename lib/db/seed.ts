/**
 * Seeds the demo agency — only ever on an empty database.
 *
 * Time entries are generated day by day through the SAME capacity function the
 * application uses, so the seeded history contains no hours on a holiday, a leave day,
 * a non-working day, or a date outside someone's contract. The demo data therefore
 * obeys the product's own integrity rules rather than working around them.
 */
import 'server-only'
import { eq, inArray, sql } from 'drizzle-orm'
import { addDays, addMonths, eachDay, endOfMonth, startOfMonth, startOfWeek, today } from '@/lib/domain/dates'
import { dayAvailability, type LeaveSpan } from '@/lib/domain/capacity'
import { amountCents } from '@/lib/domain/money'
import type { ISODate } from '@/lib/domain/types'
import { generatePortalToken, hashSecret } from '@/lib/auth/secrets'
import type { Db } from './client'
import { englandHolidays, germanBerlinHolidays } from './seed-holidays'
import {
  BOOKING_SPECS, CLIENT_SPECS, ENTRY_NOTES, HEALTH_SCRIPT, LEAVE_SPECS, MEMBER_SPECS, PROJECT_SPECS,
} from './seed-data'
import {
  bookings, clients, holidayCalendars, holidays, invoices, leaveRecords, members,
  notifications, projectHealthUpdates, projectRoles, projects, roleAssignments,
  savedViews, timeEntries, workspaceSettings,
} from './schema'

/** The demo PIN, stated in the README so the portal can be opened immediately. */
export const DEMO_PIN = '1234'

/** The demo workspace's own calendar. Changeable in Settings once it is running. */
export const DEMO_TIME_ZONE = 'Europe/Berlin'

/** Seeded PRNG so the demo workspace is identical on every machine. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export async function ensureSeed(db: Db): Promise<void> {
  const existing = await db.select({ id: members.id }).from(members).limit(1)
  if (existing.length > 0) return
  await seed(db)
}

async function seed(db: Db): Promise<void> {
  const rand = mulberry32(20260901)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T
  const between = (min: number, max: number) => min + rand() * (max - min)
  const quarterHour = (minutes: number) => Math.max(0, Math.round(minutes / 15) * 15)

  // The demo agency is European — EUR, dd/MM/yyyy — so its calendar is too. Anchoring
  // the dataset to the same zone the workspace will run in keeps "today" in the middle
  // of the seeded history no matter what zone the machine running the seed is in.
  const now = today(DEMO_TIME_ZONE)
  const historyStart = startOfMonth(addMonths(now, -3))

  /* ---------------------------------------------------------------- settings */
  const { hash, salt } = hashSecret(process.env.WORKSPACE_PASSWORD || 'agency')
  await db
    .insert(workspaceSettings)
    .values({
      id: 'default',
      agencyName: 'Meridian Studio',
      currency: 'EUR',
      timeZone: DEMO_TIME_ZONE,
      dateFormat: 'dd/MM/yyyy',
      weekStartDay: 1,
      defaultRateCents: 12_000,
      defaultBillingMethod: 'time_and_materials',
      defaultBillable: true,
      passwordHash: hash,
      passwordSalt: salt,
    })
    .onConflictDoNothing()

  /* ---------------------------------------------------------------- calendars */
  const calendarRows = await db
    .insert(holidayCalendars)
    .values([
      { name: 'Germany — Berlin', regionCode: 'DE-BE' },
      { name: 'United Kingdom — England', regionCode: 'GB-ENG' },
    ])
    .returning({ id: holidayCalendars.id, regionCode: holidayCalendars.regionCode })

  const calendarId = {
    berlin: calendarRows.find((c) => c.regionCode === 'DE-BE')!.id,
    england: calendarRows.find((c) => c.regionCode === 'GB-ENG')!.id,
  }

  const startYear = Number(historyStart.slice(0, 4))
  const years = [...new Set([startYear - 1, startYear, startYear + 1, Number(now.slice(0, 4)) + 1])]
  const holidayRows = years.flatMap((year) => [
    ...germanBerlinHolidays(year).map((h) => ({ ...h, calendarId: calendarId.berlin })),
    ...englandHolidays(year).map((h) => ({ ...h, calendarId: calendarId.england })),
  ])
  await db.insert(holidays).values(holidayRows).onConflictDoNothing()

  const holidayMaps = {
    berlin: new Map(holidayRows.filter((h) => h.calendarId === calendarId.berlin).map((h) => [h.holidayDate, h.name])),
    england: new Map(holidayRows.filter((h) => h.calendarId === calendarId.england).map((h) => [h.holidayDate, h.name])),
  }

  /* ---------------------------------------------------------------- members */
  const pin = hashSecret(DEMO_PIN)
  const memberRows = await db
    .insert(members)
    .values(
      MEMBER_SPECS.map((spec) => ({
        name: spec.name,
        email: spec.email,
        role: spec.role,
        workingMinutes: spec.workingMinutes,
        contractStart: spec.contractStartOffsetDays
          ? addDays(now, spec.contractStartOffsetDays)
          : addDays(historyStart, -420),
        contractEnd: spec.contractEndOffsetDays ? addDays(now, spec.contractEndOffsetDays) : null,
        utilizationTargetPct: spec.targetPct,
        holidayCalendarId: calendarId[spec.calendar],
        portalToken: generatePortalToken(),
        pinHash: pin.hash,
        pinSalt: pin.salt,
        color: spec.color,
      })),
    )
    .returning()

  const memberByName = new Map(memberRows.map((m) => [m.name, m]))
  const specByName = new Map(MEMBER_SPECS.map((s) => [s.name, s]))

  /* ---------------------------------------------------------------- leave */
  const leaveValues = LEAVE_SPECS.map((spec) => {
    const from = addDays(now, spec.fromOffset)
    return {
      memberId: memberByName.get(spec.member)!.id,
      leaveType: spec.leaveType,
      startDate: from,
      endDate: addDays(from, spec.days - 1),
      portion: spec.portion,
      note: spec.note || null,
    }
  })
  await db.insert(leaveRecords).values(leaveValues)

  const leaveByMember = new Map<string, LeaveSpan[]>()
  for (const leave of leaveValues) {
    const list = leaveByMember.get(leave.memberId) ?? []
    list.push({
      leaveType: leave.leaveType,
      startDate: leave.startDate,
      endDate: leave.endDate,
      portion: leave.portion,
    })
    leaveByMember.set(leave.memberId, list)
  }

  /* ---------------------------------------------------------------- clients, projects, roles */
  const clientRows = await db.insert(clients).values(CLIENT_SPECS).returning({ id: clients.id, name: clients.name })
  const clientByName = new Map(clientRows.map((c) => [c.name, c.id]))

  const projectRows = await db
    .insert(projects)
    .values(
      PROJECT_SPECS.map((spec) => ({
        clientId: clientByName.get(spec.client)!,
        name: spec.name,
        code: spec.code,
        color: spec.color,
        billable: spec.billable,
        billingMethod: spec.billingMethod,
        startDate: addDays(historyStart, -30),
        endDate: addDays(now, 120),
        ownerMemberId: memberByName.get(spec.owner)!.id,
      })),
    )
    .returning({ id: projects.id, name: projects.name, billable: projects.billable })

  const projectByName = new Map(projectRows.map((p) => [p.name, p]))
  const projectNameById = new Map(projectRows.map((p) => [p.id, p.name]))

  const roleRows = await db
    .insert(projectRoles)
    .values(
      PROJECT_SPECS.flatMap((spec) =>
        spec.roles.map((role, index) => ({
          projectId: projectByName.get(spec.name)!.id,
          name: role.name,
          rateCents: role.rateCents,
          budgetCents: role.budgetCents,
          budgetMinutes: role.rateCents > 0 ? Math.round((role.budgetCents / role.rateCents) * 60) : null,
          sortOrder: index,
        })),
      ),
    )
    .returning()

  const roleKey = (projectName: string, roleName: string) => `${projectName}|${roleName}`
  const roleByKey = new Map(roleRows.map((r) => [roleKey(projectNameById.get(r.projectId)!, r.name), r]))

  await db.insert(roleAssignments).values(
    PROJECT_SPECS.flatMap((spec) =>
      spec.roles.flatMap((role) =>
        role.members.map((memberName) => ({
          projectRoleId: roleByKey.get(roleKey(spec.name, role.name))!.id,
          memberId: memberByName.get(memberName)!.id,
        })),
      ),
    ),
  )

  type Assignable = { roleId: string; projectName: string; billable: boolean }
  const assignableByMember = new Map<string, Assignable[]>()
  for (const spec of PROJECT_SPECS) {
    for (const role of spec.roles) {
      const roleRow = roleByKey.get(roleKey(spec.name, role.name))!
      for (const memberName of role.members) {
        const memberId = memberByName.get(memberName)!.id
        const list = assignableByMember.get(memberId) ?? []
        list.push({ roleId: roleRow.id, projectName: spec.name, billable: spec.billable })
        assignableByMember.set(memberId, list)
      }
    }
  }

  /* ---------------------------------------------------------------- time entries */
  const entryValues: (typeof timeEntries.$inferInsert)[] = []

  for (const member of memberRows) {
    const spec = specByName.get(member.name)!
    const holidayMap = holidayMaps[spec.calendar]
    const leaves = leaveByMember.get(member.id) ?? []
    const assignable = assignableByMember.get(member.id) ?? []
    if (assignable.length === 0) continue
    const billableRoles = assignable.filter((a) => a.billable)
    const internalRoles = assignable.filter((a) => !a.billable)
    const target = (spec.targetPct ?? 60) / 100

    for (const date of eachDay(historyStart, now)) {
      const availability = dayAvailability(
        {
          workingMinutes: member.workingMinutes,
          contractStart: member.contractStart,
          contractEnd: member.contractEnd,
        },
        date,
        holidayMap,
        leaves,
      )
      if (availability.minutes <= 0) continue
      if (rand() > spec.diligence) continue // a week nobody filled in

      // A few days land over capacity, so the warning is visible in seeded data.
      const fill = rand() < 0.06 ? between(1.05, 1.3) : between(0.72, 1.0)
      const dayMinutes = quarterHour(availability.minutes * fill)
      if (dayMinutes <= 0) continue

      const billableShare = billableRoles.length === 0 ? 0 : Math.min(1, target + between(-0.12, 0.16))
      const billableMinutes = quarterHour(dayMinutes * billableShare)
      const internalMinutes = Math.max(0, dayMinutes - billableMinutes)

      // One row per role per day; fold anything that lands on the same role.
      const folded = new Map<string, number>()
      const add = (roleId: string, minutes: number) => {
        if (minutes > 0) folded.set(roleId, (folded.get(roleId) ?? 0) + minutes)
      }

      if (billableMinutes > 0 && billableRoles.length > 0) {
        const split = billableRoles.length > 1 && rand() < 0.45
        if (split) {
          const a = pick(billableRoles)
          let b = pick(billableRoles)
          if (b.roleId === a.roleId) b = billableRoles.find((r) => r.roleId !== a.roleId) ?? a
          const first = quarterHour(billableMinutes * between(0.35, 0.65))
          add(a.roleId, first)
          add(b.roleId, billableMinutes - first)
        } else {
          add(pick(billableRoles).roleId, billableMinutes)
        }
      }
      if (internalMinutes > 0 && internalRoles.length > 0) add(pick(internalRoles).roleId, internalMinutes)

      for (const [roleId, minutes] of folded) {
        entryValues.push({
          memberId: member.id,
          projectRoleId: roleId,
          entryDate: date,
          minutes: Math.min(minutes, 1440),
          note: rand() < 0.12 ? pick(ENTRY_NOTES) : null,
          source: spec.role === 'logger' && rand() < 0.75 ? 'portal' : 'internal',
        })
      }
    }
  }

  for (const batch of chunked(entryValues, 400)) {
    await db.insert(timeEntries).values(batch).onConflictDoNothing()
  }

  /* ---------------------------------------------------------------- bookings */
  const nextMonday = startOfWeek(addDays(now, 7), 1)
  const plannerId = memberByName.get('Priya Raghavan')!.id
  await db.insert(bookings).values(
    BOOKING_SPECS.map(([memberName, projectName, roleName, offset, days, hours, status, note]) => {
      const start = addDays(nextMonday, offset)
      return {
        memberId: memberByName.get(memberName)!.id,
        projectRoleId: roleByKey.get(roleKey(projectName, roleName))!.id,
        startDate: start,
        endDate: addDays(start, days - 1),
        minutesPerDay: hours * 60,
        status,
        note: note ?? null,
        createdByMemberId: plannerId,
      }
    }),
  )

  /* ---------------------------------------------------------------- invoices */
  const firstMonth = { from: historyStart, to: endOfMonth(historyStart) }
  const secondMonthStart = startOfMonth(addMonths(historyStart, 1))
  const secondMonth = { from: secondMonthStart, to: endOfMonth(secondMonthStart) }

  await invoiceProjects(db, ['Onboarding Redesign', 'Brand System', 'Loyalty Programme'], firstMonth, 'INV-2026-041', projectByName)
  await invoiceProjects(db, ['Onboarding Redesign', 'Data Platform'], secondMonth, 'INV-2026-052', projectByName)

  /* ---------------------------------------------------------------- health */
  const healthValues: (typeof projectHealthUpdates.$inferInsert)[] = []
  for (const [projectName, updates] of Object.entries(HEALTH_SCRIPT)) {
    const project = projectByName.get(projectName)
    if (!project) continue
    const owner = PROJECT_SPECS.find((p) => p.name === projectName)!.owner
    updates.forEach((update, index) => {
      healthValues.push({
        projectId: project.id,
        updateDate: addDays(historyStart, 20 + index * 32),
        status: update.status,
        risk: update.risk,
        satisfaction: update.satisfaction,
        comment: update.comment,
        authorMemberId: memberByName.get(owner)!.id,
      })
    })
  }
  await db.insert(projectHealthUpdates).values(healthValues)

  /* ---------------------------------------------------------------- notifications */
  await db.insert(notifications).values([
    {
      memberId: memberByName.get('Emeka Nwosu')!.id,
      kind: 'onboarded',
      title: 'Welcome to Meridian Studio',
      body: 'Your private timesheet link is ready. Logging a week takes a couple of minutes.',
      link: '/members',
    },
    {
      memberId: memberByName.get('Lena Vogt')!.id,
      kind: 'booked',
      title: 'Booked on Onboarding Redesign',
      body: '6h per day for twelve working days from next Monday.',
      link: '/planner',
    },
    {
      memberId: memberByName.get('Sam Hollis')!.id,
      kind: 'over_commitment',
      title: 'Booking exceeds the Developer budget',
      body: 'Mobile App Phase 2 has less budget remaining than this booking is worth.',
      link: '/planner',
    },
    {
      memberId: memberByName.get('Priya Raghavan')!.id,
      kind: 'slipped_work',
      title: 'Planned work has slipped',
      body: 'Ines Duarte on Onboarding Redesign: planned design work was not fully logged.',
      link: '/planner',
    },
  ])

  /* ---------------------------------------------------------------- saved views */
  await db.insert(savedViews).values([
    {
      name: 'Quarterly utilisation vs target',
      panel: 'reports',
      config: { preset: 'this_quarter', groupBy: 'member' },
      ownerMemberId: memberByName.get('Amara Okafor')!.id,
    },
    {
      name: 'Unbilled by project',
      panel: 'billing',
      config: { preset: 'last_month', groupBy: 'project' },
      ownerMemberId: memberByName.get('Ruben Castellanos')!.id,
    },
  ])
}

/* ------------------------------------------------------------------ helpers */

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Marks a period's billable work on the given projects as invoiced, freezing each
 * entry's amount at its role's rate — the same shape the real action uses.
 */
async function invoiceProjects(
  db: Db,
  projectNames: string[],
  period: { from: ISODate; to: ISODate },
  reference: string,
  projectByName: Map<string, { id: string; name: string; billable: boolean }>,
): Promise<void> {
  const targets = projectNames
    .map((name) => projectByName.get(name))
    .filter((p): p is { id: string; name: string; billable: boolean } => Boolean(p?.billable))
  if (targets.length === 0) return
  const projectIds = targets.map((p) => p.id)

  const rows = await db
    .select({
      id: timeEntries.id,
      minutes: timeEntries.minutes,
      rateCents: projectRoles.rateCents,
    })
    .from(timeEntries)
    .innerJoin(projectRoles, eq(projectRoles.id, timeEntries.projectRoleId))
    .where(
      sql`${projectRoles.projectId} in ${projectIds}
        and ${timeEntries.entryDate} between ${period.from} and ${period.to}
        and ${timeEntries.invoiceId} is null`,
    )
  if (rows.length === 0) return

  const priced = rows.map((row) => ({ id: row.id, amount: amountCents(row.minutes, row.rateCents) }))
  const total = priced.reduce((sum, p) => sum + p.amount, 0)

  const inserted = await db
    .insert(invoices)
    .values({
      reference,
      issuedDate: addDays(period.to, 3),
      periodStart: period.from,
      periodEnd: period.to,
      projectId: projectIds.length === 1 ? (projectIds[0] as string) : null,
      amountCents: total,
      note: `${projectNames.join(', ')} — ${period.from} to ${period.to}`,
    })
    .returning({ id: invoices.id })

  const invoiceId = inserted[0]?.id
  if (!invoiceId) return

  // Group by amount so this is a handful of statements rather than one per entry.
  const byAmount = new Map<number, string[]>()
  for (const p of priced) {
    const list = byAmount.get(p.amount) ?? []
    list.push(p.id)
    byAmount.set(p.amount, list)
  }
  for (const [amount, ids] of byAmount) {
    for (const batch of chunked(ids, 200)) {
      await db
        .update(timeEntries)
        .set({ invoiceId, invoicedAmountCents: amount })
        .where(inArray(timeEntries.id, batch))
    }
  }
}
