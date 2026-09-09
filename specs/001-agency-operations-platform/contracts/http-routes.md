# Contract: HTTP Routes

Pages are server components; the only non-page HTTP surface is export and health.

## Pages (internal workspace — workspace cookie required)

| Route | Panel | Notes |
|---|---|---|
| `/unlock` | Workspace password + acting-member choice | the only route reachable without a session |
| `/` | Home | `?week=YYYY-MM-DD` |
| `/timesheet` | Timesheet | `?member=<uuid>&week=YYYY-MM-DD` |
| `/planner` | Resource Planner | `?scale=week\|month\|quarter\|year&from=YYYY-MM-DD` |
| `/projects` | Projects & clients hub | `?client=<uuid>&archived=0\|1` |
| `/projects/[projectId]` | Project detail: roles, rates, budgets, assignments, health | |
| `/members` | Members | `?archived=0\|1` |
| `/members/[memberId]` | Member detail: capacity, contract, leave, portal link | |
| `/billing` | Billing | `?from&to&groupBy=project\|role\|member&project=&client=` |
| `/reports` | Reports | `?from&to&groupBy=member\|project\|client&client=&project=&member=&view=<uuid>` |
| `/status` | Project Status board | `?risk=&status=` |
| `/settings` | Settings | holiday calendars, defaults, currency, password |

Unauthenticated access to any of these redirects to `/unlock?next=<path>`.
A route the acting member's role does not permit renders a forbidden panel naming the
capability required — it never 404s and never silently hides data it holds.

## Pages (personal portal — no account)

| Route | Notes |
|---|---|
| `/portal/[token]` | PIN prompt, then the member's own week only. `?week=YYYY-MM-DD` |

- An unknown, revoked, or archived-member token renders the same generic "this link is
  not active" page — no disclosure (FR-005).
- The portal never links to, and its session never authorizes, any workspace route.
- The rendered week contains only the member's own entries, only their assigned
  project roles, with a planned column from their own bookings.

## API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/export/billing` | GET | `.xlsx` of the billing view for the given query params |
| `/api/export/report` | GET | `.xlsx` of the report view for the given query params |
| `/api/health` | GET | `{ ok, migratedAt, tableCount }` — used by the verification pass |

Export routes:

- Accept **exactly the same query parameters as their page**, and call the **same query
  function** the page calls. This is what makes "the export matches the screen" true by
  construction (SC-010) rather than by discipline.
- Require the same capability as the page (`manage_billing` / `view_reports`).
- Respond `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  with `Content-Disposition: attachment` and a dated filename.
- Format money with the workspace currency and dates with the workspace date format.

## Middleware

A single middleware guards route groups by cookie presence only — cheap presence
checks, no database access. Every real authorization decision happens in the page or
action against the database (constitution III).
