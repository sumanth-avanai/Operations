---
description: "Task list for Agency Operations Platform"
---

# Tasks: Agency Operations Platform

**Input**: Design documents from `specs/001-agency-operations-platform/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Unit tests over `lib/domain/*` are REQUIRED — constitution principle V makes
the calculation core non-negotiable. UI tests are not in scope; panels are verified by
exercising real routes against seeded data in Phase 8.

**Organization**: grouped by user story so each phase ends in something operable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency)
- **[Story]**: US1–US8 from spec.md

## Path Conventions

Single Next.js app at the repository root: `app/`, `lib/`, `components/`, `tests/`.

---

## Phase 1: Setup

**Purpose**: a running, typechecking Next.js app with the toolchain in place

- [x] T001 Scaffold Next.js 16 + TypeScript + Tailwind 4 at the repository root, App Router, no `src/`, preserving `.specify/`, `.claude/`, `specs/`, and the PRD
- [x] T002 Install runtime deps: `drizzle-orm`, `@electric-sql/pglite`, `zod`, `date-fns`, `exceljs`, and the Radix packages shadcn/ui needs
- [x] T003 Install dev deps: `drizzle-kit`, `vitest`, `@types/node`; add `npm` scripts `dev`, `build`, `start`, `typecheck`, `test`, `db:generate`, `db:reset`
- [x] T004 Configure `next.config.ts` with `serverExternalPackages: ['@electric-sql/pglite']` so the driver is never bundled or duplicated (research.md D3)
- [x] T005 [P] Configure `tsconfig.json` strict with the `@/*` path alias; `.gitignore` for `.data/`, `.env.local`, `.next`
- [x] T006 [P] Write `.env.example` with `SESSION_SECRET`, `WORKSPACE_PASSWORD`, and a commented `DATABASE_URL`
- [x] T007 [P] Initialize shadcn/ui and vendor the components the panels need: button, input, select, dialog, sheet, table, badge, tabs, tooltip, popover, calendar, textarea, switch, dropdown-menu, sonner
- [x] T008 [P] Establish design tokens and the app shell in `app/globals.css` and `app/layout.tsx`: type scale, neutral palette, status colours, focus rings, dark mode

**Checkpoint**: `npm run dev` serves a styled empty shell; `npm run typecheck` is clean.

---

## Phase 2: Foundational — data, domain, access

**⚠️ Blocking: no user story work starts until this phase is complete.**

### Database

- [x] T010 Write `lib/db/schema.ts`: all 8 enums and all 14 tables from data-model.md, integer minutes and integer cents throughout, with the stated uniques, checks, and indexes
- [x] T011 Write `drizzle.config.ts` (dialect `postgresql`, schema path, out `./drizzle`) and generate the initial migration with `npm run db:generate` — offline, no database opened
- [x] T012 Write `lib/db/client.ts`: the single driver construction point. `fs.mkdirSync(dataDir, {recursive:true})` before `PGlite.create` (research.md D4), `globalThis` singleton so hot reload cannot open a second handle, `migrate()` from `drizzle-orm/pglite/migrator` on first use, `node-postgres` branch when `DATABASE_URL` is set
- [x] T013 Add `app/api/health/route.ts` returning `{ ok, migratedAt, tableCount }` to prove the database boots and migrated

### Domain layer (pure, no I/O) — tests written alongside

- [x] T014 [P] `lib/domain/dates.ts`: `YYYY-MM-DD` arithmetic — add/diff days, weekday index, week start for a configurable first day, expand a range, week/month/quarter/year boundaries, ready-made ranges. No `Date` in any signature.
- [x] T015 [P] `lib/domain/money.ts`: `amountCents(minutes, rateCents)` with half-up integer rounding, cents/hours parsing and formatting, currency formatting
- [x] T016 `lib/domain/capacity.ts`: `workingMinutesOn` (contract dates → holiday → working pattern → leave, in that order), `availableMinutes`, `weeklyCapacityMinutes`, `isDayLocked` with a reason
- [x] T017 [P] `lib/domain/utilization.ts`: utilization percent, target variance, the colour band, and an explicit "undefined when availability is zero" result
- [x] T018 [P] `lib/domain/budget.ts`: `deliveredCents`, `committedCents` (confirmed bookings on days with no logged time for that member+role), `remainingCents`, project budget rollup
- [x] T019 [P] `lib/domain/billing.ts`: the period split where `logged` is defined as `invoiced + unbilled` rather than computed separately
- [x] T020 [P] `lib/domain/guardrails.ts`: over-capacity, over-commitment, slipped-work predicates and their human messages naming the offending date or amount
- [x] T021 `tests/unit/dates.test.ts` + `tests/unit/money.test.ts`: week boundaries across month and year ends, DST-free date arithmetic, rounding half-up, no float drift
- [x] T022 `tests/unit/capacity.test.ts`: part-time pattern, contract start and end edges, holiday, full-day leave, partial leave, leave overlapping a holiday, day outside contract inside a working week
- [x] T023 [P] `tests/unit/budget.test.ts` + `tests/unit/billing.test.ts`: delivered supersedes committed with no double count, tentative excluded, rate change re-prices unbilled but not invoiced, `logged = invoiced + unbilled` holds
- [x] T024 [P] `tests/unit/guardrails.test.ts`: each guardrail has a fires case and a stays-quiet case

### Access control

- [x] T025 `lib/auth/secrets.ts`: scrypt hash and constant-time verify for the workspace password and member PINs, and unguessable portal token generation
- [x] T026 `lib/auth/session.ts`: HMAC-signed HTTP-only cookies for the workspace session (workspace grant + acting member id) and the portal session (member id + token), with parse, issue, and clear
- [x] T027 `lib/auth/permissions.ts`: the role matrix from FR-007 as data, `can(role, capability)`, `requirePermission(session, capability, scope?)` throwing a typed forbidden result, and project ownership scoping for Project Manager
- [x] T028 `middleware.ts`: cookie-presence route guards only, redirecting to `/unlock?next=`; no database access
- [x] T029 `app/unlock/page.tsx` + `lib/actions/access.ts`: workspace unlock, acting-member selection, portal PIN verification with per-token throttling, PIN reset and revoke

### Seed

- [x] T030 `lib/db/seed.ts`, idempotent and only on an empty database: settings; two holiday calendars with real dated holidays; ~10 members spanning full-time, part-time, a mid-quarter contract end and a mid-quarter start, with targets and PINs; 4 clients; 8 projects across billable and non-billable and all three billing methods; roles with varied rates and budgets; assignments; ~3 months of time entries shaped to produce realistic utilization; tentative and confirmed bookings including one that has slipped; leave of each type; two invoices covering part of the logged work; a few health updates per project; notifications

**Checkpoint**: `npm test` green, `/api/health` reports the tables, `.data/pg` seeded.

---

## Phase 3: US1 — Model the agency (P1)

**Goal**: clients, projects with roles/rates/budgets, and members with real schedules

- [x] T031 `lib/db/queries/members.ts`: member list with computed weekly capacity and current-period availability; member detail with leave, assignments, and portal state
- [x] T032 `lib/db/queries/projects.ts`: client list with project counts; project list with client, budget rollup, delivered and committed; project detail with roles, rates, budgets, assignments, consumption
- [x] T033 `lib/actions/members.ts`: create, update, archive, leave upsert/delete — Zod validated, permission checked, revalidating per contract
- [x] T034 `lib/actions/projects.ts`: client and project CRUD, role upsert with rate-change warning, assignment setting
- [x] T035 `app/(workspace)/layout.tsx`: nav for the nine panels, acting-member switcher, notification bell, capability-aware nav hiding backed by real server checks
- [x] T036 `app/(workspace)/members/page.tsx` + `members/[memberId]/page.tsx`: capacity, working-day pattern editor, contract dates, target, holiday calendar, leave list, private link with copy and PIN reset
- [x] T037 `app/(workspace)/projects/page.tsx`: clients with their projects, billable flags, colours, budget rollups, archive toggle
- [x] T038 `app/(workspace)/projects/[projectId]/page.tsx`: roles table with rate, budget, delivered, committed, remaining; assignment editor; project settings
- [x] T039 [P] `components/` shared pieces used by both: capacity bar, budget gauge, colour picker, weekday-hours editor, money and hours inputs that parse to cents and minutes

**Checkpoint**: an agency can be modelled from empty; availability is correct per member.

---

## Phase 4: US2 — The personal portal (P1)

**Goal**: a logger opens a private link, logs a week in two minutes, sees nothing else

- [x] T040 `lib/db/queries/timesheet.ts`: one query set returning a member-week — assigned roles as rows, existing entries, planned minutes from bookings, per-day lock reasons, and the conflict token
- [x] T041 `lib/actions/timesheet.ts` — `saveTimesheetWeek`: whole-week transaction, conflict check on `baseUpdatedAt`, block on locked day / outside contract / not assigned / already invoiced with the offending record named, warn on over-capacity, `minutes: 0` deletes
- [x] T042 `components/grid/week-grid.tsx`: the client island — roles down, days across, planned column, running day and week totals, keyboard-first entry (tab, arrows, decimal or `h:mm`), locked cells with their reason, unsaved-change indicator, one save
- [x] T043 `app/portal/[token]/page.tsx`: generic not-active page for unknown/revoked/archived tokens, PIN gate with throttling, then the member's own week only, week navigation, notes, save with warnings surfaced
- [x] T044 Portal isolation checks: portal session cannot resolve another member, cannot reach a workspace route, and cannot post a payload naming another member — refused server-side

**Checkpoint**: a seeded member logs a real week from their link; guardrails fire; cross-member access is refused.

---

## Phase 5: US3 — Internal timesheet and Home (P1)

- [x] T045 `app/(workspace)/timesheet/page.tsx`: member and week pickers reusing the same grid and the same action with `source: 'internal'`
- [x] T046 `lib/db/queries/home.ts`: for a week — total and billable minutes, per-member logged against available, timesheet completeness, slipped bookings, unbilled total
- [x] T047 `app/(workspace)/page.tsx`: the weekly snapshot with headline figures, per-member capacity bars, guardrail callouts, and shortcuts to create a client, project, or member
- [x] T048 [P] `components/notifications/*` and the bell: list, mark read, deep links

**Checkpoint (Phase B complete)**: the core loop works end to end — model, log, see.

---

## Phase 6: US4 + US5 — Plan and bill (P2)

- [x] T049 `lib/db/queries/planner.ts`: per member per day booked minutes split tentative/confirmed, available minutes, leave and holiday markers, for week/month/quarter/year windows — bounded queries per view
- [x] T050 `lib/actions/bookings.ts`: create, update, delete with over-commitment and over-capacity warnings and the `booked` notification; `checkRoleBudget` read-only probe
- [x] T051 `app/(workspace)/planner/page.tsx` + `components/planner/*`: timeline with density cells colour-coded against availability, tentative styling, inline leave and holidays, scale switch, slipped-work flags
- [x] T052 `components/planner/booking-dialog.tsx`: member, project role, range, minutes per day, tentative toggle, live remaining-budget readout from `checkRoleBudget` before saving
- [x] T053 `lib/db/queries/billing.ts`: period figures grouped by project, role, and person, with logged/invoiced/unbilled per group and headline totals, plus the selectable unbilled entry set
- [x] T054 `lib/actions/billing.ts`: `markInvoiced` freezing amounts in one transaction, `unmarkInvoice`, refusing already-invoiced work by reference
- [x] T055 `app/(workspace)/billing/page.tsx`: period picker, headline figures, grouped breakdown with colour-coded amounts, selection and the invoice dialog, invoice list
- [x] T056 `lib/export/workbook.ts` + `app/api/export/billing/route.ts`: ExcelJS workbook built from the same query function the page uses, workspace currency and date formats

**Checkpoint (Phase C complete)**: a month can be planned against budgets and invoiced.

---

## Phase 7: US6 + US7 + US8 — Report, health, configure (P3)

- [x] T057 `lib/db/queries/reports.ts`: utilization per member for a range with the availability denominator kept whole under numerator filters; grouping by member, project, or client
- [x] T058 `app/(workspace)/reports/page.tsx`: ready-made and custom ranges, filters, grouping, target colour coding and variance, the denominator note, saved-view save/load/delete
- [x] T059 [P] `app/api/export/report/route.ts` reusing the report query function
- [x] T060 `lib/db/queries/health.ts` + `lib/actions/health.ts`: append-only health updates, current health per project via newest row, budget consumption percentage
- [x] T061 `app/(workspace)/status/page.tsx`: portfolio board with current status, risk, satisfaction, budget consumed, over-budget flags, and per-project history
- [x] T062 `lib/actions/settings.ts` + `app/(workspace)/settings/page.tsx`: workspace defaults, currency and date format, week start, password change, holiday calendar and holiday CRUD with the logged-time conflict warning
- [x] T063 [P] Apply workspace currency and date format at every money and date display site through the formatting helpers

**Checkpoint (Phase D complete)**: every PRD panel is present and operable.

---

## Phase 8: Verification and handover

- [x] T064 `npm run typecheck`, `npm test`, and `npm run build` all clean
- [x] T065 Boot the production server and exercise every route against seeded data, confirming each renders real figures and no route 500s
- [x] T066 Exercise the key mutations end to end: save a week internally and from the portal, create a booking that trips the budget warning, mark work invoiced then verify the billing split still balances, record a health update, save and reload a report view
- [x] T067 Verify the negative paths: wrong workspace password, wrong PIN and throttling, portal cross-member access, editing invoiced time, logging on a holiday and outside contract dates, and a stale timesheet save
- [x] T068 [P] Write `README.md` with the local run instructions, the panel tour, the seeded credentials, the single-writer warning, and the Supabase migration path
- [x] T069 [P] Confirm the money and duration audit: no `float`, no `parseFloat` on money, no `numeric` column, no `Date` crossing the data layer for a human-chosen date

---

## Dependencies

- Phase 1 → Phase 2 → everything else.
- T010 blocks T011 blocks T012 blocks every query module.
- T014–T020 block T021–T024 (same modules) and every query module that calls them.
- T025–T027 block T028, T029, and every action.
- T030 blocks all verification and every panel checkpoint.
- US1 (T031–T039) blocks US2 and US3 — there is nothing to log against otherwise.
- US2/US3 block US4 and US5 — planning and billing need real entries.
- US4/US5 block US6 (utilization needs logged time; billing figures feed reports).

## Parallel opportunities

- T005–T008 after T001.
- T014, T015, T017, T018, T019, T020 are independent pure modules.
- T023, T024 alongside each other.
- T031 and T032, T036 and T037 (different files, different queries).
- T059, T063, T068, T069 at the end.

---

## Outcome

All tasks complete. Verified on 2026-09-01:

- `npm run typecheck` clean, `npm run build` clean (16 routes, 3 API routes).
- `npm test` — **153 tests passing** across 11 files:
  - 90 unit tests over `lib/domain/*` and the role matrix, including a fires/stays-quiet
    pair for every guardrail and explicit contract-edge, holiday, partial-week and
    overlapping-leave cases.
  - 19 integration tests booting a real PGlite database, applying the real migrations and
    running the real seed — proving no seeded hour lands on a holiday, leave day,
    non-working day or date outside a contract, and that `logged = invoiced + unbilled`
    holds across the whole dataset.
  - 44 integration tests driving the real server actions: the happy paths plus every
    refusal — wrong password, the role matrix for each role, stale-week conflict, locked
    day, outside contract, unassigned role, invoiced-time immutability, PIN throttling,
    portal cross-member access, revoked links, duplicate invoice references,
    non-billable invoicing, and a calendar still in use.
- Every route exercised against seeded data in a production server: all four planner
  zoom levels, all three billing groupings, all three report groupings, five date
  presets, both `.xlsx` exports (verified as real workbooks), and the portal confirmed
  PIN-gated with no timesheet data in the HTML before the PIN.
- Audit: no `numeric`/`real`/`double` column, no `parseFloat` anywhere, no `Date` crossing
  the data layer for a human-chosen date, all durations integer minutes and all money
  integer cents.

---

## Phase 9: Leak and arithmetic audit (2026-09-02)

A dedicated pass over every read path and every calculation, after the panels were
complete. **Fifteen defects found and fixed** — eleven in authorization (four of them
live read leaks) and four in the arithmetic (two latent overflows, one race, one
capacity ceiling).

### Authorization: reads were capability-checked but not row-scoped

- [x] A1 `/reports` and `/api/export/report` returned global utilization **and revenue**
      to a Project Manager. Both now pass `ownerMemberId`, and the page says the
      numerator is scoped while availability is left whole.
- [x] A2 Home's unbilled figure was global, and its slipped-work callouts named other
      managers' projects. `getHomeSnapshot` now takes `ownerMemberId` and narrows both;
      a member who owns nothing gets zero, not everything.
- [x] A3 The planner returned every booking on every project. Bookings and the booking
      dialog's assignable roles are now scoped; availability stays whole by design and
      the page states this.
- [x] A4 **The invoice list on Billing was not scoped** — a Project Manager could read
      other managers' invoice references, amounts and notes. Found by the isolation
      test, not by inspection. Scoped roles now see only invoices raised against a
      project they own, which also excludes multi-project invoices.
- [x] A5 A member's private portal link — a credential — was rendered for every role with
      `view_members`. It is now shown only to roles with `manage_members`; everyone else
      sees a masked placeholder and an explanation.
- [x] A6 `pin_hash`, `pin_salt` and `portal_token` were present on the member object the
      pages hold. They are stripped in the query layer (`PublicMember`), and the token is
      returned as its own field a page must deliberately pass on.
- [x] A7 `archiveProjectRole` had no ownership check — a Project Manager could archive a
      role on somebody else's engagement.
- [x] A8 `deleteView` let anyone with `view_reports` delete anyone's saved view. Now the
      owner, or a workspace administrator.
- [x] A9 The project detail page checked ownership *after* loading the engagement.
      Ownership is now resolved first, so a scoped role never causes the figures to load.
- [x] A10 `/api/health` sits outside the session guard and disclosed the driver, table
      count and raw error text. Unauthenticated callers now get `{ ok }` and nothing else.

### Arithmetic: two latent overflow defects and a race

- [x] N1 `te.minutes * pr.rate_cents` was `integer * integer` — int4 arithmetic that
      **overflows above a rate of about 14,913 per hour** with a full day logged. Every
      price now casts to `numeric` first, through one shared definition.
- [x] N2 Money and minutes aggregates were cast `::int`, capping a total at 21.47M in the
      workspace currency. All are `::bigint`, read through `toNumber`.
- [x] N3 Money columns were `integer`, capping a single rate, budget, or invoice amount at
      the same figure. All are `bigint` (migration `0001`), with the rate bounded at
      100,000,000 cents so every product and sum stays exact in JavaScript.
- [x] N4 `markInvoiced` computed the invoice total from a SELECT and then ran the UPDATE.
      A concurrent time entry joining the scope would be linked but missing from the
      stored amount. The total is now derived from the UPDATE's `RETURNING`, inside the
      transaction, so `invoices.amount_cents` cannot disagree with its own rows.

### What now guards this

- [x] V1 `tests/unit/pricing-parity.test.ts` — the TypeScript price against exact integer
      half-up rounding over ~246,000 combinations, including every exact-half case, plus
      monotonicity and safe-integer bounds.
- [x] V2 `tests/integration/pricing-sql.test.ts` — the SQL price against the TypeScript
      price over the whole legal input space in a real database, plus regression tests
      that the un-cast multiply and the `::int` sum both raise, so the casts cannot be
      removed silently.
- [x] V3 `tests/integration/isolation.test.ts` — the role matrix pinned as data, and every
      query run through the scoped role with assertions that the rows belong to it, that
      the unscoped call really is wider, and that no other manager's project name appears
      anywhere in the payload. Credential-stripping and the portal's pre-PIN silence are
      asserted directly.
- [x] V4 A per-role HTTP sweep: acting as each role in a production server and grepping
      the rendered HTML for what that role must not see — 60 assertions, zero leaks,
      including that a member's real portal token never reaches Finance, a Project
      Manager or a Resource Manager, and that no page anywhere ships `pinHash` or
      `passwordHash`.

### One more, found by asking what the scoping actually rests on

- [x] A11 The unlock screen had no throttling. Every panel was carefully scoped by role,
      but one shared password admits every internal role — so an unthrottled unlock was a
      path to the whole workspace regardless. It now cools off for ten minutes after ten
      wrong attempts, exactly as the portal PIN does, and a successful unlock or a
      password change clears the counter. Migration `0002`.

### Three more, found by writing the audit as a script instead of a checklist

Turning the audit into `npm run audit` — greps for the invariants rather than a list of
things to remember — immediately found what reading the code had missed.

- [x] A12 **`listMyNotifications(memberId)` lived in a `'use server'` module.** Every
      export of such a module is an endpoint the browser can call with arbitrary
      arguments, so this was an open read of any member's notifications — which name
      projects and bookings. Notification reads moved to `lib/db/queries/notifications.ts`,
      which the browser cannot call; only the two mutations remain as actions, both
      scoped to the acting member.
- [x] A13 `holidayConflicts()` was exported from the same kind of module with no guard at
      all, returning which members logged time on a date. Dead code — deleted. So was
      `ensurePinIsValid()`.
- [x] A14 Eleven actions took a bare id and wrote without validating it. Parameterised
      queries meant no injection, but a malformed id reached Postgres and returned a
      driver error instead of a refusal a person can read. All now go through a shared
      `readId()` guard; 55 junk-id attempts across 13 actions are asserted to return
      clean refusals, throw nothing, and change no data.

### Two defects introduced while fixing the above, and caught

Worth recording, because they are the kind that survive a typecheck:

- [x] X1 A bulk rename of an id parameter also rewrote `timeEntries.invoiceId` to
      `timeEntries.id` inside `unmarkInvoice`. It compiled and would have deleted the
      invoice while leaving its entries pointing at nothing. The existing invoice-cycle
      test caught it.
- [x] X2 The same rename rewrote a form field name — `formData.get('clientId')` became
      `formData.get('id')` — silently breaking project updates. The billability test
      caught it. Both were then fixed by line-exact edits rather than pattern matching,
      and every touched function was re-read against its column references.

### The audit is now a script

`npm run audit` checks ten structural invariants and exits non-zero on any of them:
money is never a float, no `parseFloat`, no `::int` on a money or minutes aggregate, the
price of an hour is defined exactly once per language with no ad-hoc expression
elsewhere, no page-facing type holds a full member row, no `Date` crosses the data layer
for a picked date, every server action authorizes **inside its own body**, no server
action is a read that takes an id, and every writing action validates its input.

**Result: 205 tests passing, 10 invariants holding, 0 leaks, 0 failures.**

### Honest limits of this model

The role separation is a real data boundary, enforced server-side and tested — but it is
not a defence against a malicious insider, because anyone holding the shared workspace
password can choose which member to act as. That is the PRD's design for this version
("internal staff work in a shared, password-protected workspace"), and it is why the
access layer resolves every decision to a member id: introducing per-user credentials in
the hosted phase changes how that id is obtained and nothing else.

---

## Phase 10 — one clock, and a bug the wide scales hid

Opened after the platform was already green, from two questions: a 500 on the Planner,
and whether the product should have a reference day at all.

### The 500

- [x] P1 `/planner` returned 500 on the **quarter** and **year** scales, but only over
      date ranges that contain data — week and month were fine, and so was any window
      with nothing in it, which made it look random. The error was
      `Primitive.button failed to slot onto its children`, pointing at
      `components/planner/timeline.tsx:117`.

      `Timeline` was a *server* component building `content` as an element and handing it
      to `<TooltipTrigger asChild>`. Instrumenting `@radix-ui/react-slot` showed what it
      actually received: `$$typeof = Symbol(react.lazy)` with a thenable `_payload`. Once
      the RSC payload is large enough for React to split it into chunks, an element built
      on the server arrives as a lazy reference, and `Slot` only unwraps one inside its
      `Slottable` branch — so `isValidElement` is false and it throws. Fewer cells stayed
      under the chunk boundary; more cells crossed it.

      Fixed by making the file a client component, so the element is built on the same
      side of the boundary as the `Slot` that clones it. `timeline.tsx` was the only
      offender in the codebase; the `<Button asChild>` uses in server pages are safe
      because `components/ui/button.tsx` is itself a server module.

### One definition of today (D15)

- [x] P2 The workspace had **two** definitions of today. `today()` read the server's
      local calendar — UTC on Vercel — while four dialogs read
      `new Date().toISOString().slice(0, 10)`, the *browser's* UTC date, evaluated once
      during SSR and again on hydration. For an agency in UTC+05:30 both disagreed with
      the agency's real date until 05:30 each morning. Added a `time_zone` setting
      (migration `0003`), resolved it once per request as `ctx.today`, and passed it
      inward; the four dialogs now take it as a prop.
- [x] P3 The clock was un-injectable. `loadRoleConsumption` and the billing report called
      `today()` internally, so the two date gates that are *definitionally* as-of-today —
      slipped work and invoice aging — could not be pinned. Both now take a **required**
      `asOf`, so the compiler rather than diligence guarantees every caller passes the
      workspace's day. Threaded through `getStatusBoard`, `listClientsWithProjects`,
      `getProjectDetail`, `getHomeSnapshot`, `getTimesheetWeek`, `getPlannerData`,
      `getCalendars`, `resolveRange` and both export routes.
- [x] P4 `tests/integration/as-of.test.ts` — 10 tests pinning the boundaries: a booking
      slips on the day *after* it ends and not on the day it ends; slipped work only ever
      grows as `asOf` moves forward; committed minutes and remaining budget do **not**
      move with `asOf` (the reason the slipped list matters at all); aging is a partition
      whose total is invariant; the oldest unbilled entry crosses the 90-day line on
      exactly the 91st day. Reverting `asOf` to `today()` fails 5 of the 10 — checked.
- [x] P5 Six unit tests for the zone itself: the same instant is the 1st in London and
      the 2nd in Kolkata; New Year crosses with the zone, not with UTC; a DST transition
      does not move the day; an unresolvable zone falls back to the host calendar instead
      of throwing; `isTimeZone` accepts only zones this runtime can resolve; and today
      spans at most one day between UTC+14 and UTC−10 whenever the suite runs.
- [x] P6 Three action tests: the zone round-trips through `updateWorkspaceSettings`, an
      unresolvable zone is refused as a `timeZone` validation error with the stored value
      unchanged, and the saved zone is what resolves the workspace day.

### Three more audit invariants

`npm run audit` now checks **thirteen**. The three added here:

- the workspace has exactly one definition of today — no calendar date derived from
  `new Date()` outside `lib/domain/dates.ts`
- `today()` is never asked without a time zone
- no server component slots an element into a client component (the P1 defect, as a
  static rule)

All three were verified to **fail** when the defect they describe is reintroduced, so
none of them is vacuous.

### Verification

Typecheck clean · **223 tests passing** · **13 invariants holding** · production build
clean (17 routes) · migration `0003` applied to a synthetic 0002 database *and* to a copy
of the running one (11 members, 812 entries, 2 invoices, 15 bookings — every row intact)
· **234 route probes** across 6 roles × 4 scales × 7 reference dates, repeated at
`Europe/Berlin`, `Asia/Kolkata`, `Pacific/Kiritimati` and a deliberately invalid zone:
**0 non-OK, 0 server errors** in all four. The Kiritimati run reports a different
workspace day from the Berlin run, which is the proof the setting reaches the product.

**Result: 223 tests passing, 13 invariants holding, 0 leaks, 0 failures.**
