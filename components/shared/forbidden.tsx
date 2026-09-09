import { ShieldOffIcon } from 'lucide-react'
import { CAPABILITY_LABELS, type Capability } from '@/lib/auth/permissions'
import { MEMBER_ROLE_LABELS, type MemberRoleName } from '@/lib/domain/types'

/**
 * A panel the acting role may not open says so plainly and names what is missing. It
 * does not 404, and it does not render a shell around data it is not allowed to hold.
 */
export function ForbiddenPanel({
  capability,
  memberName,
  role,
}: {
  capability: Capability
  memberName: string
  role: MemberRoleName
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border bg-card px-6 py-16 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ShieldOffIcon className="size-5" />
      </span>
      <div>
        <p className="text-sm font-semibold">This panel is not part of your role</p>
        <p className="mt-1 max-w-md text-[13px] text-muted-foreground">
          {memberName} is acting as <strong>{MEMBER_ROLE_LABELS[role]}</strong>, which cannot{' '}
          {CAPABILITY_LABELS[capability]}. Switch to a member whose role includes it, or ask an
          Owner to widen your access.
        </p>
      </div>
    </div>
  )
}
