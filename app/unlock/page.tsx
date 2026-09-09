import { redirect } from 'next/navigation'
import { getSettings, getWorkspaceContext, selectableMembers } from '@/lib/auth/context'
import { UnlockForm } from '@/components/access/unlock-form'
import { MemberPicker } from '@/components/access/member-picker'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Unlock' }

export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const destination = next && next.startsWith('/') ? next : '/'
  const [settings, ctx] = await Promise.all([getSettings(), getWorkspaceContext()])

  if (ctx?.actingMember) redirect(destination)

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-md">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <svg viewBox="0 0 24 24" fill="none" className="size-6" aria-hidden>
              <path d="M4 19V7m0 12h16M8 19v-6m4 6V9m4 10v-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold tracking-tight">{settings.agencyName}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Time · People · Budgets · Billing
          </p>
        </div>

        {ctx ? (
          <MemberPicker members={await selectableMembers()} next={destination} />
        ) : (
          <UnlockForm next={destination} />
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Logging your own time? Open the private link you were sent — no password needed.
        </p>
      </div>
    </main>
  )
}
