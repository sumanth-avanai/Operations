# Feature Specification: Agency Operations Platform

**Feature Branch**: `001-agency-operations-platform`

**Created**: 2026-09-01

**Status**: Draft

**Input**: PRD "Agency Operations Platform — Time · People · Budgets · Billing — one workspace" v1.0

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Model the agency: clients, projects, roles, budgets and people (Priority: P1)

An operations lead sets up the workspace to mirror how the agency actually works. They
add clients and the projects under them, mark which projects are billable, and define
the roles on each project with an hourly rate, a budgeted amount, and the people
assigned to that role. They add every team member with their weekly capacity, which
days of the week they work, their contract start and end dates, and a utilization
target. Each member is attached to a public-holiday calendar.

**Why this priority**: Nothing else in the product has meaning until the work and the
team exist. Every hour logged, every booking made, and every euro billed resolves
through a project role and a member. This story alone already replaces the
"who-works-where and what-does-it-cost" spreadsheet.

**Independent Test**: Create a client, a project with two roles at different rates and
budgets, and three members with different working patterns including one part-timer and
one whose contract ends mid-quarter. The workspace then reports correct available hours
per person per week without a single hour being logged.

**Acceptance Scenarios**:

1. **Given** an empty workspace, **When** the lead creates a client and a billable
   project under it, **Then** the project appears in the project hub with its client,
   colour, billable flag, and a budget of zero until roles are added.
2. **Given** a project, **When** the lead adds a role with an hourly rate and a
   budgeted amount and assigns two members to it, **Then** the project's total budget
   equals the sum of its role budgets and both members can be selected for that role
   on a timesheet.
3. **Given** a member who works Monday to Thursday at 8 hours and not Friday, **When**
   their weekly capacity is displayed, **Then** it reads 32 hours and Friday is shown
   as a non-working day.
4. **Given** a member whose contract ends on the 15th, **When** availability is
   computed for that month, **Then** days after the 15th contribute zero available
   hours.
5. **Given** a member attached to a holiday calendar containing a public holiday,
   **When** availability for that week is computed, **Then** the holiday contributes
   zero available hours and is labelled with the holiday name.

---

### User Story 2 - A consultant logs their week from a private link (Priority: P1)

A consultant opens a private link, enters a PIN, and sees a grid with only their own
assigned projects and roles down the side and the days of the week across the top. A
planned column shows what was booked for them. They type hours, add a short note, and
save. Days that fall on a public holiday or approved leave are locked. If their day
total exceeds their daily capacity, a warning appears but the save still succeeds.

**Why this priority**: This is the highest-volume interaction in the product and the
one with the least tolerance for friction. If loggers do not keep up, every other
number is wrong. It requires no account, no install, and no training.

**Independent Test**: Open a seeded member's portal link with the correct PIN, log
hours across two projects for a week, save, reopen the link, and confirm the values
persisted and that the logger cannot see or reach any other member's data.

**Acceptance Scenarios**:

1. **Given** a valid private link and correct PIN, **When** the logger opens the
   portal, **Then** they see only their own week and only the projects and roles they
   are assigned to.
2. **Given** a wrong PIN, **When** it is submitted, **Then** access is refused with no
   information about the member disclosed, and repeated failures are throttled.
3. **Given** a week with a public holiday on Wednesday, **When** the portal renders,
   **Then** Wednesday is locked, labelled with the holiday name, and rejects entry.
4. **Given** a daily capacity of 8 hours, **When** the logger enters 10 hours on one
   day, **Then** a capacity warning is shown for that day and the save still succeeds.
5. **Given** a logger whose contract started on the 10th, **When** they view the week
   containing the 8th, **Then** days before the 10th are locked and cannot be logged.
6. **Given** hours already marked invoiced, **When** the logger attempts to change
   them, **Then** the change is refused and the reason names the invoice reference.
7. **Given** a booking of 6 hours per day on a project, **When** the portal renders,
   **Then** the planned column shows 6 for those days alongside the logger's entry.

---

