# Contract: Server Actions

Every mutation in the product is a Next.js server action. The contract for all of them:

- **Input** is validated by a Zod schema at the function boundary before anything else.
  An invalid input returns a field-keyed error and touches no data.
- **Authorization** is checked after validation and before any write, by
  `requirePermission(session, capability, scope?)` from `lib/auth/permissions.ts`.
  Portal sessions can only ever resolve to their own member id.
- **Return shape** is uniform and never throws for expected outcomes:

```ts
type ActionResult<T = void> =
  | { ok: true;  data: T;  warnings?: Warning[] }
  | { ok: false; error: { code: ErrorCode; message: string; field?: string } }

type Warning = { code: WarningCode; message: string; date?: string }
```

- **Warnings never block.** `ok: true` with warnings means the write happened and the
  user must be told something (constitution VII).
- **Errors always name the offending record.** `message` includes the date, member, or
  invoice reference that caused the refusal — no generic validation text.
- **Revalidation**: every successful mutation revalidates the paths whose figures it
  changed. Listed per action below.

`ErrorCode`: `forbidden` · `not_found` · `invalid` · `locked_day` · `outside_contract` ·
`not_assigned` · `already_invoiced` · `conflict` · `pin_invalid` · `pin_throttled` ·
`duplicate`

`WarningCode`: `over_capacity` · `over_commitment` · `slipped_work` ·
`non_billable_project` · `holiday_conflict`

---

## Access

### `unlockWorkspace(input)`

- **In**: `{ password: string }`
- **Out**: `{ ok: true, data: { memberOptions: {id,name,role}[] } }`
- **Errors**: `invalid` (wrong password — same message and timing regardless of cause)
- **Effect**: sets the signed workspace cookie. Does not yet set an acting member.

### `setActingMember(input)`

- **In**: `{ memberId: uuid }`
- **Auth**: workspace cookie present
- **Out**: `{ ok: true }` · **Errors**: `not_found`, `forbidden` (archived member)
- **Revalidates**: `/` (layout — the whole workspace re-renders under the new role)

### `verifyPortalPin(input)`

- **In**: `{ token: string, pin: string }`
- **Out**: `{ ok: true }` · **Errors**: `pin_invalid`, `pin_throttled`, `not_found`
- **Effect**: on success resets `pin_failed_count` and sets a member-scoped cookie; on
  failure increments the counter and sets `pin_locked_until` past a threshold. Reveals
  nothing about the member before success (FR-005).

### `resetMemberPin(input)` · `setPortalRevoked(input)`

- **In**: `{ memberId: uuid, pin?: string }` · `{ memberId: uuid, revoked: boolean }`
- **Auth**: `manage_workspace` (Owner/Admin only)
- **Effect**: takes effect immediately; existing portal cookies for that member stop
  validating. History is untouched.

---

## People

### `createMember(input)` / `updateMember(input)`

- **In**: `{ name, email, role, workingMinutes: Record<Weekday, number>, contractStart,
  contractEnd?, utilizationTargetPct?, holidayCalendarId?, color }`
- **Auth**: `manage_members`
- **Out**: `{ ok: true, data: { memberId, portalUrl } }`
- **Errors**: `duplicate` (email), `invalid` (contractEnd before contractStart; a
  weekday over 24h; target outside 0–100)
- **Effect on create**: generates `portal_token`, records an `onboarded` notification
  (FR-031).
- **Revalidates**: `/members`, `/`, `/planner`, `/reports`

### `archiveMember(input)`

- **In**: `{ memberId, archived: boolean }` · **Auth**: `manage_members`
- **Effect**: excluded from planning, new time entry, and capacity totals; portal link
  stops working; all history retained (FR-012).

### `upsertLeave(input)` / `deleteLeave(input)`

- **In**: `{ memberId, leaveType, startDate, endDate, minutesPerDay?, note? }`
- **Auth**: `manage_members`
- **Out**: warnings include `holiday_conflict` when the range already contains logged
  time, and the affected bookings are named so the resource manager can rebalance.
- **Revalidates**: `/planner`, `/timesheet`, `/reports`, `/`

---

## Clients, projects, roles

### `createClient` / `updateClient` / `archiveClient`

- **Auth**: `manage_projects` · **Revalidates**: `/projects`, `/`

### `createProject` / `updateProject` / `archiveProject`

- **In**: `{ clientId, name, code?, color, billable, billingMethod, startDate?,
  endDate?, notes? }`
- **Auth**: `manage_projects`; a Project Manager may only touch projects they own
- **Out**: warnings include `non_billable_project` when `billable` is turned off while
  unbilled billable hours exist, stating how much revenue leaves the billing view.
- **Revalidates**: `/projects`, `/projects/[id]`, `/billing`, `/status`, `/`

### `upsertProjectRole(input)` / `archiveProjectRole(input)`

- **In**: `{ projectId, roleId?, name, rateCents, budgetCents, budgetMinutes?, sortOrder? }`
- **Auth**: `manage_projects`
- **Errors**: `duplicate` (role name on project), `invalid` (negative rate or budget)
- **Note**: changing `rateCents` re-prices unbilled work by design; the action returns
  the resulting change in unbilled value as a warning so it is never a surprise.
- **Revalidates**: `/projects/[id]`, `/billing`, `/planner`, `/status`

### `setRoleAssignments(input)`

- **In**: `{ projectRoleId, memberIds: uuid[] }` · **Auth**: `manage_assignments`
- **Effect**: removing a member who has logged time keeps the history and blocks only
  new entries.

