'use client'
/**
 * The timesheet week grid: roles down the side, days across the top, one save.
 *
 * Used unchanged by the internal Timesheet panel and by the account-free personal
 * portal, so a logger and an operations lead are looking at the same grid with the
 * same guardrails — the only difference is which member it is bound to.
 */
import { useCallback, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { LockIcon, MessageSquareIcon, SaveIcon } from 'lucide-react'
import { saveTimesheetWeek } from '@/lib/actions/timesheet'
import { formatHours, parseHoursInput } from '@/lib/domain/money'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { WarningList } from '@/components/shared/warnings'
import type { Warning } from '@/lib/domain/guardrails'
import { cn } from '@/lib/utils'

export type GridDay = {
  date: string
  availableMinutes: number
  reason: string | null
  label: string | null
  isToday: boolean
  weekdayLabel: string
  dayLabel: string
}

export type GridRow = {
  projectRoleId: string
  roleName: string
  projectName: string
  projectColor: string
  clientName: string
  billable: boolean
  assigned: boolean
  cells: Record<string, { minutes: number; note: string | null; invoiceReference: string | null }>
  planned: Record<string, number>
  plannedMinutes: number
}

type Props = {
  memberId: string
  memberName: string
  weekStart: string
  days: GridDay[]
  rows: GridRow[]
  baseUpdatedAt: string | null
  portalToken?: string
  /** Shown under the totals row; the caller formats it with workspace settings. */
  availableLabel: string
}

const cellKey = (roleId: string, date: string) => `${roleId}|${date}`

export function WeekGrid({
  memberId,
  memberName,
  weekStart,
  days,
  rows,
  baseUpdatedAt,
  portalToken,
  availableLabel,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [showNotes, setShowNotes] = useState(() =>
    rows.some((row) => Object.values(row.cells).some((cell) => cell.note)),
  )
  const [warnings, setWarnings] = useState<Warning[]>([])
  const [conflict, setConflict] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)

  const initial = useMemo(() => {
    const hours: Record<string, string> = {}
    const notes: Record<string, string> = {}
    for (const row of rows) {
      for (const day of days) {
        const cell = row.cells[day.date]
        hours[cellKey(row.projectRoleId, day.date)] = cell ? formatHours(cell.minutes, { zero: '' }) : ''
        notes[cellKey(row.projectRoleId, day.date)] = cell?.note ?? ''
      }
    }
    return { hours, notes }
  }, [rows, days])

  const [hours, setHours] = useState<Record<string, string>>(initial.hours)
  const [notes, setNotes] = useState<Record<string, string>>(initial.notes)

  const dirty = useMemo(
    () =>
      Object.keys(initial.hours).some((key) => (hours[key] ?? '') !== (initial.hours[key] ?? '')) ||
      Object.keys(initial.notes).some((key) => (notes[key] ?? '') !== (initial.notes[key] ?? '')),
    [hours, notes, initial],
  )

  const parsedMinutes = useCallback(
    (roleId: string, date: string) => {
      const raw = hours[cellKey(roleId, date)] ?? ''
      const value = parseHoursInput(raw)
      return value === null ? 0 : value
    },
    [hours],
  )

  const dayTotals = useMemo(() => {
    const totals: Record<string, number> = {}
    for (const day of days) {
      totals[day.date] = rows.reduce((sum, row) => sum + parsedMinutes(row.projectRoleId, day.date), 0)
    }
    return totals
  }, [days, rows, parsedMinutes])

  const rowTotals = useMemo(() => {
    const totals: Record<string, number> = {}
    for (const row of rows) {
      totals[row.projectRoleId] = days.reduce(
        (sum, day) => sum + parsedMinutes(row.projectRoleId, day.date),
        0,
      )
    }
    return totals
  }, [days, rows, parsedMinutes])

  const weekTotal = Object.values(dayTotals).reduce((a, b) => a + b, 0)
  const weekAvailable = days.reduce((sum, day) => sum + day.availableMinutes, 0)
  const invalidCells = Object.entries(hours).filter(
    ([, raw]) => raw.trim() !== '' && parseHoursInput(raw) === null,
  )

  const cellState = (row: GridRow, day: GridDay) => {
    const cell = row.cells[day.date]
    const locked = day.availableMinutes === 0
    const invoiced = Boolean(cell?.invoiceReference)
    const blockedByAssignment = !row.assigned && !cell
    return {
      cell,
      disabled: locked || invoiced || blockedByAssignment,
      invoiced,
      locked,
      blockedByAssignment,
      reasonText: invoiced
        ? `Invoiced as ${cell?.invoiceReference}`
        : locked
          ? (day.label ?? 'Not a working day')
          : blockedByAssignment
            ? `${memberName} is not assigned to this role`
            : null,
    }
  }

  const focusCell = (rowIndex: number, dayIndex: number) => {
    const target = gridRef.current?.querySelector<HTMLInputElement>(
      `input[data-cell="${rowIndex}-${dayIndex}"]:not([disabled])`,
    )
    target?.focus()
    target?.select()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, dayIndex: number) => {
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      Enter: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    }
    const move = moves[event.key]
    if (!move) return
    // Let the caret move inside a partially typed value first.
    if (event.key === 'ArrowLeft' && event.currentTarget.selectionStart !== 0) return
    if (
      event.key === 'ArrowRight' &&
      event.currentTarget.selectionStart !== event.currentTarget.value.length
    ) {
      return
    }
    event.preventDefault()
    const nextRow = Math.min(rows.length - 1, Math.max(0, rowIndex + move[0]))
    const nextDay = Math.min(days.length - 1, Math.max(0, dayIndex + move[1]))
    focusCell(nextRow, nextDay)
  }

  const save = () => {
    if (invalidCells.length > 0) {
      toast.error('Some cells are not a number of hours', {
        description: 'Use 7, 7.5, 7:30 or 90m.',
      })
      return
    }
    startTransition(async () => {
      const cells = rows.flatMap((row) =>
        days.map((day) => ({
          projectRoleId: row.projectRoleId,
          date: day.date,
          minutes: parsedMinutes(row.projectRoleId, day.date),
          note: (notes[cellKey(row.projectRoleId, day.date)] ?? '').trim() || null,
        })),
      )
      const result = await saveTimesheetWeek({
        memberId,
        weekStart,
        baseUpdatedAt,
        cells,
        ...(portalToken ? { portalToken } : {}),
      })

      if (!result.ok) {
        setConflict(result.error.code === 'conflict')
        toast.error(
          result.error.code === 'conflict' ? 'This week changed while you were editing' : 'Nothing was saved',
          { description: result.error.message, duration: 8000 },
        )
        return
      }
      setConflict(false)
      setWarnings(result.warnings ?? [])
      const saved = result.data.savedCells
      const deleted = result.data.deletedCells
      toast.success(
        saved + deleted === 0
          ? 'Nothing to save'
          : `Week saved — ${saved} entr${saved === 1 ? 'y' : 'ies'}${deleted ? `, ${deleted} cleared` : ''}`,
        result.warnings && result.warnings.length > 0
          ? { description: `${result.warnings.length} thing(s) to look at below.` }
          : undefined,
      )
      router.refresh()
    })
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-card/50 px-6 py-12 text-center">
        <p className="text-sm font-medium">No projects assigned yet</p>
        <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
          {memberName} has no project roles to log against. Assign them to a role on a project and
          the rows will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Switch id="notes" checked={showNotes} onCheckedChange={setShowNotes} />
          <Label htmlFor="notes" className="cursor-pointer text-muted-foreground">
            <MessageSquareIcon className="size-3.5" />
            Notes
          </Label>
        </div>
        <div className="flex items-center gap-3">
          {dirty ? (
            <span className="flex items-center gap-1.5 text-[13px] text-warn">
              <span className="size-1.5 rounded-full bg-warn" />
              Unsaved changes
            </span>
          ) : null}
          <Button onClick={save} disabled={pending || !dirty}>
            <SaveIcon />
            {pending ? 'Saving…' : 'Save week'}
          </Button>
        </div>
      </div>

      {conflict ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px]">
          <span>This week was changed elsewhere. Nothing was saved.</span>
          <Button size="xs" variant="outline" onClick={() => router.refresh()}>
            Reload the week
          </Button>
        </div>
      ) : null}

      <div ref={gridRef} className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[840px] border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <th className="grid-sticky-left sticky top-0 z-20 min-w-[240px] border-b px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Project · Role
              </th>
              {days.map((day) => (
                <th
                  key={day.date}
                  className={cn(
                    'border-b px-1.5 py-2 text-center font-medium',
                    day.isToday && 'bg-accent/40',
                    day.availableMinutes === 0 && 'bg-muted/60',
                  )}
                >
                  <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                    {day.weekdayLabel}
                  </span>
                  <span className="block text-[13px] font-semibold">{day.dayLabel}</span>
                  {day.availableMinutes === 0 ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                          <LockIcon className="size-2.5" />
                          locked
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{day.label ?? 'Not a working day'}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <span className="mt-0.5 block text-[10px] text-muted-foreground tnum">
                      {formatHours(day.availableMinutes, { zero: '0' })}h
                    </span>
                  )}
                </th>
              ))}
              <th className="border-b border-l px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Logged
              </th>
              <th className="border-b px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Planned
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.projectRoleId} className="group">
                <td className="grid-sticky-left border-b px-3 py-1.5 align-middle group-hover:bg-muted/40">
                  <span className="flex items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: row.projectColor }}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{row.projectName}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {row.clientName} · {row.roleName}
                        {row.billable ? '' : ' · non-billable'}
                        {row.assigned ? '' : ' · no longer assigned'}
                      </span>
                    </span>
                  </span>
                </td>

                {days.map((day, dayIndex) => {
                  const state = cellState(row, day)
                  const key = cellKey(row.projectRoleId, day.date)
                  const planned = row.planned[day.date] ?? 0
                  const raw = hours[key] ?? ''
                  const invalid = raw.trim() !== '' && parseHoursInput(raw) === null
                  const input = (
                    <input
                      data-cell={`${rowIndex}-${dayIndex}`}
                      inputMode="decimal"
                      className={cn(
                        'h-8 w-full rounded-md border border-transparent bg-transparent px-1 text-center tnum outline-none transition-colors',
                        'hover:border-border focus:border-ring focus:bg-card focus:ring-2 focus:ring-ring/20',
                        state.disabled && 'cursor-not-allowed text-muted-foreground/60',
                        invalid && 'border-destructive text-destructive',
                        raw.trim() !== '' && !invalid && 'font-medium',
                      )}
                      value={raw}
                      disabled={state.disabled}
                      placeholder={planned > 0 ? formatHours(planned, { zero: '' }) : ''}
                      aria-label={`${row.projectName} ${row.roleName} on ${day.date}`}
                      aria-invalid={invalid || undefined}
                      onChange={(event) => setHours((prev) => ({ ...prev, [key]: event.target.value }))}
                      onFocus={(event) => event.currentTarget.select()}
                      onKeyDown={(event) => onKeyDown(event, rowIndex, dayIndex)}
                    />
                  )
                  return (
                    <td
                      key={day.date}
                      className={cn(
                        'border-b px-1 py-1 align-middle',
                        day.isToday && 'bg-accent/20',
                        state.locked && 'bg-muted/50',
                        state.invoiced && 'bg-ok-soft/40',
                      )}
                    >
                      {state.reasonText ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="block">{input}</span>
                          </TooltipTrigger>
                          <TooltipContent>{state.reasonText}</TooltipContent>
                        </Tooltip>
                      ) : (
                        input
                      )}
                      {showNotes && !state.disabled ? (
                        <input
                          className="mt-1 h-6 w-full rounded border border-transparent bg-transparent px-1 text-[11px] text-muted-foreground outline-none hover:border-border focus:border-ring focus:bg-card"
                          value={notes[key] ?? ''}
                          placeholder="note"
                          aria-label={`Note for ${row.projectName} on ${day.date}`}
                          onChange={(event) => setNotes((prev) => ({ ...prev, [key]: event.target.value }))}
                        />
                      ) : null}
                    </td>
                  )
                })}

                <td className="border-b border-l px-2 py-1.5 text-right font-semibold tnum">
                  {formatHours(rowTotals[row.projectRoleId] ?? 0)}
                </td>
                <td className="border-b px-2 py-1.5 text-right tnum text-muted-foreground">
                  {formatHours(row.plannedMinutes)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-muted/60">
              <td className="grid-sticky-left px-3 py-2 font-semibold" style={{ backgroundColor: 'var(--muted)' }}>
                Total
              </td>
              {days.map((day) => {
                const total = dayTotals[day.date] ?? 0
                const over = total > day.availableMinutes
                return (
                  <td key={day.date} className="px-1 py-2 text-center">
                    <span
                      className={cn('font-semibold tnum', over && 'text-danger')}
                      title={over ? 'Over this day’s capacity' : undefined}
                    >
                      {formatHours(total, { zero: '—' })}
                    </span>
                  </td>
                )
              })}
              <td className="border-l px-2 py-2 text-right font-semibold tnum">
                {formatHours(weekTotal)}
              </td>
              <td className="px-2 py-2 text-right tnum text-muted-foreground">
                {formatHours(rows.reduce((sum, row) => sum + row.plannedMinutes, 0))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted-foreground">
        <span>
          {availableLabel} · logged {formatHours(weekTotal, { zero: '0' })}h of{' '}
          {formatHours(weekAvailable, { zero: '0' })}h available
        </span>
        <span className="text-xs">Type 7, 7.5, 7:30 or 90m · arrow keys move between cells</span>
      </div>

      <WarningList warnings={warnings} />
    </div>
  )
}
