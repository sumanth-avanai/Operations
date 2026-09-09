# Phase 0 Research: Agency Operations Platform

All decisions below were verified by running the code, not by reading documentation
alone. Findings that came out of the spike are marked **verified**.

## D1. Local database: file-based PGlite behind Drizzle ORM

**Decision**: `@electric-sql/pglite` with a file-backed data directory at
`.data/pg`, accessed exclusively through Drizzle ORM using the `postgresql`
dialect.

**Rationale**: PGlite is real PostgreSQL compiled to WASM, so the SQL, types, and
migrations written now are the same ones hosted Postgres will run. It needs no
service to install or start, which is exactly the "build it locally first" ask.

**Verified in spike**:

- `uuid` primary keys with `gen_random_uuid()` defaults work natively — pgcrypto
  behaviour is built in, no extension statement needed.
- `jsonb`, `date`, and `numeric` columns all round-trip correctly.
- `numeric` values come back as **strings** and `date` values as **`YYYY-MM-DD`
  strings**. This drove decision D5.
- Aggregates, `current_date`, and window-capable SQL all behave as in Postgres.

**Alternatives rejected**:

- *better-sqlite3 / libSQL*: would require rewriting the schema and every query for
  the Supabase move, and lacks the date and numeric semantics the billing math needs.
- *Docker Postgres locally*: correct but adds a daemon the user must run before the
  app works, defeating "build it locally".

## D2. Migrations: generated offline, applied at startup

**Decision**: `drizzle-kit generate` produces SQL migration files from the schema
with **no database connection**; the app applies them with `migrate()` from
`drizzle-orm/pglite/migrator` the first time the database singleton is created.

**Verified in spike**: `drizzle-kit generate` ran fully offline and produced
`drizzle/0000_*.sql` plus `drizzle/meta/`. `migrate()` applied it to a fresh data
directory and, run a second time, was a no-op — it is idempotent and safe on every
boot.

**Rationale**: `drizzle-kit push` and `drizzle-kit studio` need to open the database
themselves, which fights the single-writer constraint in D3. Generating offline and
migrating in-process means only ever one process touches the data directory, and the
same migration files will later run against Supabase unchanged.

## D3. PGlite does not lock its data directory — single-writer is our job

**Verified in spike**: a second Node process opened the same `dataDir` while the
first still held it open, and successfully read committed data. There is no lock and
no error.

**Consequence**: concurrent writers risk corruption, and nothing will stop us.
Mitigations, all mandatory:

1. Exactly one module constructs `PGlite`, cached on `globalThis` so Next.js hot
   reload reuses the same instance instead of opening a second one.
2. That module also runs migrations and idempotent seeding, so **no separate CLI
   process ever opens the database**.
3. `@electric-sql/pglite` is declared in `serverExternalPackages` so the bundler
   cannot produce two copies of the driver in one process.
4. `npm run db:reset` only deletes the data directory; it never opens it. The
   quickstart states plainly that it requires the dev server to be stopped.

## D4. `PGlite` does not create parent directories

**Verified in spike**: `PGlite.create({ dataDir: './.data/pg' })` threw
`ENOENT ... mkdir` because its node filesystem layer calls a non-recursive `mkdir`.

**Consequence**: the database module must `fs.mkdirSync(dataDir, { recursive: true })`
before constructing the client. Cheap, but a hard failure on a clean checkout if
missed.

## D5. Durations as integer minutes, money as integer cents

**Decision**: every duration is an `integer` count of minutes; every monetary value
is an `integer` count of cents. No floats and no `numeric` anywhere in the schema.

**Rationale**: this is a billing product — `0.1 + 0.2` problems are unacceptable, and
D1 showed `numeric` arrives as a string that would need parsing at every call site
anyway. Integer minor units make all domain arithmetic exact integer arithmetic, keep
the ORM types honest (`number`, not `string`), and port to Postgres unchanged. Hours
and currency exist only at the display boundary and in parsing of user input.

**Alternatives rejected**:

- *`numeric(12,2)` for money*: exact in the database but arrives as a string; every
  calculation would parse and re-serialize, and a single missed parse becomes silent
  string concatenation.
- *Floats*: fails the constitution outright.

## D6. Dates are calendar dates, never instants

**Decision**: everything a human picks — a timesheet day, a booking range, a leave
range, a holiday, a contract boundary — is a `date` column handled as a
`YYYY-MM-DD` string end to end. No `Date` objects cross the data layer, and no
timezone conversion is ever applied to them.

**Rationale**: a timesheet day is a day. Converting it to an instant is how "Monday"
becomes "Sunday 23:00" for a user in another timezone and how a week's hours land in
the wrong month at a period boundary. Only genuine event timestamps (`created_at`)
use `timestamptz`.

**Implementation**: a small date utility module operating on `YYYY-MM-DD` strings
(day arithmetic, weekday index, range expansion, week and period boundaries), with
`date-fns` used only for formatting at the view layer.