### User Story 3 - The internal timesheet and the weekly snapshot (Priority: P1)

An operations lead picks any person and fills in or corrects their week in the same
grid, with the same guardrails. The Home dashboard gives the weekly snapshot: total
and billable hours, and how each person is tracking against their capacity for the
week, with shortcuts to add a client, project, or member.

**Why this priority**: Loggers will always miss a week. Without an internal path to
correct data, the single source of truth degrades, and leadership loses the glance-level
view that makes them trust the numbers.

**Independent Test**: From the internal timesheet, select a member who has logged
nothing, fill in their week, save, then confirm the Home snapshot's totals and that
member's capacity bar both move to match.

**Acceptance Scenarios**:

1. **Given** the internal timesheet, **When** a person and a week are selected,
   **Then** their existing entries load into the grid and can be edited and saved.
2. **Given** hours logged for a week, **When** Home is opened for that week, **Then**
   total hours, billable hours, and per-person capacity tracking reflect those hours.
3. **Given** a person whose logged hours are below their available hours for the week,
   **When** Home renders, **Then** they are shown as under capacity with the shortfall
   visible.
4. **Given** the internal timesheet, **When** a project the person is not assigned to
   is selected, **Then** it is not offered, and a forced attempt is refused server-side.

---

### User Story 4 - Plan people on a timeline with budget-aware bookings (Priority: P2)

A resource manager sees every person on a timeline by week, month, quarter, or year,
with how heavily each day is booked, tentative work distinguished from confirmed, and
time off and holidays shown inline. Creating a booking checks the role's remaining
budget on the spot and warns if the booking would exceed it. Bookings can be pencilled
in as tentative while a deal is unconfirmed.

**Why this priority**: This is where over-booking and over-commitment are prevented,
but it depends on projects, roles, budgets, and member capacity already existing.

**Independent Test**: Open the planner on the seeded workspace, find a person with
free days, book them onto a project role, and confirm the timeline density, the
person's remaining availability, and the role's remaining budget all update. Then
attempt a booking that exceeds the role budget and confirm the warning appears.

**Acceptance Scenarios**:

1. **Given** the planner at week granularity, **When** it renders, **Then** each
   person shows per-day booked hours, colour-coded by how close they are to capacity,
   with leave and holidays shown inline as non-bookable.
2. **Given** a role with 10 hours of budget remaining, **When** a booking of 40 hours
   is created against it, **Then** an over-commitment warning states the overage and
   the booking is still saved.
3. **Given** a tentative booking, **When** the planner renders, **Then** it is visually
   distinct from confirmed work and is excluded from committed-budget figures while
   still counting toward the person's provisional load.
4. **Given** a booking whose end date has passed with fewer hours logged than booked,
   **When** the planner or Home renders, **Then** the shortfall is flagged as slipped
   work.
5. **Given** a booking on a date the person is on leave or a public holiday, **When**
   it is saved, **Then** those days contribute zero booked hours.
6. **Given** a new booking for a member, **When** it is saved, **Then** a notification
   is recorded for that member.

---

### User Story 5 - Turn delivered work into invoices (Priority: P2)

A finance specialist picks a period and sees, per project, per role, and per person,
what has been logged, what has already been invoiced, and what is still unbilled, with
headline figures on top. They select unbilled work, mark it invoiced with an invoice
reference and date, and export the figures to a spreadsheet.

**Why this priority**: This is where the product turns into cash, and it is only
trustworthy once time entries and rates are reliable.

**Independent Test**: On the seeded workspace, open Billing for last month, confirm the
logged / invoiced / unbilled figures add up, mark one project's unbilled work invoiced
with a reference, and confirm it moves from unbilled to invoiced and appears in the
export.

**Acceptance Scenarios**:

1. **Given** a period, **When** Billing renders, **Then** logged equals invoiced plus
   unbilled for every project, role, and person shown, and non-billable work is
   excluded from all three.
2. **Given** unbilled work on a project, **When** it is marked invoiced with a
   reference and date, **Then** those entries are linked to that invoice, move to
   invoiced, and become locked against edits.
