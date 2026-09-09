import { getDb } from '@/lib/db/client'
import { getCalendars } from '@/lib/db/queries/settings'
import { guardPage } from '@/lib/auth/context'
import { can } from '@/lib/auth/permissions'
import { makeFormatter } from '@/lib/format'
import { PageHeader } from '@/components/shared/page-header'
import { ForbiddenPanel } from '@/components/shared/forbidden'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { WorkspaceForm } from '@/components/settings/workspace-form'
import { PasswordForm } from '@/components/settings/password-form'
import { CalendarEditor } from '@/components/settings/calendar-editor'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Settings' }

export default async function SettingsPage() {
  const guard = await guardPage('manage_settings', '/settings')
  if (!guard.allowed) {
    return (
      <ForbiddenPanel
        capability={guard.capability}
        memberName={guard.ctx.actingMember.name}
        role={guard.ctx.actingMember.role}
      />
    )
  }

  const { settings, actingMember, today } = guard.ctx
  const fmt = makeFormatter(settings)
  const db = await getDb()
  const calendars = await getCalendars(db, today)
  const canSecure = can(actingMember.role, 'manage_security')

  return (
    <>
      <PageHeader
        title="Settings"
        description="Holiday calendars, defaults and formats. These change how the whole workspace reads."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
            <CardDescription>
              Currency, date format and time zone apply to every figure and date in the product —
              including which day counts as today.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WorkspaceForm
              values={{
                agencyName: settings.agencyName,
                currency: settings.currency,
                dateFormat: settings.dateFormat,
                weekStartDay: settings.weekStartDay,
                timeZone: settings.timeZone,
                defaultRate: (settings.defaultRateCents / 100).toFixed(2),
                defaultBillingMethod: settings.defaultBillingMethod,
                defaultBillable: settings.defaultBillable,
              }}
              todayLabel={fmt.date(today)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Holiday calendars</CardTitle>
            <CardDescription>
              Public holidays remove availability for everyone attached to the calendar, which is
              what keeps capacity and utilization honest across regions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CalendarEditor
              calendars={calendars.map((calendar) => ({
                ...calendar,
                holidays: calendar.holidays.map((holiday) => ({
                  ...holiday,
                  dateLabel: fmt.date(holiday.holidayDate),
                })),
              }))}
            />
          </CardContent>
        </Card>

        {canSecure ? (
          <Card>
            <CardHeader>
              <CardTitle>Workspace password</CardTitle>
              <CardDescription>
                The shared password internal staff type at the unlock screen. Personal portal links
                are unaffected.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PasswordForm />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Workspace password</CardTitle>
              <CardDescription>
                Only an Owner/Admin can change workspace-level security.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Moving to hosted Postgres</CardTitle>
            <CardDescription>
              This workspace runs on file-based PGlite in <code>.data/pg</code>. Set{' '}
              <code>DATABASE_URL</code> to a Postgres connection string (Supabase, Neon, RDS) and the
              same schema and migrations run there instead — no code changes. A deployment needs it,
              because a serverless filesystem cannot host PGlite.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </>
  )
}
