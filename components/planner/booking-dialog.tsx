'use client'
import { useActionState, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CalendarPlusIcon } from 'lucide-react'
import { checkRoleBudget, upsertBooking, type BudgetProbe } from '@/lib/actions/bookings'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Field, FormError, FormGrid } from '@/components/shared/form'
import { formatHours, formatMoney, parseHoursInput } from '@/lib/domain/money'

export type Assignment = {
  memberId: string
  projectRoleId: string
  roleName: string
  projectName: string
  clientName: string
  billable: boolean
}

export type BookingFormValues = {
  id?: string
  memberId: string
  projectRoleId: string
  startDate: string
  endDate: string
  hoursPerDay: string
  status: 'tentative' | 'confirmed'
  note: string | null
}

export function BookingDialog({
  members,
  assignments,
  booking,
  defaultStart,
  defaultEnd,
  trigger,
}: {
  members: { id: string; name: string }[]
  assignments: Assignment[]
  booking?: BookingFormValues
  defaultStart: string
  defaultEnd: string
  trigger?: React.ReactNode
}) {
  const router = useRouter()
  const editing = Boolean(booking?.id)
  const [open, setOpen] = useState(false)
  const [memberId, setMemberId] = useState(booking?.memberId ?? members[0]?.id ?? '')
  const [roleId, setRoleId] = useState(booking?.projectRoleId ?? '')
  const [startDate, setStartDate] = useState(booking?.startDate ?? defaultStart)
  const [endDate, setEndDate] = useState(booking?.endDate ?? defaultEnd)
  const [hours, setHours] = useState(booking?.hoursPerDay ?? '8')
  const [confirmed, setConfirmed] = useState((booking?.status ?? 'confirmed') === 'confirmed')
  const [probe, setProbe] = useState<BudgetProbe | null>(null)
  const [probing, startProbe] = useTransition()

  const roleOptions = assignments.filter((a) => a.memberId === memberId)

  useEffect(() => {
    if (!roleOptions.some((option) => option.projectRoleId === roleId)) {
      setRoleId(roleOptions[0]?.projectRoleId ?? '')
    }
  }, [memberId, roleId, roleOptions])

  // The on-the-spot budget answer, without leaving the dialog (SC-004).
  useEffect(() => {
    if (!open || !roleId || !memberId) {
      setProbe(null)
      return
    }
    const minutes = parseHoursInput(hours)
    if (minutes === null || minutes <= 0 || endDate < startDate) {
      setProbe(null)
      return
    }
    const handle = setTimeout(() => {
      startProbe(async () => {
        const result = await checkRoleBudget({
          memberId,
          projectRoleId: roleId,
          startDate,
          endDate,
          minutesPerDay: minutes,
          ...(booking?.id ? { excludeBookingId: booking.id } : {}),
        })
        setProbe(result.ok ? result.data : null)
      })
    }, 250)
    return () => clearTimeout(handle)
  }, [open, memberId, roleId, startDate, endDate, hours, booking?.id])

  const [state, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof upsertBooking>> | null, formData: FormData) => {
      const result = await upsertBooking(prev, formData)
      if (result.ok) {
        setOpen(false)
        toast.success(editing ? 'Booking updated' : 'Booking created', {
          description: result.warnings?.map((w) => w.message).join(' '),
          duration: result.warnings?.length ? 10000 : 4000,
        })
        router.refresh()
      }
      return result
    },
    null,
  )
  const error = state && !state.ok ? state.error : null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <CalendarPlusIcon />
            New booking
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit booking' : 'Book someone onto work'}</DialogTitle>
          <DialogDescription>
            Days that fall on leave, a holiday or a non-working day contribute nothing, so a booking
            never invents capacity.
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="flex flex-col gap-4">
          {booking?.id ? <input type="hidden" name="bookingId" value={booking.id} /> : null}
          <input type="hidden" name="memberId" value={memberId} />
          <input type="hidden" name="projectRoleId" value={roleId} />
          <input type="hidden" name="status" value={confirmed ? 'confirmed' : 'tentative'} />

          <FormError error={error} />

          <FormGrid>
            <Field name="memberId" label="Person" error={error}>
              <Select value={memberId} onValueChange={setMemberId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {members.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              name="projectRoleId"
              label="Project role"
              error={error}
              hint={roleOptions.length === 0 ? 'This person is not assigned to any role yet.' : undefined}
            >
              <Select value={roleId} onValueChange={setRoleId} disabled={roleOptions.length === 0}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="No roles available" />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions.map((option) => (
                    <SelectItem key={option.projectRoleId} value={option.projectRoleId}>
                      {option.projectName} · {option.roleName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field name="startDate" label="First day" error={error}>
              <Input
                id="startDate"
                name="startDate"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                required
              />
            </Field>
            <Field name="endDate" label="Last day" error={error}>
              <Input
                id="endDate"
                name="endDate"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                required
              />
            </Field>

            <Field name="minutesPerDay" label="Hours per day" error={error}>
              <Input
                id="minutesPerDay"
                name="minutesPerDay"
                value={hours}
                onChange={(event) => setHours(event.target.value)}
                inputMode="decimal"
                required
              />
            </Field>

            <div className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5">
              <Switch id="confirmed" checked={confirmed} onCheckedChange={setConfirmed} />
              <div>
                <Label htmlFor="confirmed" className="cursor-pointer">
                  {confirmed ? 'Confirmed' : 'Tentative'}
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Tentative work shows on the planner but does not consume budget.
                </p>
              </div>
            </div>

            <Field name="note" label="Note" error={error} span>
              <Textarea id="note" name="note" rows={2} defaultValue={booking?.note ?? ''} />
            </Field>
          </FormGrid>

          {probe ? (
            <div
              className="flex flex-col gap-1 rounded-lg px-3 py-2.5 text-[13px]"
              style={{
                backgroundColor: probe.wouldExceedBy > 0 ? 'var(--danger-soft)' : 'var(--ok-soft)',
              }}
            >
              <span className="font-medium">
                {probe.projectName} · {probe.roleName}
              </span>
              <span className="text-foreground/85">
                This booking is {formatHours(probe.proposalMinutes, { zero: '0' })}h ={' '}
                {formatMoney(probe.proposalCents, probe.currency)}.{' '}
                {probe.budgetCents === 0
                  ? 'This role has no budget set.'
                  : probe.wouldExceedBy > 0
                    ? `Only ${formatMoney(Math.max(0, probe.remainingCents), probe.currency)} remains — ${formatMoney(probe.wouldExceedBy, probe.currency)} over. It will still save.`
                    : `${formatMoney(probe.remainingCents, probe.currency)} of budget remains.`}
              </span>
            </div>
          ) : probing ? (
            <p className="text-[13px] text-muted-foreground">Checking the role&apos;s budget…</p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !roleId}>
              {pending ? 'Saving…' : editing ? 'Save booking' : 'Create booking'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