3. **Given** work already invoiced, **When** it is selected for invoicing again,
   **Then** the action is refused and the existing invoice reference is named.
4. **Given** any billing view, **When** export is requested, **Then** a spreadsheet is
   produced whose totals match the figures on screen.
5. **Given** a role whose rate is corrected after work was logged but before it was
   invoiced, **When** Billing is reopened, **Then** the unbilled amount reflects the
   new rate.

---

### User Story 6 - Understand utilization and capacity (Priority: P3)

A founder opens Reports, picks a ready-made date range, and sees billable utilization
per person against their target with clear colour coding. They filter by project or
client, pivot the data, save the view they use every month, and export it.

**Why this priority**: High value for leadership but strictly derived from data the
earlier stories produce.

**Independent Test**: Open Reports for the last quarter on the seeded workspace,
confirm each person's utilization equals their billable hours over their available
hours for that range, save the view, reload, and reopen it from the saved list.

**Acceptance Scenarios**:

1. **Given** a date range, **When** the utilization report renders, **Then** each
   person's billable utilization equals billable logged hours divided by available
   hours for that range, with holidays, leave, part-time patterns, and contract dates
   already removed from the denominator.
2. **Given** a member with a utilization target, **When** the report renders, **Then**
   they are colour-coded against that target with the variance shown.
3. **Given** a filter by client or project, **When** applied, **Then** the numerator
   narrows to matching work while the availability denominator stays whole, and the
   report says so.
4. **Given** a configured report view, **When** it is saved and later reopened,
   **Then** the range, filters, and grouping are restored exactly.
5. **Given** any report, **When** export is requested, **Then** the spreadsheet matches
   what is on screen.

---

### User Story 7 - See the health of every project (Priority: P3)

A project manager records a status (on track, at risk, on hold, done), a risk level, a
client-satisfaction reading, and a short comment. The portfolio board shows every
project with its current health and how much of its budget is used, and each project
keeps the full history of past updates for status meetings.

**Why this priority**: Valuable for meetings and early warnings, but it is qualitative
data entry that does not block any other capability.

**Independent Test**: Log a health update on a seeded project, confirm the board shows
the new status and risk, then log a second update and confirm both appear in history
with the newest as current.

**Acceptance Scenarios**:

1. **Given** a project, **When** a health update is recorded, **Then** it becomes the
   project's current status and risk, and the previous update is retained in history.
2. **Given** the portfolio board, **When** it renders, **Then** every project shows
   current status, risk, satisfaction, and percentage of budget consumed.
3. **Given** a project whose consumed budget exceeds its total budget, **When** the
   board renders, **Then** it is flagged as over budget regardless of its status.
4. **Given** a project with several updates, **When** its history is opened, **Then**
   updates are listed newest first with author and date.

---

### User Story 8 - Configure the workspace for the real world (Priority: P3)

An admin manages public-holiday calendars for the regions the agency operates in,
records leave for members by type, sets default rates and billing methods, and picks
the currency and date format. They manage each member's private portal link and can
reset a PIN or revoke access.

**Why this priority**: Needed for honest numbers across regions, but the seeded
defaults carry a single-region agency until it is configured.

**Independent Test**: Create a second holiday calendar with different dates, move a
member onto it, and confirm their availability and utilization change accordingly.

**Acceptance Scenarios**:

1. **Given** two holiday calendars with different dates, **When** members on each are
   compared for the same week, **Then** their available hours differ accordingly.
2. **Given** a leave record of a given type over a date range, **When** availability is
   computed, **Then** those days contribute zero available hours and the type is
   visible in the planner and timesheet.
3. **Given** a member, **When** their PIN is reset, **Then** the previous PIN stops
   working immediately; **When** their access is revoked, **Then** their link stops
   working while their logged history is preserved.
4. **Given** a change to currency or date format, **When** any money or date is
   displayed, **Then** it uses the configured format throughout.
5. **Given** a default rate and billing method, **When** a new project role is created,
   **Then** those defaults pre-fill and remain editable.

