/**
 * Access control and the timesheet write — the two paths every hour in the product
 * flows through.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { actAs, bootWorkspace, cookieJar, form, installNextDoubles, type Workspace } from './helpers'
import { addDays, startOfWeek, today } from '@/lib/domain/dates'

installNextDoubles()

let ws: Workspace

beforeAll(async () => {
  ws = await bootWorkspace()
}, 180_000)

afterAll(() => ws?.cleanup())

/** A member, one of their assigned roles, and a loggable date in the current week. */
async function pickLoggable(role = 'logger') {
  const rows = await ws.db.execute(ws.sql`
    select m.id as member_id, m.name as member_name, m.portal_token, pr.id as role_id,
           p.name as project_name, m.working_minutes
    from members m
    join role_assignments ra on ra.member_id = m.id
    join project_roles pr on pr.id = ra.project_role_id
    join projects p on p.id = pr.project_id
    where m.role = ${role} and m.archived_at is null and m.contract_end is null
    order by m.name limit 1
  `)
  const row = (rows.rows as unknown as {
    member_id: string
    member_name: string
    portal_token: string
    role_id: string
    project_name: string
  }[])[0]
  if (!row) throw new Error('no loggable member found')
  return row
}

/** The first weekday in the current week where this member actually has capacity. */
async function firstOpenDay(memberId: string): Promise<string> {
  const weekStart = startOfWeek(today(), 1)
  const rows = await ws.db.execute(ws.sql`
    select working_minutes, contract_start, contract_end, holiday_calendar_id
    from members where id = ${memberId}
  `)
  const member = (rows.rows as unknown as {
    working_minutes: Record<string, number>
    contract_start: string
    contract_end: string | null
    holiday_calendar_id: string | null
  }[])[0]!
  const holidayRows = member.holiday_calendar_id
    ? await ws.db.execute(ws.sql`
        select holiday_date::text as d from holidays where calendar_id = ${member.holiday_calendar_id}
      `)
    : { rows: [] as unknown[] }
  const holidays = new Set(
    (holidayRows.rows as unknown as { d: string }[]).map((h) => h.d),
  )
  const leaveRows = await ws.db.execute(ws.sql`
    select start_date::text as s, end_date::text as e from leave where member_id = ${memberId}
  `)
  const leaves = leaveRows.rows as unknown as { s: string; e: string }[]
  const keys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i)
    const key = keys[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]!
    if ((member.working_minutes[key] ?? 0) <= 0) continue
    if (date < member.contract_start) continue
    if (member.contract_end && date > member.contract_end) continue
    if (holidays.has(date)) continue
    if (leaves.some((l) => date >= l.s && date <= l.e)) continue
    return date
  }
  throw new Error('no open day this week')
}

