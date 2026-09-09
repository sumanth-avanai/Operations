/**
 * Role budget consumption.
 *
 * Delivered work supersedes the plan minute for minute on the day it was logged, so
 * planned and delivered can never double count (see `plan.ts` for that arithmetic).
 *
 * Only `committedMinutes` — the shortfall on days from today onward — is spend.
 * `staleMinutes` is the shortfall on days already gone: it is reported so it can be
 * re-planned or written off, and it is deliberately absent from `remainingCents`.
 * Charging it would keep a booking nobody delivered consuming its budget forever.
 */
import { amountCents, percentOf } from './money'

export type RoleBudgetInput = {
  budgetCents: number
  rateCents: number
  /** Frozen amounts of this role's already-invoiced entries. */
  invoicedCents: number
  /** Minutes on this role that are logged but not yet invoiced. */
  unbilledMinutes: number
  /** Confirmed shortfall on days from today onward. This is what consumes budget. */
  committedMinutes: number
  /** Tentative booked minutes, tracked but excluded from committed spend. */
  tentativeMinutes?: number
  /** Confirmed shortfall on days already past. Reported, never spent. */
  staleMinutes?: number
}

export type RoleBudget = {
  budgetCents: number
  deliveredCents: number
  committedCents: number
  tentativeCents: number
  /** Plan that was never delivered on days now past. Flagged for re-planning, not spend. */
  staleCents: number
  /** budget - delivered - committed. Stale plan is excluded on purpose. */
  remainingCents: number
  /** Delivered as a share of budget, null when there is no budget. */
  deliveredPct: number | null
  /** Delivered + committed as a share of budget. */
  consumedPct: number | null
  overBudget: boolean
  /** Over-committed rather than over-delivered: the plan is what breaks it. */
  overCommitted: boolean
}

export function roleBudget(input: RoleBudgetInput): RoleBudget {
  const { budgetCents, rateCents, invoicedCents, unbilledMinutes, committedMinutes } = input
  const deliveredCents = invoicedCents + amountCents(unbilledMinutes, rateCents)
  const committedCents = amountCents(committedMinutes, rateCents)
  const tentativeCents = amountCents(input.tentativeMinutes ?? 0, rateCents)
  const staleCents = amountCents(input.staleMinutes ?? 0, rateCents)
  const remainingCents = budgetCents - deliveredCents - committedCents
  return {
    budgetCents,
    deliveredCents,
    committedCents,
    tentativeCents,
    staleCents,
    remainingCents,
    deliveredPct: percentOf(deliveredCents, budgetCents),
    consumedPct: percentOf(deliveredCents + committedCents, budgetCents),
    overBudget: deliveredCents > budgetCents,
    overCommitted: remainingCents < 0 && deliveredCents <= budgetCents,
  }
}

/** A project's budget is the sum of its roles' budgets — never a separate figure. */
export function rollUpBudgets(roles: readonly RoleBudget[]): RoleBudget {
  const zero: RoleBudget = {
    budgetCents: 0,
    deliveredCents: 0,
    committedCents: 0,
    tentativeCents: 0,
    staleCents: 0,
    remainingCents: 0,
    deliveredPct: null,
    consumedPct: null,
    overBudget: false,
    overCommitted: false,
  }
  const summed = roles.reduce(
    (acc, role) => ({
      ...acc,
      budgetCents: acc.budgetCents + role.budgetCents,
      deliveredCents: acc.deliveredCents + role.deliveredCents,
      committedCents: acc.committedCents + role.committedCents,
      tentativeCents: acc.tentativeCents + role.tentativeCents,
      staleCents: acc.staleCents + role.staleCents,
    }),
    zero,
  )
  const remainingCents = summed.budgetCents - summed.deliveredCents - summed.committedCents
  return {
    ...summed,
    remainingCents,
    deliveredPct: percentOf(summed.deliveredCents, summed.budgetCents),
    consumedPct: percentOf(summed.deliveredCents + summed.committedCents, summed.budgetCents),
    overBudget: summed.deliveredCents > summed.budgetCents,
    overCommitted: remainingCents < 0 && summed.deliveredCents <= summed.budgetCents,
  }
}

export type BudgetBand = 'none' | 'healthy' | 'tight' | 'exhausted' | 'over'

export function budgetBand(budget: RoleBudget): BudgetBand {
  if (budget.budgetCents === 0) return 'none'
  if (budget.overBudget) return 'over'
  if (budget.remainingCents < 0) return 'exhausted'
  const consumed = budget.consumedPct ?? 0
  return consumed >= 85 ? 'tight' : 'healthy'
}

export const BUDGET_BAND_STYLE: Record<BudgetBand, { color: string; soft: string; label: string }> = {
  none: { color: 'var(--idle)', soft: 'var(--idle-soft)', label: 'No budget set' },
  healthy: { color: 'var(--ok)', soft: 'var(--ok-soft)', label: 'Within budget' },
  tight: { color: 'var(--warn)', soft: 'var(--warn-soft)', label: 'Nearly committed' },
  exhausted: { color: 'var(--danger)', soft: 'var(--danger-soft)', label: 'Over-committed' },
  over: { color: 'var(--danger)', soft: 'var(--danger-soft)', label: 'Over budget' },
}