---

### Edge Cases

- A day is logged, then a public holiday is later added on that date: existing hours
  are preserved and surfaced as a conflict rather than silently deleted.
- Leave is approved over days already booked: booked hours for those days drop to
  zero and the affected bookings are flagged for the resource manager.
- A member's contract end date is moved earlier than existing logged time: the history
  stays intact, and availability after the new end date becomes zero.
- A project role's rate changes after some work was invoiced: invoiced amounts are
  frozen at the invoiced value; only unbilled work re-prices.
- A member is unassigned from a role they already logged time against: history remains
  and remains billable; no new entries can be added.
- A member is archived: they disappear from planning and new timesheets, their history
  and invoiced work remain, and their portal link stops working.
- A project is marked non-billable after billable hours were logged: already-invoiced
  work is untouched; unbilled hours drop out of billable figures and the change is
  surfaced.
- The same person is assigned to two roles on one project: hours must be attributed to
  exactly one role, and the grid presents them as separate rows.
- A week spans a month or year boundary: the timesheet still renders one contiguous
  week and period reports attribute each day to its own period.
- Two people edit the same person's week concurrently: the later save is rejected with
  a conflict rather than overwriting.
- A portal link is shared with someone else: the PIN still gates access, and revoking
  the link invalidates it everywhere.

## Requirements *(mandatory)*

### Functional Requirements

**Workspace, access, and identity**

- **FR-001**: System MUST gate the internal workspace behind a shared workspace
  password and maintain the session in a server-verified, HTTP-only cookie.
- **FR-002**: System MUST let an authenticated internal user act as a specific member,
  and MUST enforce that member's role permissions on every subsequent read and write.
- **FR-003**: System MUST provide each member a unique, unguessable private portal link
  plus a PIN, requiring no account and no installation.
- **FR-004**: System MUST scope every portal request to the linked member's own data
  only, and MUST reject any portal request that references another member.
- **FR-005**: System MUST throttle repeated failed PIN attempts and MUST NOT disclose
  member details before successful authentication.
- **FR-006**: System MUST allow an admin to reset a member's PIN and revoke a member's
  portal access, taking effect immediately.
- **FR-007**: System MUST enforce the role matrix server-side: Owner/Admin full access
  including settings; Operations Lead full workspace except workspace security;
  Resource Manager planning and projects but not invoicing or billing configuration;
  Project Manager only their own projects plus related billing; Finance/Billing billing
  and reports plus marking invoiced, but no scope or staffing changes; Logger only
  their own timesheet.

**People and capacity**

- **FR-008**: System MUST store per-member weekly capacity, per-weekday working hours,
  contract start and optional end date, an optional utilization target, and an assigned
  holiday calendar.
- **FR-009**: System MUST compute available hours for any member and date range as the
  sum of their per-weekday hours, excluding days outside contract dates, days on their
  holiday calendar, and days covered by approved leave.
- **FR-010**: System MUST support leave types of vacation, sick, unpaid, and other, all
  of which reduce available hours.
- **FR-011**: System MUST support multiple named holiday calendars with dated entries,
  and MUST allow each member to be assigned to exactly one.
- **FR-012**: System MUST allow archiving a member without deleting their history, and
  MUST exclude archived members from planning, new time entry, and capacity totals.

**Clients, projects, roles, and budgets**

- **FR-013**: System MUST support clients, and projects belonging to a client, each
  project carrying a name, colour, billable flag, status, optional start and end dates,
  and a billing method.
- **FR-014**: System MUST support roles on a project, each with a name, an hourly rate,
  a budgeted amount, and zero or more assigned members.
- **FR-015**: System MUST derive a project's total budget as the sum of its role
  budgets, and MUST NOT allow a separately stored project budget to diverge from it.
- **FR-016**: System MUST compute, per role, budget delivered from logged hours at the
  role rate, budget planned from confirmed bookings at the role rate, and budget
  remaining as budget minus delivered minus planned.
- **FR-017**: System MUST allow archiving a project and MUST retain its logged and
  invoiced history.

