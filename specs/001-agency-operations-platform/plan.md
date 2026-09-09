# Implementation Plan: Agency Operations Platform

**Branch**: `001-agency-operations-platform` | **Date**: 2026-09-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-agency-operations-platform/spec.md`

## Summary

Build a single-tenant web application that keeps time, planning, role-based budgets, and
billing on one set of rows, so the hours a team logs are the hours the agency plans,
budgets, and bills from. A shared workspace password admits internal staff, who then act
as a specific member whose role determines what they can do; time loggers get an
account-free private link plus a PIN that exposes nothing but their own week.

Technically: a Next.js App Router application, server-rendered throughout, with all
mutations as validated server actions. Persistence is real PostgreSQL from day one via
file-based PGlite through Drizzle ORM, chosen so the later move to Supabase is a driver
swap in one module rather than a rewrite. Every duration is stored as integer minutes and
every amount as integer cents, and all capacity, budget, utilization, and billing figures
come from one tested, pure domain layer that no panel bypasses.

## Technical Context

**Language/Version**: TypeScript 5.9 (`strict`), Node.js 22

**Primary Dependencies**: Next.js 16 (App Router, server components, server actions),
React 19, Tailwind CSS 4, shadcn/ui (Radix primitives, vendored in-repo), Drizzle ORM
0.45, `@electric-sql/pglite` 0.5, Zod 4, `date-fns` 4 (formatting only), ExcelJS 4

**Storage**: PGlite, file-backed at `.data/pg`, addressed as PostgreSQL through Drizzle.
Migrations are generated offline by `drizzle-kit` and applied in-process at startup.
Hosted Postgres/Supabase is selected by presence of `DATABASE_URL` with no other change.

**Testing**: Vitest over the pure domain layer (capacity, utilization, budget, billing,
guardrail thresholds, date boundaries) plus a route-and-action smoke pass against seeded
data during verification

**Target Platform**: Local development on Windows via `npm run dev`; Vercel-compatible
for the hosted phase (at which point `DATABASE_URL` must be set, since a serverless
filesystem cannot host PGlite)

**Project Type**: Single Next.js web application — no separate backend, because server
components and server actions *are* the backend

**Performance Goals**: A bounded number of queries per view regardless of row count; the
timesheet week, the planner month, and a full-year report each render from a small fixed
set of aggregate queries. Grid interaction is local state with a single save.

**Constraints**: Exactly one process may open the PGlite data directory (research.md D3);
no floating-point money or duration arithmetic anywhere; no timezone conversion applied
to a human-chosen date; no client-side business logic

**Scale/Scope**: One agency, order 10–100 members, order 100 projects, order 10^5–10^6
time entries over years. 12 internal routes plus the portal, ~14 tables, ~30 server
actions.

## Constitution Check

*GATE: passed before Phase 0 research; re-checked after Phase 1 design.*

| Principle | How this design satisfies it | Verdict |
|---|---|---|
| I. One source of truth for hours | `time_entries` is the only hours store. No `billable` column (read from the project), no amount while unbilled (computed from the role rate), no project budget column (summed from roles), no project status column (newest health update), no stored weekly capacity (summed from the working pattern). The two stored money values are frozen billing facts with documented invalidation. | PASS |
| II. Honest capacity math | `workingMinutesOn` is the single gate for contract dates, working pattern, holiday calendar, and leave; availability, locking, booking effectiveness, and the utilization denominator all call it. | PASS |
| III. Least privilege, logger isolation | `requirePermission` in one module, invoked in every action and page after validation. Portal sessions resolve only to their own member id; middleware does presence checks only and never substitutes for a real check. | PASS |
| IV. Storage-portable data layer | Portable PostgreSQL types only; driver chosen in `lib/db/client.ts` alone; identical migration files for both targets; no SQL outside `lib/db/queries/*`. | PASS |
| V. Tested calculation core | `lib/domain/*` is pure, I/O-free, and unit tested — including a fires/stays-quiet pair per guardrail and explicit contract-edge, holiday, partial-week, and overlapping-leave cases — before the panels that display it. | PASS |
| VI. Server-first and fast | Server components query and render; server actions mutate and revalidate; client components own input state only. Report and billing aggregation is SQL driven by URL params, so no dataset is shipped to the browser. | PASS |
| VII. Guardrails warn, integrity rules block | The `ActionResult` shape carries `warnings` on success and a coded, record-naming `error` on refusal; the warn/block split in contracts/server-actions.md matches the constitution's list exactly. | PASS |

No violations. Complexity Tracking is therefore empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-agency-operations-platform/
├── plan.md              # This file
├── spec.md              # What and why — 8 prioritized stories, FR-001..FR-050
├── research.md          # Phase 0 — 12 decisions, spike-verified
├── data-model.md        # Phase 1 — 14 tables, normative derived calculations
├── contracts/
│   ├── server-actions.md
│   └── http-routes.md
├── quickstart.md        # Phase 1 — run it locally
└── tasks.md             # Phase 2 — generated by /speckit-tasks
```

### Source Code (repository root)

```text
app/
├── layout.tsx                        # shell, fonts, theme
├── globals.css                       # Tailwind 4 + design tokens
├── unlock/page.tsx                   # workspace password + acting member
├── (workspace)/
│   ├── layout.tsx                    # nav, session guard, acting-member switcher
│   ├── page.tsx                      # Home — weekly snapshot
│   ├── timesheet/page.tsx
│   ├── planner/page.tsx
│   ├── projects/page.tsx
│   ├── projects/[projectId]/page.tsx
│   ├── members/page.tsx
│   ├── members/[memberId]/page.tsx
│   ├── billing/page.tsx
│   ├── reports/page.tsx
│   ├── status/page.tsx
│   └── settings/page.tsx
├── portal/[token]/page.tsx           # PIN gate + own week only
└── api/
    ├── export/billing/route.ts
    ├── export/report/route.ts
    └── health/route.ts

lib/
├── db/
│   ├── client.ts                     # THE only driver construction + migrate + seed
│   ├── schema.ts                     # Drizzle tables and enums
│   ├── seed.ts                       # idempotent demo agency
│   └── queries/                      # every SQL read, one module per panel
│       ├── members.ts  projects.ts  timesheet.ts  planner.ts
│       ├── billing.ts  reports.ts   health.ts     home.ts
├── domain/                           # PURE — no imports from lib/db
│   ├── dates.ts                      # YYYY-MM-DD arithmetic, weeks, periods
│   ├── money.ts                      # cents, amountCents, formatting
│   ├── capacity.ts                   # workingMinutesOn, availableMinutes
│   ├── utilization.ts
│   ├── budget.ts                     # delivered / committed / remaining
│   ├── billing.ts                    # the logged = invoiced + unbilled split
│   └── guardrails.ts                 # thresholds and their messages
├── auth/
│   ├── session.ts                    # signed cookies, workspace + portal sessions
│   ├── permissions.ts                # THE role matrix
│   └── secrets.ts                    # scrypt hash/verify, token generation
├── actions/                          # one module per area, all Zod-validated
└── validation/                       # shared Zod schemas

components/
├── ui/                               # shadcn/ui, vendored
├── grid/                             # timesheet week grid (client island)
├── planner/                          # timeline, density cells, booking dialog
└── ...                               # panel-specific server components

drizzle/                              # generated migration SQL + meta
tests/unit/                           # Vitest over lib/domain
.data/pg                              # PGlite data directory (gitignored)
```

**Structure Decision**: A single Next.js application at the repository root, with the
spec-kit directories (`.specify/`, `specs/`) alongside it. There is no separate backend
project: server components and server actions are the server tier, and introducing an
API layer between them and the database would add a boundary with no consumer. The one
architectural rule that matters is the dependency direction — `app/` and `lib/actions/`
depend on `lib/db/queries/` and `lib/domain/`; `lib/domain/` depends on nothing. That
keeps the calculation core testable in isolation and keeps SQL out of the UI.

## Phasing

Each phase ends in a state a person can operate, per the constitution's slice rule.

- **Phase A — Foundation**: scaffold, schema, migrations, domain layer with tests, auth,
  seed. Exit: `/api/health` reports migrated tables and the domain suite is green.
- **Phase B — Core loop (US1, US2, US3)**: Members, Clients/Projects/Roles, internal
  Timesheet, Personal Portal, Home. Exit: an agency can be modelled and a week logged
  through both the internal grid and a private link, with guardrails firing.
- **Phase C — Plan and bill (US4, US5)**: Resource Planner with budget-aware bookings,
  Billing with invoice marking and export. Exit: a month can be planned and invoiced.
- **Phase D — See and configure (US6, US7, US8)**: Reports with saved views, Project
  Status board, Settings. Exit: the full PRD panel set.

## Complexity Tracking

No constitution violations. Table intentionally empty.
