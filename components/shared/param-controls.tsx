'use client'
/**
 * URL search parameters are this product's view state: every filter, range, grouping
 * and week lives in the address bar, so a view is shareable, bookmarkable, and
 * rendered entirely on the server (research.md D8).
 */
import { useCallback, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export function useParamNavigation() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const setParams = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') next.delete(key)
        else next.set(key, value)
      }
      const query = next.toString()
      startTransition(() => router.push(query ? `${pathname}?${query}` : pathname))
    },
    [pathname, router, searchParams],
  )

  return { setParams, pending, searchParams }
}

export function ParamSelect({
  param,
  value,
  options,
  label,
  className,
  size = 'sm',
  extraParamsToClear,
}: {
  param: string
  value: string
  options: { value: string; label: string; hint?: string }[]
  label: string
  className?: string
  size?: 'sm' | 'default'
  /** Params that no longer make sense once this one changes. */
  extraParamsToClear?: string[]
}) {
  const { setParams, pending } = useParamNavigation()
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        const updates: Record<string, string | null> = { [param]: next }
        for (const key of extraParamsToClear ?? []) updates[key] = null
        setParams(updates)
      }}
    >
      <SelectTrigger size={size} className={cn('min-w-[9rem]', className)} aria-label={label} disabled={pending}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
            {option.hint ? (
              <span className="ml-1 text-xs text-muted-foreground">{option.hint}</span>
            ) : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Previous / label / next, used by the timesheet week and the planner timeline. */
export function PeriodStepper({
  param,
  previousValue,
  nextValue,
  todayValue,
  label,
  ariaLabel,
}: {
  param: string
  previousValue: string
  nextValue: string
  todayValue?: string
  label: string
  ariaLabel: string
}) {
  const { setParams, pending } = useParamNavigation()
  return (
    <div className="flex items-center gap-1" role="group" aria-label={ariaLabel}>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Previous"
        disabled={pending}
        onClick={() => setParams({ [param]: previousValue })}
      >
        <ChevronLeftIcon />
      </Button>
      <span className="min-w-[11rem] px-1 text-center text-[13px] font-medium tnum">{label}</span>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Next"
        disabled={pending}
        onClick={() => setParams({ [param]: nextValue })}
      >
        <ChevronRightIcon />
      </Button>
      {todayValue ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setParams({ [param]: null })}
          className="ml-1"
        >
          Today
        </Button>
      ) : null}
    </div>
  )
}

export function ParamToggle({
  param,
  active,
  labelOn,
  labelOff,
}: {
  param: string
  active: boolean
  labelOn: string
  labelOff: string
}) {
  const { setParams, pending } = useParamNavigation()
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => setParams({ [param]: active ? null : '1' })}
    >
      {active ? labelOn : labelOff}
    </Button>
  )
}