**Time tracking**

- **FR-018**: System MUST record time entries as hours against one member, one project,
  one project role, and one calendar date, with an optional note.
- **FR-019**: System MUST present a week grid with projects and roles as rows and the
  days of the week as columns, saving a whole week in one action.
- **FR-020**: System MUST refuse time on a non-working day, a holiday, an approved
  leave day, a date outside the member's contract dates, or a project role the member
  is not assigned to, and MUST name the offending date or record in the refusal.
- **FR-021**: System MUST warn, without blocking, when a member's total logged hours
  for a day exceed their working hours for that day.
- **FR-022**: System MUST refuse any modification to time entries already linked to an
  invoice, and MUST name the invoice reference.
- **FR-023**: System MUST show a planned column derived from bookings alongside logged
  hours for the same member, project, role, and day.
- **FR-024**: System MUST detect concurrent edits to the same member-week and reject
  the stale save rather than overwriting.

**Planning**

- **FR-025**: System MUST record bookings of hours per day for a member on a project
  role over a date range, each either tentative or confirmed.
- **FR-026**: System MUST render a planner showing every active member across a
  timeline at week, month, quarter, and year granularity, with per-day booked hours
  colour-coded against that day's available hours, and leave and holidays inline.
- **FR-027**: System MUST warn, without blocking, when a new or edited booking would
  push a role's committed spend beyond its remaining budget, stating the overage.
- **FR-028**: System MUST exclude tentative bookings from committed budget figures
  while including them in a member's provisional load.
- **FR-029**: System MUST contribute zero booked hours for booking days that fall on
  leave, holidays, non-working days, or outside contract dates.
- **FR-030**: System MUST flag a booking whose end date has passed and whose logged
  hours fall short of its booked hours as slipped work.
- **FR-031**: System MUST record a notification for a member when they are booked onto
  new work, and when they are first onboarded with their portal link.

**Billing**

- **FR-032**: System MUST classify every billable time entry for a period as invoiced
  when linked to an invoice and unbilled otherwise, such that logged always equals
  invoiced plus unbilled.
- **FR-033**: System MUST exclude non-billable projects from all billing figures.
- **FR-034**: System MUST price a time entry as hours multiplied by its project role's
  current rate while unbilled, and MUST freeze the amount at the time of invoicing.
- **FR-035**: System MUST present billing figures for a period broken down by project,
  by role, and by person, with headline totals.
- **FR-036**: System MUST allow marking a selection of unbilled work as invoiced with
  an invoice reference and date, in a single action.
- **FR-037**: System MUST refuse to invoice work that is already invoiced and MUST name
  the existing reference.
- **FR-038**: System MUST export billing figures to a spreadsheet whose totals match
  the on-screen figures.

**Reporting and health**

- **FR-039**: System MUST report billable utilization per member for any date range as
  billable logged hours divided by available hours for the same range.
- **FR-040**: System MUST colour-code utilization against each member's target and show
  the variance.
- **FR-041**: System MUST support ready-made date ranges (this and last week, month,
  quarter, year) plus a custom range.
- **FR-042**: System MUST support filtering reports by client, project, and member, and
  grouping by member, project, or client, keeping the availability denominator whole
  when a numerator filter narrows the work.
- **FR-043**: System MUST allow saving a report configuration by name and restoring it
  exactly.
- **FR-044**: System MUST export any report to a spreadsheet.
- **FR-045**: System MUST record project health updates carrying status, risk level,
  client-satisfaction reading, comment, author, and date, retaining all updates as
  history with the newest as current.
- **FR-046**: System MUST show a portfolio board of all projects with current health
  and percentage of budget consumed, flagging over-budget projects.

**Configuration and data**

- **FR-047**: System MUST provide workspace settings for currency, date format, week
  start day, default hourly rate, and default billing method, applied throughout.
- **FR-048**: System MUST provide a dashboard showing, for a chosen week, total and
  billable hours and each member's hours against their available hours, with shortcuts
  to create a client, project, or member.
