'use client'
/*
 * This file must stay a client component, and not because it holds state — it holds
 * none. It builds `content` as a React element and hands that element to
 * <TooltipTrigger asChild>, and Radix's Slot only accepts a real element there. An
 * element built in a *server* component reaches Slot through the RSC payload, and once
 * that payload is large enough for React to split it into chunks, the element arrives
 * as a lazy reference instead. Slot does not unwrap one, so it throws
 *
 *   Primitive.button failed to slot onto its children.
 *
 * and the page 500s. The failure is payload-size dependent, which makes it look random:
 * the week and month scales stayed under the chunk boundary while quarter and year, with
 * the same code, went over it. Building the element on this side of the boundary keeps
 * Slot's input a real element at every size. `npm run audit` enforces the rule.
 */
import { LOAD_BAND_STYLE } from '@/lib/domain/utilization'
import { formatHours } from '@/lib/domain/money'
import type { PlannerData } from '@/lib/db/queries/planner'
import { Avatar } from '@/components/shared/avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * Every person across a timeline, with each cell coloured by how full it is against
 * that person's REAL availability. Tentative work is hatched — it is a plan, not a
 * commitment. Leave and holidays render as blocked rather than empty, so a free-looking
 * gap always means genuinely free.
 */
export function Timeline({
  data,
  weekdayLabels,
}: {
  data: PlannerData
  /** Pre-formatted per bucket so the client ships no date library. */
  weekdayLabels: Record<string, string>
}) {
  const perDay = data.scale === 'week' || data.scale === 'month'
  const cellWidth = perDay ? 'w-11' : data.scale === 'quarter' ? 'w-16' : 'w-14'

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            <th className="grid-sticky-left sticky top-0 z-20 min-w-[190px] border-b px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Person
            </th>
            {data.buckets.map((bucket) => (
              <th
                key={bucket.key}
                className={cn(
                  'border-b px-0.5 py-1.5 text-center font-medium',
                  cellWidth,
                  bucket.isToday && 'bg-accent/40',
                )}
              >
                <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                  {weekdayLabels[bucket.key] ?? ''}
                </span>
                <span className="block text-[12px] font-semibold tnum">{bucket.label}</span>
              </th>
            ))}
            <th className="border-b border-l px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Booked
            </th>
            <th className="border-b px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Free
            </th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => {
            const free = Math.max(0, row.availableMinutes - row.confirmedMinutes - row.tentativeMinutes)
            return (
              <tr key={row.memberId} className="group">
                <td className="grid-sticky-left border-b px-3 py-1.5 group-hover:bg-muted/40">
                  <span className="flex items-center gap-2">
                    <Avatar name={row.name} color={row.color} size="xs" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{row.name}</span>
                      <span className="block text-[10px] text-muted-foreground tnum">
                        {formatHours(row.availableMinutes, { zero: '0' })}h available
                      </span>
                    </span>
                  </span>
                </td>

                {row.cells.map((cell) => {
                  const booked = cell.confirmedMinutes + cell.tentativeMinutes
                  const style = LOAD_BAND_STYLE[cell.band]
                  const blocked = cell.availableMinutes === 0
                  const tentativeShare = booked > 0 ? cell.tentativeMinutes / booked : 0
                  const content = (
                    <div
                      className={cn(
                        'relative flex h-9 items-center justify-center overflow-hidden rounded-md text-[11px] font-semibold tnum',
                        blocked && 'bg-[repeating-linear-gradient(135deg,transparent_0_3px,var(--border)_3px_5px)]',
                      )}
                      style={{
                        backgroundColor: blocked ? undefined : style.bg,
                        color: blocked ? 'var(--muted-foreground)' : style.fg,
                      }}
                    >
                      {tentativeShare > 0 && !blocked ? (
                        <span
                          className="absolute inset-y-0 right-0"
                          style={{
                            width: `${tentativeShare * 100}%`,
                            backgroundImage:
                              'repeating-linear-gradient(135deg, transparent 0 3px, rgba(255,255,255,.55) 3px 6px)',
                          }}
                          aria-hidden
                        />
                      ) : null}
                      <span className="relative">
                        {blocked ? '·' : booked > 0 ? formatHours(booked, { zero: '' }) : ''}
                      </span>
                    </div>
                  )
                  const tip = blocked
                    ? (cell.blockedLabel ?? 'Not a working day')
                    : `${formatHours(cell.confirmedMinutes, { zero: '0' })}h confirmed${
                        cell.tentativeMinutes > 0
                          ? ` · ${formatHours(cell.tentativeMinutes)}h tentative`
                          : ''
                      } of ${formatHours(cell.availableMinutes, { zero: '0' })}h available${
                        cell.loggedMinutes > 0 ? ` · ${formatHours(cell.loggedMinutes)}h logged` : ''
                      }`
                  return (
                    <td key={cell.key} className="border-b px-0.5 py-1 align-middle">
                      <Tooltip>
                        <TooltipTrigger asChild>{content}</TooltipTrigger>
                        <TooltipContent>{tip}</TooltipContent>
                      </Tooltip>
                    </td>
                  )
                })}

                <td className="border-b border-l px-2 py-1.5 text-right font-semibold tnum">
                  {formatHours(row.confirmedMinutes + row.tentativeMinutes)}
                </td>
                <td
                  className="border-b px-2 py-1.5 text-right tnum"
                  style={{ color: free === 0 ? 'var(--muted-foreground)' : 'var(--ok)' }}
                >
                  {formatHours(free)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
