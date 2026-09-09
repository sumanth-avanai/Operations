'use client'
import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { deleteLeave, upsertLeave } from '@/lib/actions/members'
import {
  LEAVE_PORTIONS, LEAVE_PORTION_LABELS, LEAVE_TYPES, LEAVE_TYPE_LABELS,
  type LeavePortion, type LeaveTypeName,
} from '@/lib/domain/types'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Field, FormError, FormGrid } from '@/components/shared/form'

export type LeaveRow = {
  id: string
  leaveType: LeaveTypeName
  startDate: string
  endDate: string
  portion: LeavePortion
  note: string | null
  rangeLabel: string
}

export function LeaveEditor({
  memberId,
  leave,
  canManage,
  today,
}: {
  memberId: string
  leave: LeaveRow[]
  canManage: boolean
  /** The workspace's day, resolved on the server. Never `new Date()` here — see lib/domain/dates. */
  today: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<string>('vacation')
  const [portion, setPortion] = useState<LeavePortion>('full')

  const [state, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof upsertLeave>> | null, formData: FormData) => {
      const result = await upsertLeave(prev, formData)
      if (result.ok) {
        setOpen(false)
        toast.success('Leave recorded', {
          description: result.warnings?.[0]?.message,
          duration: result.warnings?.length ? 9000 : 4000,
        })
        router.refresh()
      }
      return result
    },
    null,
  )
  const error = state && !state.ok ? state.error : null

  return (
    <div className="flex flex-col gap-3">
      {leave.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No leave recorded. Leave removes availability everywhere — timesheet, planner and
          utilization.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {leave.map((row) => (
            <li key={row.id} className="flex items-center gap-3 px-3 py-2">
              <Badge variant={row.leaveType === 'sick' ? 'warn' : 'info'}>
                {LEAVE_TYPE_LABELS[row.leaveType]}
              </Badge>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] tnum">{row.rangeLabel}</span>
                {row.note ? (
                  <span className="block truncate text-xs text-muted-foreground">{row.note}</span>
                ) : null}
              </span>
              <span className="text-xs text-muted-foreground">
                {LEAVE_PORTION_LABELS[row.portion].toLowerCase()}
              </span>
              {canManage ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete leave"
                  onClick={async () => {
                    const result = await deleteLeave(row.id)
                    if (result.ok) {
                      toast.success('Leave removed')
                      router.refresh()
                    } else toast.error(result.error.message)
                  }}
                >
                  <Trash2Icon />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="self-start">
              <PlusIcon />
              Record leave
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record leave</DialogTitle>
              <DialogDescription>
                Days already logged inside the range are kept and flagged rather than deleted.
              </DialogDescription>
            </DialogHeader>
            <form action={action} className="flex flex-col gap-4">
              <input type="hidden" name="memberId" value={memberId} />
              <input type="hidden" name="leaveType" value={type} />
              <input type="hidden" name="portion" value={portion} />
              <FormError error={error} />
              <FormGrid>
                <Field name="leaveType" label="Type" error={error} span>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LEAVE_TYPES.map((option) => (
                        <SelectItem key={option} value={option}>
                          {LEAVE_TYPE_LABELS[option]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field name="startDate" label="First day" error={error}>
                  <Input id="startDate" name="startDate" type="date" defaultValue={today} required />
                </Field>
                <Field name="endDate" label="Last day" error={error}>
                  <Input id="endDate" name="endDate" type="date" defaultValue={today} required />
                </Field>
                <Field
                  name="portion"
                  label="How much of the day"
                  error={error}
                  hint="A half day absorbs half of that day's own working pattern."
                  span
                >
                  <Select value={portion} onValueChange={(v) => setPortion(v as LeavePortion)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LEAVE_PORTIONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {LEAVE_PORTION_LABELS[option]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field name="note" label="Note" error={error} span>
                  <Textarea id="note" name="note" rows={2} />
                </Field>
              </FormGrid>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? 'Saving…' : 'Record leave'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
