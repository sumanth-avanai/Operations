/**
 * The billing split.
 *
 * `logged` is DEFINED as `invoiced + unbilled` rather than computed independently, so
 * the identity the whole product is trusted for cannot be broken by an arithmetic
 * mistake somewhere else. Non-billable work never enters this module at all — it is
 * excluded in the query, because `projects.billable` is the single source for that.
 */
import { amountCents } from './money'

export type BillingSplit = {
  invoicedCents: number
  unbilledCents: number
  /** Always invoiced + unbilled. */
  loggedCents: number
  invoicedMinutes: number
  unbilledMinutes: number
  loggedMinutes: number
}

export const EMPTY_SPLIT: BillingSplit = {
  invoicedCents: 0,
  unbilledCents: 0,
  loggedCents: 0,
  invoicedMinutes: 0,
  unbilledMinutes: 0,
  loggedMinutes: 0,
}

export function billingSplit(input: {
  /** Frozen amounts from invoiced entries — never re-priced. */
  invoicedCents: number
  invoicedMinutes: number
  /** Unbilled work is priced at the role's CURRENT rate, so a correction re-prices it. */
  unbilledMinutes: number
  rateCents: number
}): BillingSplit {
  const unbilledCents = amountCents(input.unbilledMinutes, input.rateCents)
  return {
    invoicedCents: input.invoicedCents,
    unbilledCents,
    loggedCents: input.invoicedCents + unbilledCents,
    invoicedMinutes: input.invoicedMinutes,
    unbilledMinutes: input.unbilledMinutes,
    loggedMinutes: input.invoicedMinutes + input.unbilledMinutes,
  }
}

/** Pre-priced parts (each role priced at its own rate) summed into one split. */
export function splitFromParts(input: {
  invoicedCents: number
  unbilledCents: number
  invoicedMinutes: number
  unbilledMinutes: number
}): BillingSplit {
  return {
    ...input,
    loggedCents: input.invoicedCents + input.unbilledCents,
    loggedMinutes: input.invoicedMinutes + input.unbilledMinutes,
  }
}

export function sumSplits(splits: readonly BillingSplit[]): BillingSplit {
  return splits.reduce<BillingSplit>(
    (acc, s) => ({
      invoicedCents: acc.invoicedCents + s.invoicedCents,
      unbilledCents: acc.unbilledCents + s.unbilledCents,
      loggedCents: acc.loggedCents + s.loggedCents,
      invoicedMinutes: acc.invoicedMinutes + s.invoicedMinutes,
      unbilledMinutes: acc.unbilledMinutes + s.unbilledMinutes,
      loggedMinutes: acc.loggedMinutes + s.loggedMinutes,
    }),
    EMPTY_SPLIT,
  )
}

/** Guard used by the verification pass: the identity must hold everywhere. */
export function splitBalances(split: BillingSplit): boolean {
  return (
    split.loggedCents === split.invoicedCents + split.unbilledCents &&
    split.loggedMinutes === split.invoicedMinutes + split.unbilledMinutes
  )
}

/** Aging buckets for unbilled work — the revenue-leakage signal from the PRD. */
export type AgingBucket = '0_30' | '31_60' | '61_90' | 'over_90'

export const AGING_LABELS: Record<AgingBucket, string> = {
  '0_30': '0–30 days',
  '31_60': '31–60 days',
  '61_90': '61–90 days',
  over_90: 'Over 90 days',
}

export function agingBucket(daysOld: number): AgingBucket {
  if (daysOld <= 30) return '0_30'
  if (daysOld <= 60) return '31_60'
  if (daysOld <= 90) return '61_90'
  return 'over_90'
}
