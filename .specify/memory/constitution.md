# Agency Operations Platform Constitution

## Core Principles

### I. One Source of Truth for Hours (NON-NEGOTIABLE)

A logged hour is stored exactly once, in one table, and every other number in the
product is derived from it. Planning, budget consumption, utilization, and billing
read the same rows; none of them keep their own copy of "hours" or "revenue".

- No denormalized totals persisted anywhere unless they are a cache with an
  explicit invalidation path documented in the plan.
- Money is never stored on a time entry. It is always `hours x rate` resolved from
  the project role at read time, so a rate correction re-prices history coherently.
- Billing state lives as a link from the time entry to an invoice, not as a
  duplicated "billed hours" figure. Logged / invoiced / unbilled must always be
  three views of one set of rows, so they cannot disagree.

### II. Honest Capacity Math

Availability reflects the real world or it is worthless. Every capacity figure must
account for the person's working-day pattern, their contract start and end dates,
the public-holiday calendar assigned to them, and approved leave.

- A person outside their contract dates has zero capacity, not default capacity.
- Non-working days, holidays, and leave reduce available hours everywhere the
  figure appears: timesheet, planner, utilization, and reports.
- Utilization is `billable logged hours / available hours` for the same date range,
  never a fixed weekly divisor.
- Any figure that cannot be computed honestly is shown as unknown rather than zero.

### III. Least Privilege and Logger Isolation

Access is granted by what a person does, not by seniority, and time loggers are
walled off entirely.

- Every read and write is authorized on the server. Client-side hiding is
  presentation, never protection.
- The personal portal is scoped to one member by a private token plus a PIN. A
  portal request can only ever read or write that member's own rows, and only for
  projects and roles they are assigned to, within their contract dates.
- Project Managers see their own projects; Finance sees money but not staffing;
  Resource Managers staff but do not invoice. Role checks live in one module so
  the matrix is auditable in a single place.

### IV. Storage-Portable Data Layer

The product runs on file-based PGlite today and on hosted Postgres (Supabase)
later. That swap must be a configuration change, not a rewrite.

- Real PostgreSQL only: standard SQL types, no engine-specific escape hatches, and
  the same migration files run against both targets.
- All database access goes through the data layer. Route handlers, server actions,
  and components never construct SQL and never import the driver.
- The driver is selected in exactly one module, chosen by environment. Nothing else
  in the codebase knows which engine is behind it.

### V. Tested Calculation Core (NON-NEGOTIABLE)

The arithmetic is the product. Capacity, utilization, budget consumption, and the
billing split are pure functions with no I/O, and they are unit tested before the
panels that display them are built.

- Every guardrail threshold (over-capacity, over-commitment, slipped work) has a
  test that proves it fires and a test that proves it stays quiet.
- Date-boundary behaviour is tested explicitly: contract edges, holidays, partial
  weeks, and leave that overlaps a booking.
- A calculation bug is a correctness bug, never a display bug. Fix it in the pure
  function and let every panel inherit the fix.

### VI. Server-First and Fast

The PRD promises a premium, instant feel. Rendering and data work happen on the
server; the client ships interaction, not business logic.

- Data flows down through server components; mutations go up through server
  actions that revalidate the affected views.
- Grids and planners take one query per view, not one per cell or per row.
- No client-side data fetching for anything that can be rendered on the server.

### VII. Guardrails Warn, Integrity Rules Block

The product coaches rather than obstructs, but it never accepts data that makes
the numbers lie.

- Warn (save proceeds, warning surfaced): booked or logged over daily capacity,
  a booking exceeding a role's remaining budget, planned work past its date.
- Block (save refused): time on a non-working day, holiday, or approved leave;
  time outside contract dates; time on a project or role the person is not
  assigned to; edits to work already marked invoiced.
- Every block returns a specific, human explanation naming the offending date or
  record. No generic validation failures.

## Technology Constraints

- TypeScript end to end, `strict` mode, no `any` in application code.
- Next.js App Router with server components and server actions.
- Drizzle ORM over PGlite (file-based, local) with the same schema targeting hosted
  Postgres later. Migrations are files in the repo and are applied at startup.
- Tailwind with shadcn/ui components, owned in-repo so dense grids can be tuned.
- Zod schemas validate every server action input at the boundary.
- Dates are stored as calendar dates without timezone for anything a human picks
  (a timesheet day is a day, not an instant). Money is stored in minor units or
  fixed-precision numeric, never a float.

## Development Workflow and Quality Gates

- Spec-driven: constitution, then spec, then plan, then tasks, then implementation.
  Code that has no task, and tasks that trace to no requirement, do not get written.
- Work is delivered in independently usable slices. Every phase ends with a state a
  person can actually operate, not a half-wired panel.
- Before a phase is called done: typecheck clean, unit tests green, production build
  succeeds, and the affected routes are exercised against real seeded data.
- Seed data must be realistic enough to make every guardrail observable, including
  part-time schedules, contract edges, leave, holidays, and already-invoiced work.

## Governance

This constitution supersedes convenience. When a task and a principle conflict, the
principle wins and the task is rewritten.

- Any deviation must be recorded in the plan's Complexity Tracking section with the
  simpler alternative that was rejected and why.
- Amendments require a version bump here, a note of what changed, and an update to
  any plan or task that relied on the old wording.
- Versioning is semantic: MAJOR for a removed or redefined principle, MINOR for a
  new principle or section, PATCH for clarification that changes no behaviour.

**Version**: 1.0.0 | **Ratified**: 2026-09-01 | **Last Amended**: 2026-09-01
