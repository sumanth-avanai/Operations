'use client'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { LogOutIcon } from 'lucide-react'
import { leavePortal } from '@/lib/actions/access'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/shared/avatar'

export function PortalHeader({
  agencyName,
  memberName,
  memberColor,
  token,
}: {
  agencyName: string
  memberName: string
  memberColor: string
  token: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <header className="flex h-14 items-center gap-3 border-b bg-card px-4 sm:px-6">
      <span className="text-[13px] font-semibold">{agencyName}</span>
      <span className="ml-auto flex items-center gap-2">
        <Avatar name={memberName} color={memberColor} size="sm" />
        <span className="hidden text-[13px] font-medium sm:block">{memberName}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Sign out of this link"
          disabled={pending}
          onClick={() => startTransition(async () => { await leavePortal(token); router.refresh() })}
        >
          <LogOutIcon />
        </Button>
      </span>
    </header>
  )
}
