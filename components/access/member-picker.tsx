'use client'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { setActingMember } from '@/lib/actions/access'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MEMBER_ROLE_LABELS, type MemberRoleName } from '@/lib/domain/types'
import { Avatar } from '@/components/shared/avatar'

type Option = { id: string; name: string; role: MemberRoleName; color: string }

export function MemberPicker({ members, next }: { members: Option[]; next: string }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof setActingMember>> | null, formData: FormData) => {
      const result = await setActingMember(prev, formData)
      if (result.ok) router.replace(next)
      return result
    },
    null,
  )

  const error = state && !state.ok ? state.error : null
  // Loggers work from their private link, so they are not identities to act as here.
  const staff = members.filter((m) => m.role !== 'logger')
  const loggers = members.filter((m) => m.role === 'logger')

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who are you working as?</CardTitle>
        <CardDescription>
          Your role decides what you can see and change. Switch at any time from the top bar.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {error ? (
          <p role="alert" className="mb-2 text-[13px] text-destructive">
            {error.message}
          </p>
        ) : null}
        {staff.map((member) => (
          <form key={member.id} action={action}>
            <input type="hidden" name="memberId" value={member.id} />
            <button
              type="submit"
              disabled={pending}
              className="flex w-full items-center gap-3 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
            >
              <Avatar name={member.name} color={member.color} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{member.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {MEMBER_ROLE_LABELS[member.role]}
                </span>
              </span>
            </button>
          </form>
        ))}
        {loggers.length > 0 ? (
          <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
            {loggers.length} team member{loggers.length === 1 ? '' : 's'} log time from their own
            private link and do not sign in here.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
