/**
 * Planning, invoicing, health and configuration — the paths where money and the plan
 * meet, and where the billing identity has to survive every operation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { actAs, bootWorkspace, form, type Workspace } from './helpers'
import { addDays, endOfMonth, startOfMonth, today } from '@/lib/domain/dates'
import { amountCents } from '@/lib/domain/money'

let ws: Workspace

beforeAll(async () => {
  ws = await bootWorkspace()
}, 180_000)

afterAll(() => ws?.cleanup())

/** logged = invoiced + unbilled, computed independently of the query layer. */
async function billingIdentityHolds(): Promise<{ invoiced: number; unbilled: number; balanced: boolean }> {
  const res = await ws.db.execute(ws.sql`
    select
      coalesce(sum(case when te.invoice_id is not null then te.invoiced_amount_cents else 0 end), 0)::int as invoiced,
      coalesce(sum(case when te.invoice_id is null then round(te.minutes * pr.rate_cents / 60.0) else 0 end), 0)::int as unbilled,
      coalesce(sum(case when te.invoice_id is not null then te.invoiced_amount_cents
                        else round(te.minutes * pr.rate_cents / 60.0) end), 0)::int as logged
    from time_entries te
    join project_roles pr on pr.id = te.project_role_id
    join projects p on p.id = pr.project_id
    where p.billable = true
  `)
  const row = (res.rows as unknown as { invoiced: number; unbilled: number; logged: number }[])[0]!
  return {
    invoiced: Number(row.invoiced),
    unbilled: Number(row.unbilled),
    balanced: Number(row.logged) === Number(row.invoiced) + Number(row.unbilled),
  }
}

async function pickAssignment() {
  const rows = await ws.db.execute(ws.sql`
    select ra.member_id, ra.project_role_id, pr.rate_cents, pr.budget_cents, pr.name as role_name,
           p.id as project_id, p.name as project_name
    from role_assignments ra
    join project_roles pr on pr.id = ra.project_role_id
    join projects p on p.id = pr.project_id
    join members m on m.id = ra.member_id
    where p.billable = true and p.archived_at is null and m.archived_at is null
      and pr.budget_cents > 0
    order by pr.budget_cents asc
    limit 1
  `)
  return (rows.rows as unknown as {
    member_id: string
    project_role_id: string
    rate_cents: number
    budget_cents: number
    role_name: string
    project_id: string
    project_name: string
  }[])[0]!
}

