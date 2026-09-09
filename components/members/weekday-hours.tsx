'use client'
import { useState } from 'react'
import { WEEKDAY_KEYS, type WorkingMinutes } from '@/lib/domain/types'
import { formatHours, parseHoursInput } from '@/lib/domain/money'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

const LABELS: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
}

const PRESETS: { label: string; minutes: number[] }[] = [
  { label: 'Full week', minutes: [480, 480, 480, 480, 480, 0, 0] },
  { label: 'Four days', minutes: [480, 480, 480, 480, 0, 0, 0] },
  { label: 'Three days', minutes: [480, 0, 480, 0, 480, 0, 0] },
  { label: '60%', minutes: [480, 480, 240, 240, 0, 0, 0] },
]

/**
 * The working-day pattern IS the member's capacity — there is no separate weekly total
 * to disagree with it, so the sum is shown live rather than stored.
 */
export function WeekdayHours({ value }: { value: WorkingMinutes }) {
  const [hours, setHours] = useState<Record<string, string>>(() =>
    Object.fromEntries(WEEKDAY_KEYS.map((key) => [key, formatHours(value[key], { zero: '0' })])),
  )

  const total = WEEKDAY_KEYS.reduce((sum, key) => sum + (parseHoursInput(hours[key] ?? '0') ?? 0), 0)

  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label htmlFor="workingMinutes.mon">Working hours per day</Label>
        <span className="text-xs text-muted-foreground tnum">
          {formatHours(total, { zero: '0' })}h per week
        </span>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAY_KEYS.map((key) => (
          <div key={key} className="flex flex-col gap-1">
            <span className="text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {LABELS[key]}
            </span>
            <Input
              id={`workingMinutes.${key}`}
              name={`workingMinutes.${key}`}
              value={hours[key] ?? '0'}
              inputMode="decimal"
              className="h-8 px-1 text-center tnum"
              onChange={(event) => setHours((prev) => ({ ...prev, [key]: event.target.value }))}
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((preset) => (
          <Button
            key={preset.label}
            type="button"
            variant="outline"
            size="xs"
            onClick={() =>
              setHours(
                Object.fromEntries(
                  WEEKDAY_KEYS.map((key, index) => [
                    key,
                    formatHours(preset.minutes[index] ?? 0, { zero: '0' }),
                  ]),
                ),
              )
            }
          >
            {preset.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
