'use client'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckIcon, ChevronsUpDownIcon, LockIcon } from 'lucide-react'
import { lockWorkspace, setActingMember } from '@/lib/actions/access'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar } from '@/components/shared/avatar'
import { MEMBER_ROLE_LABELS, type MemberRoleName } from '@/lib/domain/types'

type Option = { id: string; name: string; role: MemberRoleName; color: string }

export function ActingSwitcher({
  current,
  options,
}: {
  current: Option
  options: Option[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const choose = (memberId: string) => {
    if (memberId === current.id) return
    const formData = new FormData()
    formData.set('memberId', memberId)
    startTransition(async () => {
      await setActingMember(null, formData)
      router.refresh()
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={pending}
        className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 outline-none disabled:opacity-60"
      >
        <Avatar name={current.name} color={current.color} size="sm" />
        <span className="hidden min-w-0 sm:block">
          <span className="block truncate text-[13px] font-medium leading-tight">{current.name}</span>
          <span className="block truncate text-[11px] leading-tight text-muted-foreground">
            {MEMBER_ROLE_LABELS[current.role]}
          </span>
        </span>
        <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Acting as</DropdownMenuLabel>
        {options.map((option) => (
          <DropdownMenuItem key={option.id} onSelect={() => choose(option.id)} className="gap-2.5">
            <Avatar name={option.name} color={option.color} size="xs" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px]">{option.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {MEMBER_ROLE_LABELS[option.role]}
              </span>
            </span>
            {option.id === current.id ? <CheckIcon className="size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => startTransition(async () => { await lockWorkspace(); router.push('/unlock') })}
        >
          <LockIcon />
          Lock workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
