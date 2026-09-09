import { sql, type SQL } from 'drizzle-orm'

/**
 * The SQL twin of `amountCents()` from the domain layer.
 *
 * Money is computed in exactly two places in this codebase — TypeScript, for anything
 * derived per row, and Postgres, for aggregates over many rows. Having two
 * implementations of a price is a correctness risk, so both are defined once and
 * `tests/unit/pricing-parity.test.ts` proves they agree for the whole legal input space.
 *
 * Two details matter:
 *
 * 1. `minutes::numeric` FIRST. `minutes * rate_cents` as `integer * integer` is int4
 *    arithmetic in Postgres and overflows above 2,147,483,647 — reachable at a rate of
 *    about 14,913 per hour with a full day logged, which would raise an error rather
 *    than return a wrong number, but would still take the page down. Casting to
 *    `numeric` first makes the multiply exact and unbounded.
 * 2. `round()` on `numeric` rounds half away from zero; `Math.round` rounds half up.
 *    Those agree for non-negative values, and minutes (> 0) and rate_cents (>= 0) are
 *    both constrained non-negative in the schema, so the two never diverge.
 */
export function priceCents(entryAlias = 'te', roleAlias = 'pr'): SQL {
  return sql.raw(`round(${entryAlias}.minutes::numeric * ${roleAlias}.rate_cents / 60)`)
}

/**
 * Sums of money and minutes are cast to `bigint`, never `int`.
 *
 * `::int` caps an aggregate at 2,147,483,647 cents — 21.47M in the workspace currency —
 * which a real agency's yearly invoiced total passes. Every caller reads the result
 * through `Number()`, which is exact to 9.0e15 cents; the schema's rate ceiling keeps
 * any reachable total orders of magnitude below that.
 */
export function sumCents(expression: SQL | string): SQL {
  const inner = typeof expression === 'string' ? sql.raw(expression) : expression
  return sql`coalesce(sum(${inner}), 0)::bigint`
}

export function sumMinutes(expression: SQL | string): SQL {
  const inner = typeof expression === 'string' ? sql.raw(expression) : expression
  return sql`coalesce(sum(${inner}), 0)::bigint`
}

/** Parses a bigint aggregate, which some drivers hand back as a string. */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && value !== '') return Number(value)
  return 0
}
