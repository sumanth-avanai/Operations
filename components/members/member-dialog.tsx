'use client'
import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { PlusIcon } from 'lucide-react'
import { createMember, updateMember } from '@/lib/actions/members'
import { MEMBER_ROLES, MEMBER_ROLE_LABELS, type MemberRoleName, type WorkingMinutes } from '@/lib/domain/types'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Field, FormError, FormGrid } from '@/components/shared/form'
import { ColorPicker } from '@/components/shared/color-picker'
import { WeekdayHours } from './weekday-hours'

export type MemberFormValues = {
  id?: string
  name: string
  email: string
  role: MemberRoleName
  workingMinutes: WorkingMinutes
  contractStart: string
  contractEnd: string | null
  utilizationTargetPct: number | null
  holidayCalendarId: string | null
  color: string
}

const FULL_WEEK: WorkingMinutes = { mon: 480, tue: 480, wed: 480, thu: 480, fri: 480, sat: 0, sun: 0 }

export function MemberDialog({
  calendars,
  member,
  today,
  trigger,
  defaultOpen,
}: {
  calendars: { id: string; name: string }[]
  member?: MemberFormValues
  /** The workspace's day, resolved on the server. Never `new Date()` here — see lib/domain/dates. */
  today: string
  trigger?: React.ReactNode
  defaultOpen?: boolean
}) {
  const router = useRouter()
  const editing = Boolean(member?.id)
  const [open, setOpen] = useState(defaultOpen ?? false)

  const [state, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof createMember>> | Awaited<ReturnType<typeof updateMember>> | null, formData: FormData) => {
      const result = editing ? await updateMember(null, formData) : await createMember(null, formData)
      if (result.ok) {
        setOpen(false)
        toast.success(editing ? 'Member updated' : 'Member added', {
          description:
            !editing && 'portalPath' in (result.data ?? {})
              ? 'Their private timesheet link is ready on their profile.'
              : result.warnings?.[0]?.message,
          duration: result.warnings?.length ? 9000 : 4000,
        })
        router.refresh()
      }
      return result
    },
    null,
  )

  const error = state && !state.ok ? state.error : null
  const values: MemberFormValues =
    member ?? {
      name: '',
      email: '',
      role: 'logger',
      workingMinutes: FULL_WEEK,
      contractStart: today,
      contractEnd: null,
      utilizationTargetPct: 80,
      holidayCalendarId: calendars[0]?.id ?? null,
      color: 'var(--hue-1)',
    }

  const [role, setRole] = useState<string>(values.role)
  const [calendar, setCalendar] = useState<string>(values.holidayCalendarId ?? 'none')
  useEffect(() => {
    if (open) {
      setRole(values.role)
      setCalendar(values.holidayCalendarId ?? 'none')
    }
  }, [open, values.role, values.holidayCalendarId])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <PlusIcon />
            Add member
          </Button>
        )}
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${values.name}` : 'Add a team member'}</DialogTitle>
          <DialogDescription>
            Their working days, contract dates and holiday calendar are what make capacity and
            utilization honest — everything else is derived from them.
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="flex flex-col gap-4">
          {member?.id ? <input type="hidden" name="memberId" value={member.id} /> : null}
          <input type="hidden" name="role" value={role} />
          <input type="hidden" name="holidayCalendarId" value={calendar} />

          <FormError error={error} />

          <FormGrid>
            <Field name="name" label="Name" error={error}>
              <Input id="name" name="name" defaultValue={values.name} required autoComplete="off" />
            </Field>
            <Field name="email" label="Email" error={error}>
              <Input id="email" name="email" type="email" defaultValue={values.email} required autoComplete="off" />
            </Field>

            <Field name="role" label="Role" error={error} hint="Decides what they can see and change.">
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEMBER_ROLES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {MEMBER_ROLE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              name="holidayCalendarId"
              label="Holiday calendar"
              error={error}
              hint="Public holidays that remove their availability."
            >
              <Select value={calendar} onValueChange={setCalendar}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No calendar</SelectItem>
                  {calendars.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <WeekdayHours value={values.workingMinutes} />

            <Field name="contractStart" label="Contract start" error={error}>
              <Input id="contractStart" name="contractStart" type="date" defaultValue={values.contractStart} required />
            </Field>
            <Field
              name="contractEnd"
              label="Contract end"
              error={error}
              hint="Leave empty for open-ended. Availability is zero after this date."
            >
              <Input id="contractEnd" name="contractEnd" type="date" defaultValue={values.contractEnd ?? ''} />
            </Field>

            <Field
              name="utilizationTargetPct"
              label="Utilization target"
              error={error}
              hint="Percent of available hours expected to be billable."
            >
              <Input
                id="utilizationTargetPct"
                name="utilizationTargetPct"
                type="number"
                min={0}
                max={100}
                defaultValue={values.utilizationTargetPct ?? ''}
              />
            </Field>

            <ColorPicker defaultValue={values.color} />
          </FormGrid>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : editing ? 'Save changes' : 'Add member'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
