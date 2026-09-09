'use client'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Trash2Icon } from 'lucide-react'
import { deleteBooking } from '@/lib/actions/bookings'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/shared/avatar'
import { BookingDialog, type Assignment } from './booking-dialog'

export type BookingListRow = {
  id: string
  memberId: string
  memberName: string
  memberColor: string
  projectRoleId: string
  projectName: string
  roleName: string
  projectColor: string
  clientName: string
  startDate: string
  endDate: string
  minutesPerDay: number
  status: 'tentative' | 'confirmed'
  note: string | null
  rangeLabel: string
  effectiveLabel: string
  slipped: boolean
}

export function BookingList({
  bookings,
  members,
  assignments,
  canManage,
}: {
  bookings: BookingListRow[]
  members: { id: string; name: string }[]
  assignments: Assignment[]
  canManage: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  if (bookings.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Nothing booked in this window. Create a booking and it appears on the timeline above.
      </p>
    )
  }

  return (
    <ul className="divide-y rounded-lg border">
      {bookings.map((booking) => (
        <li key={booking.id} className="flex flex-wrap items-center gap-2.5 px-3 py-2">
          <Avatar name={booking.memberName} color={booking.memberColor} size="xs" />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="truncate text-[13px] font-medium">{booking.memberName}</span>
              <span className="truncate text-[12px] text-muted-foreground">
                {booking.projectName} · {booking.roleName}
              </span>
              {booking.status === 'tentative' ? <Badge variant="info">Tentative</Badge> : null}
              {booking.slipped ? <Badge variant="warn">Not fully logged</Badge> : null}
            </span>
            <span className="block text-[11px] text-muted-foreground tnum">
              {booking.rangeLabel} · {booking.minutesPerDay / 60}h/day · {booking.effectiveLabel}
              {booking.note ? ` · ${booking.note}` : ''}
            </span>
          </span>
          {canManage ? (
            <span className="flex shrink-0 gap-1">
              <BookingDialog
                members={members}
                assignments={assignments}
                defaultStart={booking.startDate}
                defaultEnd={booking.endDate}
                booking={{
                  id: booking.id,
                  memberId: booking.memberId,
                  projectRoleId: booking.projectRoleId,
                  startDate: booking.startDate,
                  endDate: booking.endDate,
                  hoursPerDay: String(booking.minutesPerDay / 60),
                  status: booking.status,
                  note: booking.note,
                }}
                trigger={
                  <button className="rounded-md px-2 py-1 text-[12px] font-medium text-primary hover:bg-muted">
                    Edit
                  </button>
                }
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete booking"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await deleteBooking(booking.id)
                    if (result.ok) {
                      toast.success('Booking removed')
                      router.refresh()
                    } else toast.error(result.error.message)
                  })
                }
              >
                <Trash2Icon />
              </Button>
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