- **FR-049**: System MUST keep all derived figures consistent immediately after any
  write, with no reconciliation step.
- **FR-050**: System MUST ship with demo data covering part-time schedules, contract
  edges, leave, holidays, tentative and confirmed bookings, slipped work, and
  already-invoiced work.

### Key Entities *(include if feature involves data)*

- **Workspace Settings**: The single configuration record — currency, date format, week
  start, default rate, default billing method, workspace access secret.
- **Member**: A person in the agency. Weekly capacity, per-weekday working hours,
  contract start and end, utilization target, role, assigned holiday calendar, portal
  token and PIN, archived flag.
- **Holiday Calendar** and **Holiday**: A named regional calendar and its dated,
  named non-working days.
- **Leave**: A member's absence over a date range with a type (vacation, sick, unpaid,
  other) that removes availability.
- **Client**: An organization the agency works for. Name, colour, contact.
- **Project**: A body of work for a client. Billable flag, status, colour, dates,
  billing method. Its budget is the sum of its roles' budgets.
- **Project Role**: A named role on a project with an hourly rate and a budgeted
  amount — the unit budgets are tracked against and the source of every rate.
- **Role Assignment**: The link making a member eligible to log time and be booked on
  a project role.
- **Time Entry**: Hours by one member on one project role on one date, with a note and
  an optional link to an invoice. The single source of truth for delivered work.
- **Booking**: Planned hours per day for a member on a project role over a date range,
  tentative or confirmed. The source of planned work and the planned column.
- **Invoice**: A reference, date, and period grouping the time entries it billed, with
  the amount frozen at invoicing.
- **Project Health Update**: A dated status, risk level, satisfaction reading, and
  comment on a project, kept as history.
- **Saved View**: A named report configuration — range, filters, grouping.
- **Notification**: A recorded message for a member about a booking or onboarding.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A logger can open their private link and save a complete week in under
  two minutes, entering hours for up to five project rows across seven days.
- **SC-002**: For any period, project, role, and person, logged hours equal invoiced
  plus unbilled hours exactly, with zero reconciliation steps.
- **SC-003**: Every capacity and utilization figure in the product accounts for
  part-time patterns, contract dates, holidays, and leave — verified by a test suite
  covering each boundary.
- **SC-004**: A resource manager learns whether a role still has budget before
  confirming a booking, without leaving the planner.
- **SC-005**: Over-capacity, over-commitment, and slipped work are surfaced at the
  moment they occur, not discovered at month end.
- **SC-006**: A finance specialist can go from opening Billing to a completed invoice
  marking with a reference in under five interactions.
- **SC-007**: A logger can reach no data other than their own — enforced server-side
  and covered by tests that attempt cross-member access.
- **SC-008**: An admin can model a new agency — clients, projects with roles and
  budgets, and members with real schedules — in a single sitting with no external help.
- **SC-009**: Every list, grid, and planner view renders from a bounded number of
  queries per view, independent of row count.
- **SC-010**: Billing and report exports open in a spreadsheet tool with totals
  identical to the screen.

## Assumptions

- A single agency (single tenant) per deployment for this version; no cross-workspace
  data separation is required yet.
- Internal staff share one workspace password and then act as a chosen member; per-user
  credentials are deferred to the hosted phase and the access layer is shaped so they
  can be introduced without touching business logic.
- One currency per workspace. Multi-currency projects are out of scope for this version.
- Leave is recorded by an admin or operations lead; a request-and-approval workflow is
  out of scope, matching the PRD's non-goal on approval chains.
- A time entry belongs to exactly one project role; splitting one entry across roles is
  out of scope.
- Invoices are records of what was billed, not documents. No PDF generation, tax
  handling, or payment tracking beyond the invoice reference and date.
- Spreadsheet export is the integration surface for accounting tools in this version;
  live accounting integrations are out of scope.
- Notifications are recorded and shown in the product; email delivery is deferred.
- The product runs locally on a file-based Postgres-compatible database first, and moves
  to hosted Postgres later without schema changes.