## D7. Access control: signed cookie session, no auth framework

**Decision**: two independent access paths, both verified server-side on every
request.

- *Internal*: a workspace password checked against a hash in workspace settings,
  then a signed, HTTP-only, `SameSite=Lax` cookie carrying the workspace grant and
  the acting member id. Signed with HMAC-SHA256 from `node:crypto` over a secret in
  the environment.
- *Portal*: an unguessable per-member token in the URL plus a PIN. The PIN is hashed
  with `scrypt` from `node:crypto`; a successful check issues a cookie scoped to that
  member id and token, and failures are throttled per token.

**Rationale**: the PRD explicitly wants a shared password-protected workspace and
account-free logger access — that is not what an auth framework is shaped for.
`node:crypto` needs no dependency and no native build. Session claims resolve to a
member id, which is exactly the input the permission module needs, so replacing this
with Supabase Auth later means changing how a member id is obtained and nothing else.

**Alternatives rejected**:

- *NextAuth / Auth.js*: adapters, providers, and a database schema we do not need for
  a shared password, and it would still not model the token+PIN portal.
- *bcrypt*: native build step on Windows for no benefit over `scrypt` here.

## D8. Server-first rendering; no client data layer

**Decision**: pages are server components that query the data layer directly and
render; mutations are server actions that validate with Zod, enforce permissions, and
revalidate the affected paths. There is no client-side fetching, cache, or store.

**Consequence for grids**: the timesheet week grid and the planner are client
components only for input state (the cells being typed into), submitting the whole
week or booking in one action. Sorting, filtering, grouping, and pivoting in Reports
and Billing are expressed as URL search parameters and executed as SQL, so a report
over a year of data is one aggregate query, not a client-side reduce.

**Alternatives rejected**:

- *TanStack Table*: excellent, but pushes aggregation into the browser and would
  make the report views depend on shipping all rows to the client — directly against
  the constitution's bounded-queries-per-view rule. Server-side aggregation with
  sortable header links is smaller and faster here.
- *React Query / SWR*: nothing to synchronize once mutations revalidate on the server.

## D9. Spreadsheet export via ExcelJS

**Decision**: `exceljs` builds real `.xlsx` workbooks in a route handler, streamed
as a download, from the same query functions that render the on-screen figures.

**Rationale**: reusing the exact query function is what makes "the export matches the
screen" true by construction rather than by discipline. ExcelJS is pure JS with no
native build, and gives real number and currency formatting that CSV cannot.

## D10. Charts: inline SVG and CSS, no charting library

**Decision**: capacity bars, utilization meters, and budget gauges are hand-built
inline SVG and CSS driven by server-computed numbers.

**Rationale**: everything the PRD asks to visualize is a bar against a target or a
density heat cell. A charting library would be the single largest dependency in the
project for shapes that are twenty lines of SVG, and it would fight server rendering.

## D11. Testing: Vitest over the pure domain layer

**Decision**: Vitest unit tests covering `lib/domain/*` — availability, utilization,
budget consumption, the billing split, and every guardrail threshold — plus tests for
the date utilities' boundary behaviour.

**Rationale**: the constitution makes the calculation core non-negotiable and pure, so
it is testable without a database, a browser, or fixtures. Panels are then verified by
exercising real routes against seeded data during the verification phase.

## D12. Path to hosted Postgres and Supabase

The swap is confined to one module. `lib/db/client.ts` chooses its driver from the
environment: absent `DATABASE_URL` it creates PGlite against `.data/pg`; present, it
creates a `node-postgres` pool. Both are handed to `drizzle()` and both export the
same typed `db`. Because the schema uses only portable PostgreSQL types (D1, D5, D6)
and the migration files are dialect-generic (D2), the hosted database runs the same
migrations. Row Level Security and Supabase Auth become available additions at that
point rather than rewrites, because every authorization decision already resolves to
a member id in one module (D7).

## D13. Money is `bigint` cents, and the price exists in exactly two places

**Decision**: every monetary column is `bigint` read as a JS number, every SQL aggregate
over money or minutes is cast to `bigint`, and the price of an hour is defined once in
TypeScript (`amountCents`) and once in SQL (`priceCents()` in `lib/db/sql-money.ts`),
with a test proving the two are the same function.

**Why `bigint` and not `integer`**: `integer` caps a single value at 2,147,483,647 cents
— 21.47M in the workspace currency. A yearly invoiced total for a mid-sized agency
passes that, and a `sum(...)::int` would raise rather than return a wrong number, so the
failure mode is a dead page at exactly the moment finance needs it. `bigint` removes the
ceiling; `Number` is exact to 9.0e15 cents, and the schema bounds a rate at
100,000,000 cents per hour so that `1440 x rate = 1.44e11` and every reachable sum stay
orders of magnitude inside that.