---

## Time

### `saveTimesheetWeek(input)`

The central write of the product.

- **In**:

```ts
{
  memberId: uuid,
  weekStart: 'YYYY-MM-DD',
  baseUpdatedAt: string | null,          // conflict token from the load
  cells: { projectRoleId: uuid, date: 'YYYY-MM-DD', minutes: number, note?: string }[]
}
```

- **Auth**: `log_time_for_others`, **or** a portal session whose member id equals
  `memberId` (in which case `source` is `portal`)
- **Out**: `{ ok: true, data: { savedCells: number, updatedAt: string },
  warnings: [{ code: 'over_capacity', date, message }] }`
- **Errors**:
  - `conflict` — `baseUpdatedAt` is stale; nothing is written (FR-024)
  - `locked_day` — the date is a non-working day, holiday, or leave day; names the date
    and the reason
  - `outside_contract` — the date is outside the member's contract dates
  - `not_assigned` — the member is not assigned to that project role
  - `already_invoiced` — a touched cell is invoiced; names the invoice reference
- **Semantics**: the whole week is one transaction. `minutes: 0` deletes the cell's row.
  Cells absent from the payload are left alone. All-or-nothing: one bad cell writes
  nothing.
- **Revalidates**: `/timesheet`, `/`, `/billing`, `/reports`, `/status`,
  `/portal/[token]`

---

## Planning

### `createBooking(input)` / `updateBooking(input)` / `deleteBooking(input)`

- **In**: `{ memberId, projectRoleId, startDate, endDate, minutesPerDay, status, note? }`
- **Auth**: `manage_bookings`
- **Out**: warnings `over_commitment` (states the overage in currency against the
  role's remaining budget) and `over_capacity` (per date where the member's total
  booked minutes exceed available minutes)
- **Errors**: `not_assigned`, `invalid` (end before start; minutesPerDay over 24h)
- **Effect**: on create, records a `booked` notification for the member (FR-031)
- **Revalidates**: `/planner`, `/timesheet`, `/projects/[id]`, `/status`, `/`

### `checkRoleBudget(input)` — read-only probe used by the planner before saving

- **In**: `{ projectRoleId, startDate, endDate, minutesPerDay, excludeBookingId? }`
- **Out**: `{ ok: true, data: { budgetCents, deliveredCents, committedCents,
  remainingCents, proposalCents, wouldExceedBy: number } }`
- **Purpose**: SC-004 — the answer arrives without leaving the planner.

---

## Billing

### `markInvoiced(input)`

- **In**: `{ reference, issuedDate, periodStart, periodEnd, projectId, note? }`
- **Auth**: `manage_billing`
- **Out**: `{ ok: true, data: { invoiceId, amountCents, entryCount } }`
- **Errors**: `duplicate` (invoice reference already used), `invalid` (the project is
  non-billable, or it has no unbilled work in that period — the message names the
  project and the dates)
- **Effect**: one transaction — creates the invoice, then prices and links **every**
  unbilled billable entry for that project in that period, freezing
  `invoiced_amount_cents` per entry at the current role rate. Those entries become
  immutable. The `update` is guarded by `invoice_id is null`, so two people invoicing
  the same scope concurrently cannot double-bill: the second finds nothing to bill.
- **Design note**: the scope is `(project, period)` rather than a list of entry ids.
  Shipping thousands of ids to the browser and back to select "everything unbilled" was
  the alternative, and it made the client responsible for a set the server can define
  exactly. `already_invoiced` therefore cannot arise here — an entry that already has an
  invoice is simply outside the scope — and it remains the refusal used when someone
  tries to *edit* invoiced time.
- **Revalidates**: `/billing`, `/reports`, `/status`, `/projects/[id]`

### `unmarkInvoice(input)`

- **In**: `{ invoiceId }` · **Auth**: `manage_billing`
- **Effect**: deletes the invoice and clears the link and frozen amount on its
  entries, returning them to unbilled. The only way to correct a mis-invoicing, and it
  is explicit rather than an edit.

---

## Health, reports, notifications

### `recordHealthUpdate(input)`

- **In**: `{ projectId, updateDate, status, risk, satisfaction?, comment? }`
- **Auth**: `manage_projects` (own projects for a Project Manager)
- **Effect**: appends; becomes current health. Never overwrites a prior update.
- **Revalidates**: `/status`, `/projects/[id]`, `/`

### `saveView(input)` / `deleteView(input)`

- **In**: `{ panel, name, config }` · **Auth**: `view_reports`
- **Errors**: `duplicate` (name within panel)

### `markNotificationsRead(input)`

- **In**: `{ ids: uuid[] }` · **Auth**: own notifications only

---

## Settings

### `updateWorkspaceSettings(input)`

- **In**: `{ agencyName, currency, dateFormat, weekStartDay, defaultRateCents,
  defaultBillingMethod, defaultBillable }`
- **Auth**: `manage_workspace` · **Revalidates**: `/` and every money or date view

### `changeWorkspacePassword(input)`

- **In**: `{ currentPassword, newPassword }` · **Auth**: `manage_workspace`

### `upsertHolidayCalendar` / `deleteHolidayCalendar` / `upsertHoliday` / `deleteHoliday`

- **Auth**: `manage_workspace`
- **Out**: `upsertHoliday` warns `holiday_conflict` when time is already logged on that
  date, naming each member — the hours are preserved, never silently deleted.
- **Revalidates**: `/settings`, `/timesheet`, `/planner`, `/reports`, `/`
