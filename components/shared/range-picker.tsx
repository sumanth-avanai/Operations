'use client'
import { useState } from 'react'
import { CalendarIcon } from 'lucide-react'
import { RANGE_PRESETS, RANGE_PRESET_LABELS } from '@/lib/domain/dates'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useParamNavigation } from './param-controls'
import { cn } from '@/lib/utils'

export function RangePicker({
  preset,
  from,
  to,
  label,
}: {
  preset: string
  from: string
  to: string
  label: string
}) {
  const { setParams, pending } = useParamNavigation()
  const [open, setOpen] = useState(false)
  const [customFrom, setCustomFrom] = useState(from)
  const [customTo, setCustomTo] = useState(to)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={pending}>
          <CalendarIcon />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Ready-made ranges
        </p>
        <div className="grid grid-cols-2 gap-1">
          {RANGE_PRESETS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setParams({ preset: option, from: null, to: null })
                setOpen(false)
              }}
              className={cn(
                'rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-muted',
                preset === option && 'bg-accent text-accent-foreground font-medium',
              )}
            >
              {RANGE_PRESET_LABELS[option]}
            </button>
          ))}
        </div>
        <div className="mt-3 border-t pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Custom
          </p>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="range-from" className="mb-1 text-[11px]">
                From
              </Label>
              <Input
                id="range-from"
                type="date"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
                className="h-8"
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="range-to" className="mb-1 text-[11px]">
                To
              </Label>
              <Input
                id="range-to"
                type="date"
                value={customTo}
                onChange={(event) => setCustomTo(event.target.value)}
                className="h-8"
              />
            </div>
          </div>
          <Button
            size="sm"
            className="mt-2 w-full"
            onClick={() => {
              setParams({ from: customFrom, to: customTo, preset: null })
              setOpen(false)
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
