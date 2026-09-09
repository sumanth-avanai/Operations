'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { UsersIcon } from 'lucide-react'
import { setRoleAssignments } from '@/lib/actions/projects'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Avatar } from '@/components/shared/avatar'

/**
 * Who may log time against this role and be booked on it. Removing somebody who has
 * already logged time keeps their history and only stops new entries.
 */
export function AssignmentEditor({
  projectRoleId,
  roleName,
  assigned,
  members,
  canManage,
}: {
  projectRoleId: string
  roleName: string
  assigned: { id: string; name: string; color: string }[]
  members: { id: string; name: string; color: string }[]
  canManage: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [selected, setSelected] = useState<string[]>(assigned.map((a) => a.id))
  const [open, setOpen] = useState(false)

  const save = () => {
    startTransition(async () => {
      const result = await setRoleAssignments(projectRoleId, selected)
      if (result.ok) {
        setOpen(false)
        toast.success(`${roleName} assignments updated`, {
          description: result.warnings?.[0]?.message,
          duration: result.warnings?.length ? 9000 : 4000,
        })
        router.refresh()
      } else {
        toast.error(result.error.message)
      }
    })
  }

  if (!canManage) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        {assigned.length === 0 ? (
          <span className="text-xs text-muted-foreground">Nobody assigned</span>
        ) : (
          assigned.map((member) => (
            <Avatar key={member.id} name={member.name} color={member.color} size="xs" />
          ))
        )}
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 outline-none"
          aria-label={`Assign people to ${roleName}`}
        >
          {assigned.length === 0 ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <UsersIcon className="size-3.5" />
              Assign
            </span>
          ) : (
            <span className="flex -space-x-1.5">
              {assigned.slice(0, 4).map((member) => (
                <Avatar
                  key={member.id}
                  name={member.name}
                  color={member.color}
                  size="xs"
                  className="ring-2 ring-card"
                />
              ))}
              {assigned.length > 4 ? (
                <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[9px] font-semibold ring-2 ring-card">
                  +{assigned.length - 4}
                </span>
              ) : null}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <p className="border-b px-3 py-2 text-[13px] font-semibold">{roleName}</p>
        <ul className="max-h-64 overflow-y-auto p-1">
          {members.map((member) => {
            const checked = selected.includes(member.id)
            return (
              <li key={member.id}>
                <Label className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 hover:bg-muted">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(next) =>
                      setSelected((prev) =>
                        next ? [...prev, member.id] : prev.filter((id) => id !== member.id),
                      )
                    }
                  />
                  <Avatar name={member.name} color={member.color} size="xs" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-normal">{member.name}</span>
                </Label>
              </li>
            )
          })}
        </ul>
        <div className="flex justify-end gap-2 border-t px-3 py-2">
          <Button variant="ghost" size="xs" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="xs" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