describe('workspace access', () => {
  it('refuses the wrong password with one generic message', async () => {
    cookieJar.clear()
    const result = await ws.actions.access.unlockWorkspace(null, form({ password: 'nope' }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('invalid')
      expect(result.error.message).not.toContain('nope')
    }
    expect(cookieJar.has('aops_ws')).toBe(false)
  })

  it('accepts the right password and then an acting member', async () => {
    const member = await actAs(ws, 'owner_admin')
    expect(cookieJar.has('aops_ws')).toBe(true)
    expect(member.name.length).toBeGreaterThan(0)
  })

  it('throttles repeated wrong passwords, because one password admits every role', async () => {
    cookieJar.clear()
    // Nine wrong attempts are still just wrong.
    for (let attempt = 0; attempt < 9; attempt++) {
      const result = await ws.actions.access.unlockWorkspace(null, form({ password: `guess-${attempt}` }))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('invalid')
    }
    const counted = await ws.db.execute(
      ws.sql`select unlock_failed_count from workspace_settings where id = 'default'`,
    )
    expect(Number((counted.rows as unknown as { unlock_failed_count: number }[])[0]!.unlock_failed_count)).toBe(9)

    // The tenth trips the cool-off, and then even the CORRECT password is refused.
    const tripped = await ws.actions.access.unlockWorkspace(null, form({ password: 'still-wrong' }))
    expect(tripped.ok).toBe(false)
    const correctButLocked = await ws.actions.access.unlockWorkspace(
      null,
      form({ password: 'test-password' }),
    )
    expect(correctButLocked.ok).toBe(false)
    if (!correctButLocked.ok) {
      expect(correctButLocked.error.code).toBe('pin_throttled')
      expect(correctButLocked.error.message).toContain('Too many')
    }
    expect(cookieJar.has('aops_ws')).toBe(false)

    // Clearing the cool-off (as time would) lets the right password back in, and a
    // success resets the counter.
    await ws.db.execute(
      ws.sql`update workspace_settings set unlock_locked_until = null where id = 'default'`,
    )
    const unlocked = await ws.actions.access.unlockWorkspace(null, form({ password: 'test-password' }))
    expect(unlocked.ok).toBe(true)
    const reset = await ws.db.execute(
      ws.sql`select unlock_failed_count, unlock_locked_until from workspace_settings where id = 'default'`,
    )
    const row = (reset.rows as unknown as { unlock_failed_count: number; unlock_locked_until: string | null }[])[0]!
    expect(Number(row.unlock_failed_count)).toBe(0)
    expect(row.unlock_locked_until).toBeNull()
  })

  it('refuses to act as a member that does not exist', async () => {
    await actAs(ws, 'owner_admin')
    const result = await ws.actions.access.setActingMember(
      null,
      form({ memberId: '00000000-0000-4000-8000-000000000000' }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('not_found')
  })
})

describe('the role matrix is enforced server-side', () => {
  it('stops Finance changing project scope', async () => {
    await actAs(ws, 'finance')
    const result = await ws.actions.projects.createClient(
      null,
      form({ name: 'Finance should not create this', color: 'var(--hue-1)', contactEmail: '', notes: '' }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('forbidden')
      expect(result.error.message).toContain('cannot')
    }
  })

  it('stops a Resource Manager invoicing', async () => {
    await actAs(ws, 'resource_manager')
    const result = await ws.actions.billing.markInvoiced(
      null,
      form({
        reference: 'RM-SHOULD-FAIL',
        issuedDate: today(),
        periodStart: today(),
        periodEnd: today(),
        projectId: '00000000-0000-4000-8000-000000000000',
        note: '',
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('forbidden')
  })

  it('stops an Operations Lead changing workspace security', async () => {
    await actAs(ws, 'operations_lead')
    const result = await ws.actions.access.changeWorkspacePassword(
      null,
      form({ currentPassword: 'test-password', newPassword: 'something-else' }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('forbidden')
  })

  it('lets an Owner change it, and the old password stops working', async () => {
    await actAs(ws, 'owner_admin')
    const changed = await ws.actions.access.changeWorkspacePassword(
      null,
      form({ currentPassword: 'test-password', newPassword: 'brand-new-password' }),
    )
    expect(changed.ok).toBe(true)

    cookieJar.clear()
    const stale = await ws.actions.access.unlockWorkspace(null, form({ password: 'test-password' }))
    expect(stale.ok).toBe(false)
    const fresh = await ws.actions.access.unlockWorkspace(null, form({ password: 'brand-new-password' }))
    expect(fresh.ok).toBe(true)

    // put it back so the rest of the suite can act
    const restore = await ws.actions.access.changeWorkspacePassword(
      null,
      form({ currentPassword: 'brand-new-password', newPassword: 'test-password' }),
    )
    expect(restore.ok).toBe(false) // no acting member yet after the cookie clear
    await ws.db.execute(ws.sql`select 1`)
  })
})

describe('saveTimesheetWeek', () => {
  beforeAll(async () => {
    // restore the seeded password directly so actAs keeps working
    const { hashSecret } = await import('@/lib/auth/secrets')
    const { hash, salt } = hashSecret('test-password')
    await ws.db.execute(
      ws.sql`update workspace_settings set password_hash = ${hash}, password_salt = ${salt} where id = 'default'`,
    )
  })

  it('saves a week and reports the cells written', async () => {
    await actAs(ws, 'operations_lead')
    const target = await pickLoggable()
    const date = await firstOpenDay(target.member_id)
    const weekStart = startOfWeek(date, 1)

    const before = await ws.db.execute(ws.sql`
      select coalesce(max(updated_at)::text, '') as t from time_entries
      where member_id = ${target.member_id} and entry_date between ${weekStart} and ${addDays(weekStart, 6)}
    `)
    const baseUpdatedAt = (before.rows as unknown as { t: string }[])[0]!.t || null

    const result = await ws.actions.timesheet.saveTimesheetWeek({
      memberId: target.member_id,
      weekStart,
      baseUpdatedAt,
      cells: [{ projectRoleId: target.role_id, date, minutes: 210, note: 'integration test' }],
    })
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true)

    const stored = await ws.db.execute(ws.sql`
      select minutes, note, source from time_entries
      where member_id = ${target.member_id} and project_role_id = ${target.role_id} and entry_date = ${date}
    `)
    const row = (stored.rows as unknown as { minutes: number; note: string; source: string }[])[0]!
    expect(row.minutes).toBe(210)
    expect(row.note).toBe('integration test')
    expect(row.source).toBe('internal')
  })

  it('rejects a stale save rather than overwriting it', async () => {
    await actAs(ws, 'operations_lead')
    const target = await pickLoggable()
    const date = await firstOpenDay(target.member_id)
    const weekStart = startOfWeek(date, 1)

    const result = await ws.actions.timesheet.saveTimesheetWeek({
      memberId: target.member_id,
      weekStart,
      baseUpdatedAt: '2000-01-01T00:00:00.000Z',
      cells: [{ projectRoleId: target.role_id, date, minutes: 60 }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('conflict')
      expect(result.error.message).toContain('changed this week')
    }

    // and nothing was written
    const stored = await ws.db.execute(ws.sql`
      select minutes from time_entries
      where member_id = ${target.member_id} and project_role_id = ${target.role_id} and entry_date = ${date}
    `)
    expect((stored.rows as unknown as { minutes: number }[])[0]?.minutes).toBe(210)
  })

  it('refuses a non-working day and names the reason', async () => {
    await actAs(ws, 'operations_lead')
    const target = await pickLoggable()
    const date = await firstOpenDay(target.member_id)
    const weekStart = startOfWeek(date, 1)
    const saturday = addDays(weekStart, 5)

    const fresh = await currentToken(target.member_id, weekStart)
    const result = await ws.actions.timesheet.saveTimesheetWeek({
      memberId: target.member_id,
      weekStart,
      baseUpdatedAt: fresh,
      cells: [{ projectRoleId: target.role_id, date: saturday, minutes: 120 }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('locked_day')
      expect(result.error.message).toContain(saturday)
    }
  })

  it('refuses a date outside the contract, naming the dates', async () => {
    await actAs(ws, 'operations_lead')
    const rows = await ws.db.execute(ws.sql`
      select m.id as member_id, m.contract_start::text as contract_start, pr.id as role_id
      from members m
      join role_assignments ra on ra.member_id = m.id
      join project_roles pr on pr.id = ra.project_role_id
      where m.contract_start > current_date - interval '90 days' and m.archived_at is null
      limit 1
    `)
    const target = (rows.rows as unknown as { member_id: string; contract_start: string; role_id: string }[])[0]
    expect(target, 'the seed must include a mid-quarter contract start').toBeTruthy()
    if (!target) return

    const before = addDays(target.contract_start, -3)
    const weekStart = startOfWeek(before, 1)
    const result = await ws.actions.timesheet.saveTimesheetWeek({
      memberId: target.member_id,
      weekStart,
      baseUpdatedAt: await currentToken(target.member_id, weekStart),
      cells: [{ projectRoleId: target.role_id, date: before, minutes: 60 }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('outside_contract')
      expect(result.error.message).toContain(target.contract_start)
    }
  })

  it('refuses a role the member is not assigned to', async () => {
    await actAs(ws, 'operations_lead')
    const target = await pickLoggable()
    const date = await firstOpenDay(target.member_id)
    const weekStart = startOfWeek(date, 1)
    const other = await ws.db.execute(ws.sql`
      select pr.id from project_roles pr
      where pr.id not in (select project_role_id from role_assignments where member_id = ${target.member_id})
      limit 1
    `)
    const otherRoleId = (other.rows as unknown as { id: string }[])[0]!.id

    const result = await ws.actions.timesheet.saveTimesheetWeek({
      memberId: target.member_id,
      weekStart,
      baseUpdatedAt: await currentToken(target.member_id, weekStart),
      cells: [{ projectRoleId: otherRoleId, date, minutes: 60 }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('not_assigned')
  })

  it('warns without blocking when a day goes over capacity', async () => {
    await actAs(ws, 'operations_lead')
    const target = await pickLoggable()
    const date = await firstOpenDay(target.member_id)
    const weekStart = startOfWeek(date, 1)

    const result = await ws.actions.timesheet.saveTimesheetWeek({
      memberId: target.member_id,
      weekStart,
      baseUpdatedAt: await currentToken(target.member_id, weekStart),
      cells: [{ projectRoleId: target.role_id, date, minutes: 780 }],
    })
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true)
    if (result.ok) {
      expect(result.warnings?.some((w) => w.code === 'over_capacity')).toBe(true)
      expect(result.warnings?.[0]?.message).toContain(date)
    }
  })

  it('clears a cell when minutes reach zero', async () => {
    await actAs(ws, 'operations_lead')
    const target = await pickLoggable()
    const date = await firstOpenDay(target.member_id)
    const weekStart = startOfWeek(date, 1)

    const result = await ws.actions.timesheet.saveTimesheetWeek({
      memberId: target.member_id,
      weekStart,
      baseUpdatedAt: await currentToken(target.member_id, weekStart),
      cells: [{ projectRoleId: target.role_id, date, minutes: 0 }],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.deletedCells).toBe(1)

    const stored = await ws.db.execute(ws.sql`
      select count(*)::int as n from time_entries
      where member_id = ${target.member_id} and project_role_id = ${target.role_id} and entry_date = ${date}
    `)
    expect((stored.rows as unknown as { n: number }[])[0]!.n).toBe(0)
  })

  it('refuses to change invoiced hours and names the invoice', async () => {
    await actAs(ws, 'operations_lead')
    const rows = await ws.db.execute(ws.sql`
      select te.member_id, te.project_role_id, te.entry_date::text as entry_date, i.reference
      from time_entries te join invoices i on i.id = te.invoice_id
      limit 1
    `)
    const target = (rows.rows as unknown as {
      member_id: string
      project_role_id: string
      entry_date: string
      reference: string
    }[])[0]
    expect(target, 'the seed must include invoiced work').toBeTruthy()
    if (!target) return

    const weekStart = startOfWeek(target.entry_date, 1)
    const result = await ws.actions.timesheet.saveTimesheetWeek({
      memberId: target.member_id,
      weekStart,
      baseUpdatedAt: await currentToken(target.member_id, weekStart),
      cells: [{ projectRoleId: target.project_role_id, date: target.entry_date, minutes: 999 }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('already_invoiced')
      expect(result.error.message).toContain(target.reference)
    }
  })
})

describe('the personal portal is walled off', () => {
  it('refuses a wrong PIN without disclosing anything, then throttles', async () => {
    cookieJar.clear()
    const target = await pickLoggable()
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await ws.actions.access.verifyPortalPin(
        null,
        form({ token: target.portal_token, pin: '0000' }),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('pin_invalid')
        expect(result.error.message).not.toContain(target.member_name)
      }
    }
    const throttled = await ws.actions.access.verifyPortalPin(
      null,
      form({ token: target.portal_token, pin: '1234' }),
    )
    expect(throttled.ok).toBe(false)
    if (!throttled.ok) expect(throttled.error.code).toBe('pin_throttled')

    // an admin reset clears the lock and issues a new PIN
    await actAs(ws, 'owner_admin')
    const reset = await ws.actions.access.resetMemberPin(target.member_id)
    expect(reset.ok).toBe(true)
    if (reset.ok) expect(reset.data.pin).toMatch(/^\d{4}$/)
  })

  it('opens with the correct PIN and can log its own week', async () => {
    const target = await pickLoggable()
    // set a known PIN as admin
    await actAs(ws, 'owner_admin')
    const set = await ws.actions.members.setMemberPin(target.member_id, '4321')
    expect(set.ok).toBe(true)

    cookieJar.clear()
    const opened = await ws.actions.access.verifyPortalPin(
      null,
      form({ token: target.portal_token, pin: '4321' }),
    )
    expect(opened.ok, opened.ok ? '' : opened.error.message).toBe(true)

    const date = await firstOpenDay(target.member_id)
    const weekStart = startOfWeek(date, 1)
    const result = await ws.actions.timesheet.saveTimesheetWeek({
      memberId: target.member_id,
      weekStart,
      baseUpdatedAt: await currentToken(target.member_id, weekStart),
      cells: [{ projectRoleId: target.role_id, date, minutes: 180 }],
      portalToken: target.portal_token,
    })
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true)

    const stored = await ws.db.execute(ws.sql`
      select source from time_entries
      where member_id = ${target.member_id} and project_role_id = ${target.role_id} and entry_date = ${date}
    `)
    expect((stored.rows as unknown as { source: string }[])[0]!.source).toBe('portal')
  })

  it('cannot write another member’s week even with a valid session', async () => {
    const target = await pickLoggable()
    const others = await ws.db.execute(ws.sql`
      select m.id as member_id, pr.id as role_id
      from members m
      join role_assignments ra on ra.member_id = m.id
      join project_roles pr on pr.id = ra.project_role_id
      where m.id <> ${target.member_id} and m.archived_at is null
      limit 1
    `)
    const other = (others.rows as unknown as { member_id: string; role_id: string }[])[0]!

    cookieJar.clear()
    const opened = await ws.actions.access.verifyPortalPin(
      null,
      form({ token: target.portal_token, pin: '4321' }),
    )
    expect(opened.ok).toBe(true)

    const date = await firstOpenDay(other.member_id)
    const result = await ws.actions.timesheet.saveTimesheetWeek({
      memberId: other.member_id,
      weekStart: startOfWeek(date, 1),
      baseUpdatedAt: null,
      cells: [{ projectRoleId: other.role_id, date, minutes: 60 }],
      portalToken: target.portal_token,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('forbidden')
      expect(result.error.message).toContain('own owner')
    }
  })

  it('stops working the moment access is revoked', async () => {
    const target = await pickLoggable()
    await actAs(ws, 'owner_admin')
    const revoked = await ws.actions.access.setPortalRevoked(target.member_id, true)
    expect(revoked.ok).toBe(true)

    cookieJar.clear()
    const attempt = await ws.actions.access.verifyPortalPin(
      null,
      form({ token: target.portal_token, pin: '4321' }),
    )
    expect(attempt.ok).toBe(false)

    await actAs(ws, 'owner_admin')
    await ws.actions.access.setPortalRevoked(target.member_id, false)
  })
})

/** The conflict token the UI would have loaded for this member-week. */
async function currentToken(memberId: string, weekStart: string): Promise<string | null> {
  const res = await ws.db.execute(ws.sql`
    select max(updated_at)::text as t from time_entries
    where member_id = ${memberId} and entry_date between ${weekStart} and ${addDays(weekStart, 6)}
  `)
  return (res.rows as unknown as { t: string | null }[])[0]?.t ?? null
}
