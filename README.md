# Agency Operations Platform

Time · People · Budgets · Billing — one workspace.

A single-tenant web application for professional-services organizations: it tracks the
hours people spend, plans who is booked on which engagement, keeps role budgets under
control, and turns delivered work into accurate invoices. The hours a team logs are the
exact hours the agency plans, budgets and bills from, so there is nothing to reconcile.

Built spec-first with [GitHub Spec Kit](https://github.com/github/spec-kit) — the
constitution, specification, plan, design docs and task list live in `.specify/` and
`specs/001-agency-operations-platform/`.

---

## Run it locally

```bash
npm install
cp .env.example .env.local     # then set SESSION_SECRET and WORKSPACE_PASSWORD
npm run dev
```

Open <http://localhost:3000>. There is **no database to install** — the app runs real
PostgreSQL in-process via PGlite and keeps it in `.data/pg`. On first boot it creates
that directory, applies the migrations in `drizzle/`, and seeds a demo agency. That takes
a few seconds; later boots are instant.

### Signing in

| Who | How |
|---|---|
| Internal staff | Go to `/unlock`, enter the workspace password from `.env.local` (`agency` by default), then pick the member you are acting as. Start as **Amara Okafor** (Owner/Admin) to see everything. |
| Time loggers | Open a member's page under `/members`, copy their private link, open it, and enter the PIN. Every seeded member's PIN is `1234`. That link shows only that person's own week. |

Switching the acting member from the top bar changes what you can see and do — the role
matrix is enforced on the server, not just hidden in the UI. Try acting as **Ruben
Castellanos** (Finance) and notice the Planner and Projects editing disappear, or
**Priya Raghavan** (Resource Manager) and notice Billing does.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run typecheck` | TypeScript, strict, no emit |
| `npm test` | 223 tests — the domain layer, pricing parity between SQL and TypeScript, the schema, the seed, every server action, per-role read isolation, and the two figures measured as of today |
| `npm run audit` | Thirteen structural invariants — money is never a float, one price definition, one definition of today, every action authorizes in its own body, no read is exposed as an action |
| `npm run db:generate` | Regenerate migration SQL after editing `lib/db/schema.ts` (offline, no database needed) |
| `npm run db:reset` | Delete `.data/pg` so the next boot migrates and seeds fresh |

---

## The panels

| Panel | What it is for |
|---|---|
| **Home** | The weekly snapshot: hours logged and billable, who has filled in their week, unbilled revenue, and the guardrails that fired. |
| **Timesheet** | Anyone's week as a grid — roles down, days across. Capacity warnings, locked non-working days, a planned column, one save. |
| **Resource Planner** | Everyone on a timeline at week / month / quarter / year, coloured by how full each day is against real availability. Tentative work is hatched. Creating a booking checks the role's remaining budget on the spot. |
| **Projects** | Clients, their projects, and the roles that carry rates, budgets and assignments. Delivered, committed and remaining per role. |
| **Members** | Capacity, working-day pattern, contract dates, utilization target, holiday calendar, leave, and the private portal link. |
| **Billing** | Logged / invoiced / unbilled for any period, by project, role or person. Mark work invoiced with a reference; export to `.xlsx`. |
| **Reports** | Billable utilization against target, with ready-made ranges, filters, groupings, saved views and export. |
| **Project Status** | The portfolio health board: status, risk, client satisfaction and budget consumed, with full history per project. |
| **Settings** | Holiday calendars, currency, date format, week start, default rate and billing method, workspace password. |
| **Personal Portal** | `/portal/<token>` — a private link plus a PIN. One person's own week and nothing else. No account, no install. |

---

## How it is built

- **Next.js 16** App Router, server components throughout. Every mutation is a server
  action that validates with Zod, checks permissions, and revalidates.
- **PGlite + Drizzle ORM** — real PostgreSQL, file-backed. Migrations are generated
  offline and applied in-process at startup.
- **Tailwind 4 + shadcn/ui**, vendored in `components/ui`.
- **Integer minutes and integer cents everywhere.** No floats, no `numeric` columns, so
  the billing arithmetic is exact.
- **Calendar dates as `YYYY-MM-DD` strings**, never timezone-shifted. A timesheet day is
  a day.

### Where things live

```
app/                  routes — (workspace) panels, /portal/[token], /api/export/*
lib/domain/           the calculation core: dates, money, capacity, utilization,
                      budget, billing, guardrails — pure, no I/O, unit tested
lib/db/               schema, the single driver construction point, queries, seed
lib/auth/             sessions, the role matrix, scrypt hashing
lib/actions/          server actions, one module per area
components/           ui primitives, the week grid, the planner, panel components
specs/                the spec-kit artifacts this was built from
tests/                unit tests over lib/domain, integration tests over the real DB
```

The dependency direction is the one rule that matters: `app/` and `lib/actions/` depend
on `lib/db/queries/` and `lib/domain/`; **`lib/domain/` depends on nothing**. That is what
keeps the arithmetic testable in isolation and SQL out of the UI.

## Access model and data isolation

Two questions are asked on every path, in this order: **may this role use this panel?**
and **which rows may they see?** The first is the capability matrix in
`lib/auth/permissions.ts`; the second is a scope passed into the query itself. Capability
without scope is how silent read leaks happen, so both are enforced server-side and
covered by tests.

| Role | Can | Reads narrowed to |
|---|---|---|
| **Owner / Admin** | everything, including workspace security | everything |
| **Operations Lead** | everything except workspace security | everything |
| **Resource Manager** | plan people, manage projects and assignments | everything **except money** — no billing figures at all |
| **Project Manager** | their own engagements, and the billing on them | the engagements they own: projects, billing, reports, status, planner bookings, the invoice list, and Home's money figure and warnings |
| **Finance / Billing** | mark work invoiced, read reports | everything, read-only outside billing |
| **Employee / Consultant** | log their own hours | their own week, through their own link |

A Project Manager still sees **everyone's availability** on the planner and in reports —
who is free is staffing information the planner exists to show — but never another
manager's project names, plans, or revenue. Both panels say so on screen, because a
percentage whose denominator is the whole team and whose numerator is your projects
needs explaining.

Three things are treated as credentials and never travel further than they must:

- **The workspace password** and **member PINs** are `scrypt` hashes; the hash and salt
  are stripped from every member type a page could hand to a client component.
- **A private portal link is itself a credential.** It is shown only to roles that manage
  members; everyone else sees a masked placeholder. Revoking a link or resetting a PIN
  takes effect immediately and keeps all logged history.
- **The portal discloses nothing before the PIN.** An unknown token, a revoked link and
  an archived member's link all render the identical neutral page — no name, no email,
  nothing to enumerate — and repeated wrong PINs cool the link off.

Both front doors are throttled: ten wrong workspace passwords, or five wrong PINs, cool
the entrance off for a few minutes. `/api/health` sits outside the session guard so it can
serve as a readiness probe, and therefore returns `{ ok: true }` and nothing else to an
unauthenticated caller.

One honest limit: role separation is a real, server-enforced data boundary, but it is not
a defence against a malicious insider, because anyone with the shared workspace password
can choose which member to act as. That is the PRD's design for this version, and it is
why every authorization decision resolves to a member id — adding per-user credentials in
the hosted phase changes how that id is obtained and nothing else.

## Exact numbers

This is a billing product, so the arithmetic is the feature:

- **Integer minutes and integer cents.** No floats, no `numeric` columns, no `parseFloat`
  anywhere in the codebase. Money is `bigint` — `integer` caps a single amount at 21.47M
  in the workspace currency, which a real yearly total passes.
- **The price of an hour is defined twice and proved identical.** Once in TypeScript for
  per-row work, once in SQL for aggregates. `npm test` checks the TypeScript version
  against exact integer half-up rounding over ~246,000 combinations, then checks the SQL
  version against it over the whole legal input space in a real database — including
  every case that lands on an exact half cent, which is where two roundings usually
  diverge.
- **Rounded per entry, then summed** — on both sides. An invoice line is a real amount,
  so it is rounded once and never re-derived.
- **`logged = invoiced + unbilled` by construction**, not by calculation: `logged` is
  defined as the sum of the other two, so no arithmetic mistake elsewhere can break the
  identity the product is trusted for.
- **A stored total always equals the rows it summarises.** An invoice's amount is derived
  from the rows its own `UPDATE` linked, inside the transaction, so a concurrent time
  entry cannot end up billed but unaccounted for.

- **The workspace has one definition of today.** Which day is "today" comes from the
  `time_zone` setting, is resolved once per request as `ctx.today`, and is passed inward
  as an explicit `asOf` argument. Nothing reads a clock deeper in: a server in UTC and a
  browser in UTC+05:30 would otherwise disagree with the agency's real date, and the two
  figures that are *defined* as of today — slipped work and invoice aging — would be
  untestable. Set the zone in **Settings → Workspace**; the field shows you which day the
  workspace currently calls today.

`npm run audit` enforces these as greps rather than as good intentions, and fails the
command if any of them stops being true.

One rule worth knowing if you extend this: **every export of a `'use server'` module is
an HTTP endpoint the browser can call with any arguments it likes.** A function that
takes an id and returns rows belongs in `lib/db/queries/`, which the browser cannot
reach. Putting one in `lib/actions/` makes it an open data endpoint — the audit checks
for exactly that.

### Three things worth knowing

1. **Only one process may open `.data/pg` at a time.** PGlite does not lock its data
   directory and will not warn you, so two writers can corrupt it. Stop the dev server
   before `npm run db:reset`, and never run two dev servers against the same checkout.
2. **Migrations run at startup, not from the CLI.** Edit `lib/db/schema.ts`, run
   `npm run db:generate` to produce the SQL, restart the server to apply it.
   `db:generate` never opens the database, so it is safe while the server runs.
3. **The seed only runs on an empty database.** To reshape the demo agency, edit
   `lib/db/seed-data.ts`, stop the server, `npm run db:reset`, and start again.
4. **A component may not build an element for a Radix `asChild` slot unless the file is
   a client component.** An element built in a server component reaches Radix's `Slot`
   through the RSC payload, and once that payload is large enough to be split into
   chunks it arrives as a lazy reference, which `Slot` throws on — a 500 that only
   appears on the larger data sets. The audit checks for it.

---

## Moving to hosted Postgres (Supabase) and Vercel

The swap is confined to one module. Set `DATABASE_URL` and `lib/db/client.ts` uses
`node-postgres` instead of PGlite; the schema and the migration files in `drizzle/` are
unchanged, because the schema uses only portable PostgreSQL types.

```bash
DATABASE_URL=postgresql://user:password@host:5432/postgres npm run build && npm start
```

`DATABASE_URL` is **mandatory for any deployment** — a serverless filesystem is
ephemeral, so PGlite cannot be used on Vercel. Set it, plus `SESSION_SECRET`, in the
Vercel project's environment variables.

Two things become available rather than necessary at that point: Supabase Auth (every
authorization decision already resolves to a member id in `lib/auth/`, so per-user
accounts replace the shared password without touching business logic) and Row Level
Security.

---

## What is deliberately not here

Matching the PRD's non-goals: no general-ledger accounting (it exports to spreadsheets
instead), no multi-level approval workflows, no CRM or sales pipeline, no payroll, and no
document management. Invoices are records of what was billed — a reference, a date and a
frozen amount — not generated documents, and there is no tax handling or payment
tracking. Notifications are recorded in the product; email delivery is not wired up.
