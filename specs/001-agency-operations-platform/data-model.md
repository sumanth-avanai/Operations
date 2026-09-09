# Phase 1 Data Model: Agency Operations Platform

Conventions, applied to every table:

- Primary keys are `uuid` with a `gen_random_uuid()` default.
- Durations are `integer` **minutes**. Money is `bigint` **cents**, read as a JS number.
  (research.md D5, D13 — `integer` would cap a single amount at 21.47M in the workspace
  currency, which a real yearly total passes.) A role's rate is bounded at 100,000,000
  cents per hour so every product and sum stays exact in JavaScript.
- Human-chosen dates are `date`, handled as `YYYY-MM-DD` strings. Event timestamps are
  `timestamptz`. (research.md D6)
- Soft delete is `archived_at timestamptz null`; history is never destroyed.
- Nothing derivable is stored. Where a value is cached, it is listed under
  "Deliberate caches" at the bottom with its invalidation rule.

## Enumerations

| Enum | Values |
|---|---|
| `member_role` | `owner_admin`, `operations_lead`, `resource_manager`, `project_manager`, `finance`, `logger` |
| `project_status` | `on_track`, `at_risk`, `on_hold`, `done` |
| `risk_level` | `low`, `medium`, `high` |
| `billing_method` | `time_and_materials`, `fixed_fee`, `retainer` |
| `booking_status` | `tentative`, `confirmed` |
| `leave_type` | `vacation`, `sick`, `unpaid`, `other` |
| `entry_source` | `internal`, `portal` |
| `notification_kind` | `booked`, `onboarded`, `over_commitment`, `slipped_work` |

## Entities

### `workspace_settings` — single row

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | always `'default'`; a check constraint keeps the table to one row |
| `agency_name` | text not null | |
| `currency` | text not null | ISO 4217, e.g. `EUR` |
| `date_format` | text not null | e.g. `dd/MM/yyyy` |
| `week_start_day` | integer not null | 1 = Monday |
| `time_zone` | text not null | IANA zone, e.g. `Europe/Berlin`; **the only definition of today** (D15). Defaults to `UTC`; a check keeps it 1–64 characters, and the action validates it against `Intl` |
| `default_rate_cents` | integer not null | pre-fills a new project role |
| `default_billing_method` | `billing_method` not null | pre-fills a new project |
| `default_billable` | boolean not null | pre-fills a new project |
| `password_hash` / `password_salt` | text not null | workspace password (scrypt) |
| `updated_at` | timestamptz not null | |

### `holiday_calendars`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text not null | e.g. "Germany — Bavaria" |
| `region_code` | text | e.g. `DE-BY` |

### `holidays`

| Column | Type | Notes |
|---|---|---|
| `calendar_id` | uuid FK → `holiday_calendars` on delete cascade | |
| `holiday_date` | date not null | |
| `name` | text not null | shown on the locked timesheet cell |

Unique `(calendar_id, holiday_date)`. Index on `(calendar_id, holiday_date)`.

### `members`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text not null | |
| `email` | text not null unique | |
| `role` | `member_role` not null | drives the permission matrix (FR-007) |
| `working_minutes` | jsonb not null | `{"mon":480,...,"sun":0}` — the **only** capacity source |
| `contract_start` | date not null | |
| `contract_end` | date null | null = open-ended |
| `utilization_target_pct` | integer null | 0–100 |
| `holiday_calendar_id` | uuid FK null | |
| `portal_token` | text not null unique | unguessable, 32 bytes base64url |
| `pin_hash` / `pin_salt` | text null | null = PIN not yet set |
| `portal_revoked` | boolean not null default false | |
| `pin_failed_count` | integer not null default 0 | |
| `pin_locked_until` | timestamptz null | throttling (FR-005) |
| `color` | text not null | planner and chart identity |
| `archived_at` | timestamptz null | |

Weekly capacity is **not stored** — it is `sum(working_minutes)`, so the pattern and the
total can never disagree (constitution I). Index on `archived_at`, unique on
`portal_token`.

### `clients`

`id`, `name` (not null), `color` (not null), `contact_email`, `notes`,
`archived_at`, `created_at`.

### `projects`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `client_id` | uuid FK → `clients` | |
| `name` | text not null | |
| `code` | text null unique | short reference |
| `color` | text not null | |
| `billable` | boolean not null | the single source for whether work bills (FR-033) |
| `billing_method` | `billing_method` not null | |
| `start_date` / `end_date` | date null | |
| `notes` | text | |
| `archived_at` | timestamptz null | |

**No budget column** — a project's budget is `sum(project_roles.budget_cents)`
(FR-015). **No status, risk, or satisfaction column** — current health is the newest
`project_health_updates` row for the project (FR-045); a project with no updates reads
as "no update yet" rather than a fabricated `on_track`. Index on `(client_id)`,
`archived_at`.