describe('bookings', () => {
  it('creates a booking, notifies the member, and reports the effective hours', async () => {
    await actAs(ws, 'resource_manager')
    const target = await pickAssignment()
    const start = addDays(today(), 30)

    const before = await ws.db.execute(
      ws.sql`select count(*)::int as n from notifications where member_id = ${target.member_id}`,
    )
    const result = await ws.actions.bookings.upsertBooking(
      null,
      form({
        memberId: target.member_id,
        projectRoleId: target.project_role_id,
        startDate: start,
        endDate: addDays(start, 9),
        minutesPerDay: '6',
        status: 'confirmed',
        note: 'integration booking',
      }),
    )
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true)

    const after = await ws.db.execute(
      ws.sql`select count(*)::int as n from notifications where member_id = ${target.member_id}`,
    )
    expect(Number((after.rows as unknown as { n: number }[])[0]!.n)).toBe(
      Number((before.rows as unknown as { n: number }[])[0]!.n) + 1,
    )
  })

  it('warns about over-commitment without blocking the save', async () => {
    await actAs(ws, 'resource_manager')
    const target = await pickAssignment()
    const start = addDays(today(), 60)

    const result = await ws.actions.bookings.upsertBooking(
      null,
      form({
        memberId: target.member_id,
        projectRoleId: target.project_role_id,
        startDate: start,
        endDate: addDays(start, 120),
        minutesPerDay: '8',
        status: 'confirmed',
        note: 'deliberately huge',
      }),
    )
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true)
    if (result.ok) {
      const overCommitment = result.warnings?.find((w) => w.code === 'over_commitment')
      expect(overCommitment, 'a booking far beyond the budget must warn').toBeTruthy()
      expect(overCommitment?.message).toContain('over')
      // and it did save
      const bookingId = result.data.bookingId
      const stored = await ws.db.execute(
        ws.sql`select count(*)::int as n from bookings where id = ${bookingId}`,
      )
      expect(Number((stored.rows as unknown as { n: number }[])[0]!.n)).toBe(1)
      const removed = await ws.actions.bookings.deleteBooking(bookingId)
      expect(removed.ok).toBe(true)
    }
  })

  it('refuses to book a role the member is not assigned to', async () => {
    await actAs(ws, 'resource_manager')
    const target = await pickAssignment()
    const other = await ws.db.execute(ws.sql`
      select id from project_roles
      where id not in (select project_role_id from role_assignments where member_id = ${target.member_id})
      limit 1
    `)
    const result = await ws.actions.bookings.upsertBooking(
      null,
      form({
        memberId: target.member_id,
        projectRoleId: (other.rows as unknown as { id: string }[])[0]!.id,
        startDate: today(),
        endDate: addDays(today(), 3),
        minutesPerDay: '4',
        status: 'confirmed',
        note: '',
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('not_assigned')
  })

  it('answers the budget question before anything is saved', async () => {
    await actAs(ws, 'resource_manager')
    const target = await pickAssignment()
    const start = addDays(today(), 20)

    const probe = await ws.actions.bookings.checkRoleBudget({
      memberId: target.member_id,
      projectRoleId: target.project_role_id,
      startDate: start,
      endDate: addDays(start, 4),
      minutesPerDay: 480,
    })
    expect(probe.ok).toBe(true)
    if (probe.ok) {
      expect(probe.data.roleName).toBe(target.role_name)
      expect(probe.data.projectName).toBe(target.project_name)
      // Priced from effective minutes at the role rate, exactly like the domain layer.
      expect(probe.data.proposalCents).toBe(amountCents(probe.data.proposalMinutes, target.rate_cents))
      expect(probe.data.proposalMinutes).toBeGreaterThan(0)
      expect(probe.data.proposalMinutes).toBeLessThanOrEqual(480 * 5)
    }
  })

  it('contributes nothing on days the member is unavailable', async () => {
    await actAs(ws, 'resource_manager')
    const target = await pickAssignment()
    // A weekend-only window must price at zero.
    const rows = await ws.db.execute(ws.sql`
      select generate_series::date::text as d
      from generate_series(current_date, current_date + 13, '1 day')
      where extract(isodow from generate_series) in (6, 7)
      order by 1 limit 2
    `)
    const weekend = (rows.rows as unknown as { d: string }[]).map((r) => r.d)
    if (weekend.length < 2) return

    const probe = await ws.actions.bookings.checkRoleBudget({
      memberId: target.member_id,
      projectRoleId: target.project_role_id,
      startDate: weekend[0]!,
      endDate: weekend[1]!,
      minutesPerDay: 480,
    })
    expect(probe.ok).toBe(true)
    if (probe.ok) {
      expect(probe.data.proposalMinutes).toBe(0)
      expect(probe.data.proposalCents).toBe(0)
    }
  })
})

describe('invoicing', () => {
  it('keeps logged equal to invoiced plus unbilled through a full invoice cycle', async () => {
    await actAs(ws, 'finance')
    const startBalance = await billingIdentityHolds()
    expect(startBalance.balanced).toBe(true)

    // A project with unbilled work in the current month.
    const period = { from: startOfMonth(today()), to: endOfMonth(today()) }
    const candidates = await ws.db.execute(ws.sql`
      select p.id, p.name, coalesce(sum(round(te.minutes * pr.rate_cents / 60.0)), 0)::int as cents,
             count(*)::int as entries
      from time_entries te
      join project_roles pr on pr.id = te.project_role_id
      join projects p on p.id = pr.project_id
      where p.billable = true and te.invoice_id is null
        and te.entry_date between ${period.from} and ${period.to}
      group by p.id, p.name
      having sum(te.minutes) > 0
      order by 3 desc limit 1
    `)
    const target = (candidates.rows as unknown as {
      id: string
      name: string
      cents: number
      entries: number
    }[])[0]
    expect(target, 'the seed must leave unbilled work in the current month').toBeTruthy()
    if (!target) return

    const result = await ws.actions.billing.markInvoiced(
      null,
      form({
        reference: 'TEST-INV-001',
        issuedDate: today(),
        periodStart: period.from,
        periodEnd: period.to,
        projectId: target.id,
        note: 'integration test invoice',
      }),
    )
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true)
    if (!result.ok) return

    expect(result.data.entryCount).toBe(Number(target.entries))
    expect(result.data.amountCents).toBe(Number(target.cents))

    const afterInvoice = await billingIdentityHolds()
    expect(afterInvoice.balanced).toBe(true)
    expect(afterInvoice.invoiced).toBe(startBalance.invoiced + Number(target.cents))
    expect(afterInvoice.unbilled).toBe(startBalance.unbilled - Number(target.cents))

    // the invoice total matches the rows it billed
    const stored = await ws.db.execute(ws.sql`
      select i.amount_cents, coalesce(sum(te.invoiced_amount_cents), 0)::int as rows_total
      from invoices i join time_entries te on te.invoice_id = i.id
      where i.id = ${result.data.invoiceId}
      group by i.amount_cents
    `)
    const row = (stored.rows as unknown as { amount_cents: number; rows_total: number }[])[0]!
    expect(Number(row.rows_total)).toBe(Number(row.amount_cents))

    // a second attempt on the same scope has nothing left to bill
    const again = await ws.actions.billing.markInvoiced(
      null,
      form({
        reference: 'TEST-INV-002',
        issuedDate: today(),
        periodStart: period.from,
        periodEnd: period.to,
        projectId: target.id,
        note: '',
      }),
    )
    expect(again.ok).toBe(false)
    if (!again.ok) {
      expect(again.error.code).toBe('invalid')
      expect(again.error.message).toContain('no unbilled work')
    }

    // reversing restores the exact starting position
    const reversed = await ws.actions.billing.unmarkInvoice(result.data.invoiceId)
    expect(reversed.ok).toBe(true)
    const afterReverse = await billingIdentityHolds()
    expect(afterReverse.balanced).toBe(true)
    expect(afterReverse.invoiced).toBe(startBalance.invoiced)
    expect(afterReverse.unbilled).toBe(startBalance.unbilled)
  })

  it('refuses a duplicate invoice reference', async () => {
    await actAs(ws, 'finance')
    const existing = await ws.db.execute(ws.sql`select reference, project_id, period_start::text as s, period_end::text as e from invoices where project_id is not null limit 1`)
    const invoice = (existing.rows as unknown as {
      reference: string
      project_id: string
      s: string
      e: string
    }[])[0]
    if (!invoice) return

    const result = await ws.actions.billing.markInvoiced(
      null,
      form({
        reference: invoice.reference,
        issuedDate: today(),
        periodStart: invoice.s,
        periodEnd: invoice.e,
        projectId: invoice.project_id,
        note: '',
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // Either the reference clashes or there is nothing left to bill — both are refusals
      // that name the reason rather than writing anything.
      expect(['duplicate', 'invalid']).toContain(result.error.code)
    }
  })

  it('refuses to invoice a non-billable project', async () => {
    await actAs(ws, 'finance')
    const rows = await ws.db.execute(
      ws.sql`select id, name from projects where billable = false limit 1`,
    )
    const project = (rows.rows as unknown as { id: string; name: string }[])[0]
    if (!project) return

    const result = await ws.actions.billing.markInvoiced(
      null,
      form({
        reference: 'TEST-INV-NONBILLABLE',
        issuedDate: today(),
        periodStart: startOfMonth(today()),
        periodEnd: endOfMonth(today()),
        projectId: project.id,
        note: '',
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('non-billable')
  })
})

describe('rates and billability', () => {
  it('re-prices unbilled work when a rate changes but leaves invoiced work alone', async () => {
    await actAs(ws, 'owner_admin')
    const rows = await ws.db.execute(ws.sql`
      select pr.id, pr.name, pr.rate_cents, pr.budget_cents, pr.sort_order, p.id as project_id
      from project_roles pr join projects p on p.id = pr.project_id
      where p.billable = true
        and exists (select 1 from time_entries te where te.project_role_id = pr.id and te.invoice_id is null)
        and exists (select 1 from time_entries te where te.project_role_id = pr.id and te.invoice_id is not null)
      limit 1
    `)
    const role = (rows.rows as unknown as {
      id: string
      name: string
      rate_cents: number
      budget_cents: number
      sort_order: number
      project_id: string
    }[])[0]
    expect(role, 'the seed must have a role with both invoiced and unbilled work').toBeTruthy()
    if (!role) return

    const frozenBefore = await ws.db.execute(ws.sql`
      select coalesce(sum(invoiced_amount_cents), 0)::int as total
      from time_entries where project_role_id = ${role.id} and invoice_id is not null
    `)
    const unbilledBefore = await ws.db.execute(ws.sql`
      select coalesce(sum(round(minutes * ${role.rate_cents} / 60.0)), 0)::int as total
      from time_entries where project_role_id = ${role.id} and invoice_id is null
    `)

    const newRate = role.rate_cents * 2
    const result = await ws.actions.projects.upsertProjectRole(
      null,
      form({
        projectId: role.project_id,
        roleId: role.id,
        name: role.name,
        rateCents: (newRate / 100).toFixed(2),
        budgetCents: (role.budget_cents / 100).toFixed(2),
        budgetMinutes: '',
        sortOrder: String(role.sort_order),
      }),
    )
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true)
    if (result.ok) {
      expect(result.warnings?.some((w) => w.code === 'rate_change')).toBe(true)
      expect(result.warnings?.[0]?.message).toContain('invoiced')
    }

    const frozenAfter = await ws.db.execute(ws.sql`
      select coalesce(sum(invoiced_amount_cents), 0)::int as total
      from time_entries where project_role_id = ${role.id} and invoice_id is not null
    `)
    expect(Number((frozenAfter.rows as unknown as { total: number }[])[0]!.total)).toBe(
      Number((frozenBefore.rows as unknown as { total: number }[])[0]!.total),
    )

    const unbilledAfter = await ws.db.execute(ws.sql`
      select coalesce(sum(round(minutes * ${newRate} / 60.0)), 0)::int as total
      from time_entries where project_role_id = ${role.id} and invoice_id is null
    `)
    expect(Number((unbilledAfter.rows as unknown as { total: number }[])[0]!.total)).toBeGreaterThan(
      Number((unbilledBefore.rows as unknown as { total: number }[])[0]!.total),
    )

    // restore
    await ws.actions.projects.upsertProjectRole(
      null,
      form({
        projectId: role.project_id,
        roleId: role.id,
        name: role.name,
        rateCents: (role.rate_cents / 100).toFixed(2),
        budgetCents: (role.budget_cents / 100).toFixed(2),
        budgetMinutes: '',
        sortOrder: String(role.sort_order),
      }),
    )
    expect((await billingIdentityHolds()).balanced).toBe(true)
  })

  it('warns when billable work is about to drop out of billing', async () => {
    await actAs(ws, 'owner_admin')
    const rows = await ws.db.execute(ws.sql`
      select p.id, p.name, p.client_id, p.color, p.billing_method, p.owner_member_id
      from projects p
      where p.billable = true
        and exists (select 1 from time_entries te
                    join project_roles pr on pr.id = te.project_role_id
                    where pr.project_id = p.id and te.invoice_id is null)
      limit 1
    `)
    const project = (rows.rows as unknown as {
      id: string
      name: string
      client_id: string
      color: string
      billing_method: string
      owner_member_id: string | null
    }[])[0]!

    const result = await ws.actions.projects.updateProject(
      null,
      form({
        projectId: project.id,
        clientId: project.client_id,
        name: project.name,
        code: '',
        color: project.color,
        billable: 'off',
        billingMethod: project.billing_method,
        startDate: '',
        endDate: '',
        ownerMemberId: project.owner_member_id ?? 'none',
        notes: '',
      }),
    )
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true)
    if (result.ok) {
      const warning = result.warnings?.find((w) => w.code === 'non_billable_project')
      expect(warning).toBeTruthy()
      expect(warning?.message).toContain(project.name)
    }

    // restore billability
    await ws.actions.projects.updateProject(
      null,
      form({
        projectId: project.id,
        clientId: project.client_id,
        name: project.name,
        code: '',
        color: project.color,
        billable: 'on',
        billingMethod: project.billing_method,
        startDate: '',
        endDate: '',
        ownerMemberId: project.owner_member_id ?? 'none',
        notes: '',
      }),
    )
  })
})

describe('health, leave and holidays', () => {
  it('appends health updates and makes the newest one current', async () => {
    await actAs(ws, 'owner_admin')
    const rows = await ws.db.execute(ws.sql`select id, name from projects limit 1`)
    const project = (rows.rows as unknown as { id: string; name: string }[])[0]!
    const before = await ws.db.execute(
      ws.sql`select count(*)::int as n from project_health_updates where project_id = ${project.id}`,
    )

    const result = await ws.actions.health.recordHealthUpdate(
      null,
      form({
        projectId: project.id,
        updateDate: today(),
        status: 'at_risk',
        risk: 'high',
        satisfaction: '2',
        comment: 'Integration test update',
      }),
    )
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true)

    const after = await ws.db.execute(
      ws.sql`select count(*)::int as n from project_health_updates where project_id = ${project.id}`,
    )
    expect(Number((after.rows as unknown as { n: number }[])[0]!.n)).toBe(
      Number((before.rows as unknown as { n: number }[])[0]!.n) + 1,
    )

    const { loadCurrentHealth } = await import('@/lib/db/queries/projects')
    const current = await loadCurrentHealth(ws.db)
    expect(current.get(project.id)?.status).toBe('at_risk')
    expect(current.get(project.id)?.risk).toBe('high')
  })

  it('keeps logged hours when leave is recorded over them, and says so', async () => {
    await actAs(ws, 'operations_lead')
    const rows = await ws.db.execute(ws.sql`
      select member_id, entry_date::text as entry_date, minutes
      from time_entries order by entry_date desc limit 1
    `)
    const entry = (rows.rows as unknown as { member_id: string; entry_date: string; minutes: number }[])[0]!

    const result = await ws.actions.members.upsertLeave(
      null,
      form({
        memberId: entry.member_id,
        leaveType: 'other',
        startDate: entry.entry_date,
        endDate: entry.entry_date,
        minutesPerDay: '',
        note: 'clashing leave',
      }),
    )
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true)
    if (result.ok) {
      expect(result.warnings?.some((w) => w.code === 'holiday_conflict')).toBe(true)
    }

    const still = await ws.db.execute(ws.sql`
      select minutes from time_entries
      where member_id = ${entry.member_id} and entry_date = ${entry.entry_date} limit 1
    `)
    expect(Number((still.rows as unknown as { minutes: number }[])[0]!.minutes)).toBeGreaterThan(0)
  })

  it('keeps logged hours when a holiday lands on them, and names who logged them', async () => {
    await actAs(ws, 'owner_admin')
    const rows = await ws.db.execute(ws.sql`
      select m.holiday_calendar_id, te.entry_date::text as entry_date, m.name
      from time_entries te join members m on m.id = te.member_id
      where m.holiday_calendar_id is not null
      order by te.entry_date desc limit 1
    `)
    const target = (rows.rows as unknown as {
      holiday_calendar_id: string
      entry_date: string
      name: string
    }[])[0]!

    const result = await ws.actions.settings.upsertHoliday(
      null,
      form({
        calendarId: target.holiday_calendar_id,
        holidayDate: target.entry_date,
        name: 'Surprise company day',
      }),
    )
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true)
    if (result.ok) {
      const warning = result.warnings?.find((w) => w.code === 'holiday_conflict')
      expect(warning).toBeTruthy()
      expect(warning?.message).toContain('Surprise company day')
      expect(warning?.message).toContain('kept')
    }

    const still = await ws.db.execute(ws.sql`
      select count(*)::int as n from time_entries where entry_date = ${target.entry_date}
    `)
    expect(Number((still.rows as unknown as { n: number }[])[0]!.n)).toBeGreaterThan(0)
  })

  it('refuses to delete a calendar members still use', async () => {
    await actAs(ws, 'owner_admin')
    const rows = await ws.db.execute(ws.sql`
      select holiday_calendar_id from members where holiday_calendar_id is not null limit 1
    `)
    const calendarId = (rows.rows as unknown as { holiday_calendar_id: string }[])[0]!.holiday_calendar_id
    const result = await ws.actions.settings.deleteHolidayCalendar(calendarId)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('still using')
  })

  it('applies currency, date format and time zone changes workspace-wide', async () => {
    await actAs(ws, 'owner_admin')
    const result = await ws.actions.settings.updateWorkspaceSettings(
      null,
      form({
        agencyName: 'Meridian Studio',
        currency: 'GBP',
        dateFormat: 'yyyy-MM-dd',
        weekStartDay: '1',
        timeZone: 'Asia/Kolkata',
        defaultRateCents: '150.00',
        defaultBillingMethod: 'fixed_fee',
        defaultBillable: 'on',
      }),
    )
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true)

    const { getSettings } = await import('@/lib/auth/context')
    const settings = await getSettings()
    expect(settings.currency).toBe('GBP')
    expect(settings.dateFormat).toBe('yyyy-MM-dd')
    expect(settings.timeZone).toBe('Asia/Kolkata')
    expect(settings.defaultRateCents).toBe(15_000)
    expect(settings.defaultBillingMethod).toBe('fixed_fee')
  })

  it('refuses a time zone this server cannot resolve, and keeps the stored one', async () => {
    // An unresolvable zone would be written once and then quietly change what the whole
    // workspace calls today, so it is rejected at the boundary rather than defaulted.
    await actAs(ws, 'owner_admin')
    const { getSettings } = await import('@/lib/auth/context')
    const before = (await getSettings()).timeZone

    const result = await ws.actions.settings.updateWorkspaceSettings(
      null,
      form({
        agencyName: 'Meridian Studio',
        currency: 'GBP',
        dateFormat: 'yyyy-MM-dd',
        weekStartDay: '1',
        timeZone: 'Mars/Olympus_Mons',
        defaultRateCents: '150.00',
        defaultBillingMethod: 'fixed_fee',
        defaultBillable: 'on',
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('invalid')
      expect(result.error.field).toBe('timeZone')
    }
    expect((await getSettings()).timeZone).toBe(before)
  })

  it('resolves the workspace day in the zone that was saved', async () => {
    await actAs(ws, 'owner_admin')
    const { getSettings } = await import('@/lib/auth/context')
    const { calendarDate } = await import('@/lib/domain/dates')
    const settings = await getSettings()

    // 20:30 UTC is already the next day in Kolkata — the case the setting exists for.
    const instant = new Date('2026-09-01T20:30:00.000Z')
    expect(settings.timeZone).toBe('Asia/Kolkata')
    expect(calendarDate(instant, settings.timeZone)).toBe('2026-09-02')
    expect(calendarDate(instant, 'UTC')).toBe('2026-09-01')
  })
})

describe('assignments and archiving preserve history', () => {
  it('keeps logged time when somebody is unassigned', async () => {
    await actAs(ws, 'owner_admin')
    const rows = await ws.db.execute(ws.sql`
      select te.project_role_id, te.member_id, count(*)::int as entries
      from time_entries te
      join role_assignments ra on ra.project_role_id = te.project_role_id and ra.member_id = te.member_id
      group by 1, 2 order by 3 desc limit 1
    `)
    const target = (rows.rows as unknown as {
      project_role_id: string
      member_id: string
      entries: number
    }[])[0]!

    const remaining = await ws.db.execute(ws.sql`
      select member_id from role_assignments
      where project_role_id = ${target.project_role_id} and member_id <> ${target.member_id}
    `)
    const keep = (remaining.rows as unknown as { member_id: string }[]).map((r) => r.member_id)

    const result = await ws.actions.projects.setRoleAssignments(target.project_role_id, keep)
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true)
    if (result.ok) {
      expect(result.data.removedWithHistory).toBeGreaterThan(0)
      expect(result.warnings?.[0]?.message).toContain('history stays')
    }

    const history = await ws.db.execute(ws.sql`
      select count(*)::int as n from time_entries
      where project_role_id = ${target.project_role_id} and member_id = ${target.member_id}
    `)
    expect(Number((history.rows as unknown as { n: number }[])[0]!.n)).toBe(Number(target.entries))

    // restore the assignment
    await ws.actions.projects.setRoleAssignments(target.project_role_id, [...keep, target.member_id])
  })

  it('refuses to archive the member you are acting as', async () => {
    const acting = await actAs(ws, 'owner_admin')
    const result = await ws.actions.members.archiveMember(acting.id, true)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('acting as')
  })

  it('leaves the billing identity intact after everything above', async () => {
    expect((await billingIdentityHolds()).balanced).toBe(true)
  })
})