**Why the multiply must cast first** (verified — this was a real defect):
`te.minutes * pr.rate_cents` is `integer * integer`, which is int4 arithmetic in
Postgres and overflows above a rate of roughly 14,913 per hour with a full day logged.
`te.minutes::numeric * pr.rate_cents / 60` is exact and unbounded. A regression test
asserts the old form raises and the new form returns the right number, so the cast
cannot be quietly removed.

**Why the two implementations provably agree**: Postgres `round()` on `numeric` rounds
half away from zero; `Math.round` rounds half up. Those are the same rule for
non-negative values, and both inputs are constrained non-negative in the schema.
`tests/unit/pricing-parity.test.ts` checks the TypeScript side against exact
integer half-up rounding over 246,000 combinations, and
`tests/integration/pricing-sql.test.ts` checks the SQL side against the TypeScript side
over the whole legal input space in a real database, including every exact-half case.

**Rounding convention**: round per entry, then sum — on both sides. An invoice line is a
real amount, so it is rounded once and never re-derived. Summing minutes first and
rounding once would differ by up to half a cent per entry; a test pins the difference so
neither side can be "fixed" independently.

## D14. Scoped reads, not just scoped writes

**Decision**: every query function that can return another manager's engagement takes an
`ownerMemberId`, and the pages and export routes pass it for the one role the PRD scopes
— Project Manager. Credentials never appear in a type that a page could hand to a client
component.

**Why this needed a decision**: authorizing writes is obvious and was done from the
start; authorizing *reads* is where leaks hide, because a leak is silent. The audit found
six read paths that were capability-checked but not row-scoped — Reports and its export,
the Home money figure and its slipped-work callouts, the Planner's bookings, and the
invoice list on Billing — each of which would have shown a Project Manager another
manager's projects or a global finance figure, both of which the PRD forbids.

**How it is enforced going forward**: `tests/integration/isolation.test.ts` runs every
query through the scoped role and asserts the returned rows belong to it, that the
unscoped call really is wider (so the assertion is meaningful), and that no other
manager's project name appears anywhere in the serialized payload. The role matrix is
pinned as data, so widening a role fails the build.

**Credentials**: `pin_hash`, `pin_salt` and `portal_token` are removed from the type the
member queries return (`PublicMember`). The portal token is returned as its own field by
the detail query only, and the page passes it on only for roles with `manage_members`;
everyone else sees a masked placeholder. `/api/health` sits outside the session guard by
design, so it returns `{ ok }` and nothing else to an unauthenticated caller.

## D15. One definition of today, resolved at the edge and passed inward

**Decision**: the workspace owns a `time_zone` setting, and the current calendar day is
resolved from it exactly once per request — in `getWorkspaceContext` and
`getPortalState`, as `ctx.today`. Pages read that field; queries that measure anything
"as of today" take it as a required `asOf` argument. `today()` is never called anywhere
else, and no component derives a date from `new Date()`.

**Why this needed a decision**: D6 keeps timezones out of date *arithmetic*, which is
the harder half, but it leaves one question open — which day is today — and the codebase
had answered it twice. `today()` read the server's local calendar, which on Vercel is
UTC; four dialogs read `new Date().toISOString().slice(0, 10)`, which is the *browser's*
UTC date and is also evaluated once during SSR and again on hydration. For an agency in
UTC+05:30 the two disagreed with the agency's real date until 05:30 every morning, so
the leave editor's minimum date, the invoice-date default, the contract-start default and
the health as-of default could each be a day behind what the Planner called today.

**Why `asOf` is required rather than defaulted**: two figures are *definitionally*
measured from a reference day — slipped work (`bookings.end_date < asOf` with hours
missing) and invoice aging (`agingBucket(diffDays(entry_date, asOf))`). Defaulting the
argument would let a caller silently fall back to the server's zone, and would leave both
date gates untestable. Making it required means the compiler, not diligence, is what
guarantees every caller passes the workspace's day — and
`tests/integration/as-of.test.ts` can then pin it and check the boundaries: a booking
slips on the day *after* it ends and not on the day it ends; the oldest unbilled entry
crosses the 90-day line on exactly the 91st day.

**Robustness**: a zone this runtime cannot resolve falls back to the host calendar rather
than throwing, because a bad settings row must not be able to take down every page.
`isTimeZone` gates the write so one cannot normally get in, and the fallback covers the
case where a zone name is valid on the machine that wrote it and unknown to the one
reading it.

**How it is enforced going forward**: two audit invariants — *the workspace has exactly
one definition of today* (no calendar date derived from `new Date()` outside the date
module) and *today() is never asked without a time zone*. Both were verified to fail when
the defect is reintroduced.

**What is deliberately still today-independent**: committed minutes count every
undelivered day of a booking, past and future, with no date comparison — so a booking
nobody logged against keeps consuming budget until someone acts on it. The slipped-work
list is the only thing that surfaces that, which is the argument for keeping a reference
day at all rather than removing it for simplicity. Pinned by a test.
