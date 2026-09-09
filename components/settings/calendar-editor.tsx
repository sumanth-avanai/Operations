'use client'
import { useActionState, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import {
  deleteHoliday, deleteHolidayCalendar, upsertHoliday, upsertHolidayCalendar,
} from '@/lib/actions/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FormError, FormGrid } from '@/components/shared/form'

export type CalendarRow = {
  id: string
  name: string
  regionCode: string | null
  memberCount: number
  holidays: { id: string; holidayDate: string; name: string; dateLabel: string }[]
}

export function CalendarEditor({ calendars }: { calendars: CalendarRow[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <div className="flex flex-col gap-4">
      {calendars.map((calendar) => (
        <div key={calendar.id} className="rounded-lg border">
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{calendar.name}</span>
              <span className="block text-[11px] text-muted-foreground">
                {calendar.regionCode ? `${calendar.regionCode} · ` : ''}
                {calendar.memberCount} member{calendar.memberCount === 1 ? '' : 's'} ·{' '}
                {calendar.holidays.length} upcoming holiday
                {calendar.holidays.length === 1 ? '' : 's'}
              </span>
            </span>
            <HolidayDialog calendarId={calendar.id} calendarName={calendar.name} />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete ${calendar.name}`}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteHolidayCalendar(calendar.id)
                  if (result.ok) {
                    toast.success('Calendar removed')
                    router.refresh()
                  } else toast.error(result.error.message)
                })
              }
            >
              <Trash2Icon />
            </Button>
          </div>
          {calendar.holidays.length === 0 ? (
            <p className="px-3 py-3 text-[13px] text-muted-foreground">
              No holidays from this year onward.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5 px-3 py-2.5">
              {calendar.holidays.map((holiday) => (
                <li key={holiday.id}>
                  <Badge variant="idle" className="gap-1 py-1">
                    <span className="tnum">{holiday.dateLabel}</span>
                    <span className="text-muted-foreground">{holiday.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${holiday.name}`}
                      className="ml-0.5 rounded hover:text-destructive"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await deleteHoliday(holiday.id)
                          if (result.ok) {
                            toast.success('Holiday removed')
                            router.refresh()
                          } else toast.error(result.error.message)
                        })
                      }
                    >
                      ×
                    </button>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <CalendarDialog />
    </div>
  )
}

function CalendarDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof upsertHolidayCalendar>> | null, formData: FormData) => {
      const result = await upsertHolidayCalendar(prev, formData)
      if (result.ok) {
        setOpen(false)
        toast.success('Calendar added')
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
        <Button variant="outline" size="sm" className="self-start">
          <PlusIcon />
          Add calendar
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Add a holiday calendar</DialogTitle>
          <DialogDescription>
            One per region you operate in. Each member is attached to exactly one.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-4">
          <FormError error={error} />
          <FormGrid className="sm:grid-cols-1">
            <Field name="name" label="Name" error={error}>
              <Input id="name" name="name" placeholder="Spain — Catalonia" required />
            </Field>
            <Field name="regionCode" label="Region code" error={error} hint="Optional, e.g. ES-CT.">
              <Input id="regionCode" name="regionCode" placeholder="ES-CT" />
            </Field>
          </FormGrid>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Adding…' : 'Add calendar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function HolidayDialog({ calendarId, calendarName }: { calendarId: string; calendarName: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof upsertHoliday>> | null, formData: FormData) => {
      const result = await upsertHoliday(prev, formData)
      if (result.ok) {
        setOpen(false)
        toast.success('Holiday added', {
          description: result.warnings?.[0]?.message,
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
        <Button variant="outline" size="xs">
          <PlusIcon />
          Holiday
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Add a holiday</DialogTitle>
          <DialogDescription>
            {calendarName}. Anyone on this calendar loses that day&apos;s availability; hours already
            logged on it are kept and flagged.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="calendarId" value={calendarId} />
          <FormError error={error} />
          <FormGrid className="sm:grid-cols-1">
            <Field name="holidayDate" label="Date" error={error}>
              <Input id="holidayDate" name="holidayDate" type="date" required />
            </Field>
            <Field name="name" label="Name" error={error}>
              <Input id="name" name="name" placeholder="Company day" required />
            </Field>
          </FormGrid>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Adding…' : 'Add holiday'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
