import { BUDGET_BAND_STYLE, budgetBand, type RoleBudget } from '@/lib/domain/budget'
import { Meter } from './meter'
import { cn } from '@/lib/utils'

/**
 * Delivered, committed and remaining on one bar, so a role and a whole project read
 * the same way. Committed is drawn lighter — it is a plan, not a fact.
 */
export function BudgetBar({
  budget,
  money,
  className,
  compact,
}: {
  budget: RoleBudget
  money: (cents: number) => string
  className?: string
  compact?: boolean
}) {
  const band = budgetBand(budget)
  const style = BUDGET_BAND_STYLE[band]
  const max = budget.budgetCents || budget.deliveredCents + budget.committedCents || 1
  const deliveredPct = Math.min(100, (budget.deliveredCents / max) * 100)
  const committedPct = Math.min(100 - deliveredPct, (budget.committedCents / max) * 100)
  const over = budget.remainingCents < 0

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {!compact ? (
        <div className="flex items-baseline justify-between gap-2 text-[11px]">
          <span className="text-muted-foreground">
            {money(budget.deliveredCents)} delivered
            {budget.committedCents > 0 ? ` · ${money(budget.committedCents)} committed` : ''}
          </span>
          <span className="font-semibold tnum" style={{ color: over ? 'var(--danger)' : undefined }}>
            {budget.budgetCents === 0
              ? 'no budget'
              : over
                ? `${money(Math.abs(budget.remainingCents))} over`
                : `${money(budget.remainingCents)} left`}
          </span>
        </div>
      ) : null}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0"
          style={{ width: `${deliveredPct}%`, backgroundColor: style.color }}
        />
        <div
          className="absolute inset-y-0"
          style={{
            left: `${deliveredPct}%`,
            width: `${committedPct}%`,
            backgroundColor: style.color,
            opacity: 0.4,
          }}
        />
        {over ? (
          <div
            className="absolute inset-y-0 right-0 w-1.5"
            style={{ backgroundColor: 'var(--danger)' }}
            title="Over budget"
          />
        ) : null}
      </div>
      {!compact ? (
        <div className="flex items-baseline justify-between text-[10px] text-muted-foreground">
          <span>{style.label}</span>
          <span className="tnum">
            {budget.budgetCents === 0 ? '' : `${money(budget.budgetCents)} budget`}
          </span>
        </div>
      ) : null}
    </div>
  )
}

/** Just the meter, for dense tables. */
export function BudgetMeter({ budget }: { budget: RoleBudget }) {
  const style = BUDGET_BAND_STYLE[budgetBand(budget)]
  return (
    <Meter
      value={budget.deliveredCents + budget.committedCents}
      max={budget.budgetCents || 1}
      color={style.color}
      height={6}
      label="Budget consumed"
    />
  )
}