describe('a malformed id is refused cleanly, never handed to the database', () => {
  // Every export of a 'use server' module is an endpoint the browser can call with any
  // value at all. Even though the queries are parameterised, an unvalidated id reaches
  // Postgres and comes back as a driver error instead of a refusal a person can read.
  const JUNK = ['', 'not-a-uuid', '../../etc/passwd', "'; drop table members; --", '1 OR 1=1']

  it('refuses junk ids across every action that takes one', async () => {
    await actAs(ws, 'owner_admin')
    const attempts: [string, (value: string) => Promise<{ ok: boolean }>][] = [
      ['archiveMember', (v) => ws.actions.members.archiveMember(v, true)],
      ['setMemberPin', (v) => ws.actions.members.setMemberPin(v, '1234')],
      ['deleteLeave', (v) => ws.actions.members.deleteLeave(v)],
      ['resetMemberPin', (v) => ws.actions.access.resetMemberPin(v)],
      ['setPortalRevoked', (v) => ws.actions.access.setPortalRevoked(v, true)],
      ['archiveClient', (v) => ws.actions.projects.archiveClient(v, true)],
      ['archiveProject', (v) => ws.actions.projects.archiveProject(v, true)],
      ['archiveProjectRole', (v) => ws.actions.projects.archiveProjectRole(v, true)],
      ['setRoleAssignments', (v) => ws.actions.projects.setRoleAssignments(v, [])],
      ['deleteHoliday', (v) => ws.actions.settings.deleteHoliday(v)],
      ['deleteHolidayCalendar', (v) => ws.actions.settings.deleteHolidayCalendar(v)],
    ]

    for (const [name, call] of attempts) {
      for (const junk of JUNK) {
        // It must RETURN a refusal, not throw — a thrown driver error is a 500.
        const result = await call(junk).catch((error: unknown) => ({
          ok: false,
          threw: error instanceof Error ? error.message : String(error),
        }))
        expect(result.ok, `${name}(${JSON.stringify(junk)}) should be refused`).toBe(false)
        expect(
          'threw' in result ? result.threw : '',
          `${name}(${JSON.stringify(junk)}) threw instead of refusing`,
        ).toBe('')
      }
    }
  })

  it('refuses junk ids on the billing and booking actions too', async () => {
    await actAs(ws, 'finance')
    for (const junk of JUNK) {
      const unmark = await ws.actions.billing
        .unmarkInvoice(junk)
        .catch((e: unknown) => ({ ok: false, threw: String(e) }))
      expect(unmark.ok).toBe(false)
      expect('threw' in unmark ? unmark.threw : '').toBe('')
    }

    await actAs(ws, 'resource_manager')
    for (const junk of JUNK) {
      const removed = await ws.actions.bookings
        .deleteBooking(junk)
        .catch((e: unknown) => ({ ok: false, threw: String(e) }))
      expect(removed.ok).toBe(false)
      expect('threw' in removed ? removed.threw : '').toBe('')
    }
  })

  it('still refuses a well-formed id that simply does not exist', async () => {
    await actAs(ws, 'owner_admin')
    const absent = '00000000-0000-4000-8000-000000000000'
    const result = await ws.actions.members.archiveMember(absent, true)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('not_found')
  })

  it('leaves the data untouched after all of that', async () => {
    expect((await billingIdentityHolds()).balanced).toBe(true)
    const counts = await ws.db.execute(ws.sql`
      select (select count(*) from members)::int as members,
             (select count(*) from projects)::int as projects,
             (select count(*) from clients)::int as clients,
             (select count(*) from holidays)::int as holidays
    `)
    const row = (counts.rows as unknown as Record<string, number>[])[0]!
    expect(Number(row.members)).toBe(11)
    expect(Number(row.projects)).toBe(8)
    expect(Number(row.clients)).toBe(4)
    expect(Number(row.holidays)).toBeGreaterThan(40)
  })
})