### `project_roles`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `project_id` | uuid FK → `projects` on delete cascade | |
| `name` | text not null | e.g. "Senior Designer" |
| `rate_cents` | integer not null | hourly rate; **the only source of price** |
| `budget_cents` | integer not null default 0 | |
| `budget_minutes` | integer null | optional hours cap alongside the money cap |
| `sort_order` | integer not null default 0 | |
| `archived_at` | timestamptz null | |

Unique `(project_id, name)`. This row is the unit budgets are tracked against and the
only place a rate lives — a rate correction re-prices all unbilled history (FR-034).

### `role_assignments`

`id`, `project_role_id` FK cascade, `member_id` FK, `created_at`.
Unique `(project_role_id, member_id)`. Eligibility to log time (FR-020) and to be
booked. Removing an assignment never deletes history.

### `time_entries` — the single source of truth

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `member_id` | uuid FK → `members` | |
| `project_role_id` | uuid FK → `project_roles` | project is reached through the role |
| `entry_date` | date not null | a calendar day, never an instant |
| `minutes` | integer not null, check > 0 | zero is represented by deleting the row |
| `note` | text | |
| `invoice_id` | uuid FK → `invoices` null | null = unbilled |
| `invoiced_amount_cents` | integer null | frozen at invoicing; null while unbilled |
| `source` | `entry_source` not null | `internal` or `portal` |
| `created_at` / `updated_at` | timestamptz not null | `updated_at` powers conflict detection |

Unique `(member_id, project_role_id, entry_date)` — one cell per role per day, which is
exactly one row per grid cell. Indexes on `(member_id, entry_date)`,
`(project_role_id, entry_date)`, `(entry_date)`, `(invoice_id)`.

**No `billable` column**: billability is `projects.billable` at read time, which is
precisely why marking a project non-billable drops its unbilled hours out of billing
while invoiced work stays frozen. **No `amount_cents` while unbilled**: the amount is
`minutes x rate_cents / 60` from the role.

### `bookings`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `member_id` | uuid FK → `members` | |
| `project_role_id` | uuid FK → `project_roles` | |
| `start_date` / `end_date` | date not null | inclusive |
| `minutes_per_day` | integer not null | applied to each *effective* day |
| `status` | `booking_status` not null | `tentative` excluded from committed spend (FR-028) |
| `note` | text | |
| `created_by_member_id` | uuid FK null | |

Index on `(member_id, start_date, end_date)`, `(project_role_id)`. Days inside the
range that are non-working, holidays, leave, or outside contract dates contribute zero
booked minutes (FR-029) — the range is stored as the user drew it and reality is
applied at read time.

### `leave`

`id`, `member_id` FK, `leave_type` not null, `start_date`, `end_date` (inclusive),
`minutes_per_day` null (`null` = the whole working day), `note`, `created_at`.
Index on `(member_id, start_date, end_date)`.

### `project_health_updates`

`id`, `project_id` FK cascade, `update_date` date not null, `status`
`project_status` not null, `risk` `risk_level` not null, `satisfaction` integer null
check 1–5, `comment` text, `author_member_id` FK null, `created_at`.
Index on `(project_id, update_date desc, created_at desc)`. Append-only: the newest row
is the project's current health, all rows are the history (FR-045).

### `invoices`

`id`, `reference` text not null unique, `issued_date` date not null, `period_start`,
`period_end` date not null, `project_id` FK null, `amount_cents` integer not null,
`note` text, `created_at`. The entries it billed point at it; the invoice does not list
them.

### `saved_views`

`id`, `name` not null, `panel` text not null (`reports` | `billing`), `config` jsonb
not null, `owner_member_id` FK null, `created_at`. Unique `(panel, name)`.

### `notifications`

`id`, `member_id` FK, `kind` `notification_kind` not null, `title` not null, `body`,
`link` text, `read_at` timestamptz null, `created_at`. Index on
`(member_id, read_at, created_at desc)`.

## Derived calculations — normative definitions

These live in `lib/domain/` as pure functions and are the only place these figures are
defined. Every panel reads them; none recomputes them.

### Availability

```
workingMinutesOn(member, date):
  if date < member.contract_start                    -> 0
  if member.contract_end and date > contract_end     -> 0
  if date is a holiday on member's calendar          -> 0
  pattern = member.working_minutes[weekdayOf(date)]
  if pattern == 0                                    -> 0
  if leave covers date:
     full-day leave (minutes_per_day is null)        -> 0
     partial leave                                   -> max(0, pattern - minutes_per_day)
  otherwise                                          -> pattern

availableMinutes(member, from, to) = sum of workingMinutesOn over each day
weeklyCapacityMinutes(member)      = sum(member.working_minutes)
```

A day with zero available minutes is **locked** for time entry (FR-020) and
contributes zero booked minutes (FR-029).

### Utilization

```
loggedMinutes(member, from, to)         = sum(time_entries.minutes) in range
billableLoggedMinutes(member, from, to) = same, restricted to projects.billable
utilizationPct = billableLoggedMinutes / availableMinutes * 100     (undefined if 0)
targetVariancePct = utilizationPct - member.utilization_target_pct
```

`availableMinutes` is the denominator always, and it is **never narrowed** by a client
or project filter — filtering the numerator while keeping the denominator whole is what
FR-042 requires, and the report states it.

### Money from time

```
amountCents(minutes, rateCents) = round(minutes * rateCents / 60)
```

Integer arithmetic, half-up, computed once in one function.

### Role budget consumption

```
deliveredCents(role)  = sum over the role's time_entries of
                          entry.invoice_id ? entry.invoiced_amount_cents
                                           : amountCents(entry.minutes, role.rate_cents)

committedCents(role)  = sum over the role's CONFIRMED bookings of
                          amountCents(undeliveredBookedMinutes, role.rate_cents)
   where undeliveredBookedMinutes counts a booking's effective minutes only on days
   the same member logged nothing against that role — so delivered work supersedes
   the plan and the two can never double count.

remainingCents(role)  = role.budget_cents - deliveredCents - committedCents
projectBudgetCents    = sum of its roles' budget_cents
```

Tentative bookings are excluded from `committedCents` and appear only in a member's
provisional load (FR-028).

### Billing split for a period

```
scope: time_entries in [from, to] whose project.billable is true
invoicedCents(scope) = sum(invoiced_amount_cents) where invoice_id is not null
unbilledCents(scope) = sum(amountCents(minutes, role.rate_cents)) where invoice_id is null
loggedCents(scope)   = invoicedCents + unbilledCents          -- true by construction
```

Because `logged` is defined as the sum of the other two rather than computed
separately, SC-002 cannot be violated by an arithmetic bug.

### Guardrails

```
overCapacityOnDay(member, date)   = loggedMinutesOnDay > workingMinutesOn(member, date)   -> warn
overCommitment(role, proposal)    = amountCents(proposal) > remainingCents(role)          -> warn
slippedWork(booking)              = booking.end_date < today
                                    and booking.status = 'confirmed'
                                    and loggedMinutesInRange < effectiveBookedMinutes     -> flag
```

## Deliberate caches

| Cached value | Where | Invalidation rule |
|---|---|---|
| `invoices.amount_cents` | invoice row | Written **from the rows the invoicing UPDATE actually linked**, inside the same transaction, not from a SELECT taken beforehand. Deriving it beforehand leaves a window in which a concurrent time entry joins the scope, gets linked, and is missing from the stored total. Those entries then become immutable (FR-022), so the value cannot drift afterwards. |
| `time_entries.invoiced_amount_cents` | entry row | Written once at invoicing to freeze the price against later rate changes (FR-034). Never updated. |

Both are frozen-at-a-point-in-time facts about a billing event rather than live
derivations, which is why they are stored rather than computed.

## Concurrency

FR-024 needs no extra table. A timesheet load returns the maximum `updated_at` across
the member-week it read. The save action sends that value back; the server recomputes
it and rejects the save with a conflict if it has moved. Two people editing the same
week means the second save is refused, never silently merged.

## Reads are scoped, not only writes

A capability answers "may this role use this panel?". It does not answer "which rows may
they see?". Both questions are asked, in that order, on every path:

| Role | Reads narrowed to |
|---|---|
| Owner / Admin, Operations Lead | everything |
| Resource Manager | everything except money — no billing figures at all |
| Project Manager | the engagements they own: projects, billing, reports, the status board, the planner's bookings, the invoice list, and the Home money figure and warnings. Availability stays whole, because who is free is staffing information the planner exists to show, and the report says so. |
| Finance / Billing | everything, read-only outside billing |
| Employee / Consultant | their own week, through their own link, and nothing else |

An invoice raised against several projects is invisible to a scoped role, because its
reference, amount and note describe work that is not all theirs.

Credentials are not part of any member type a page could pass to a client component:
`pin_hash`, `pin_salt` and `portal_token` are stripped in the query layer, and the portal
token is returned as its own field that only `manage_members` roles are shown.

## Referential and integrity rules enforced in the data layer

1. A time entry's `(member_id, project_role_id)` must exist in `role_assignments` at
   insert time; history survives a later un-assignment.
2. `minutes > 0`; a cleared cell deletes its row.
3. No insert, update, or delete on a `time_entry` with a non-null `invoice_id`.
4. An entry's `entry_date` must have `workingMinutesOn(member, date) > 0`.
5. Invoicing refuses any entry that already has an `invoice_id`, naming the reference.
6. `satisfaction` is 1–5 or null; `utilization_target_pct` is 0–100 or null.
