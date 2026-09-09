/**
 * The uniform result every server action returns (contracts/server-actions.md).
 *
 * Expected outcomes never throw. Warnings ride along with a SUCCESSFUL write, because
 * guardrails coach rather than obstruct; errors refuse the write and always name the
 * offending date, member, or invoice.
 */
import type { Warning } from '@/lib/domain/guardrails'

export type ErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'locked_day'
  | 'outside_contract'
  | 'not_assigned'
  | 'already_invoiced'
  | 'conflict'
  | 'pin_invalid'
  | 'pin_throttled'
  | 'duplicate'
  | 'leave_overlap'

export type ActionError = { code: ErrorCode; message: string; field?: string }

export type ActionResult<T = undefined> =
  | { ok: true; data: T; warnings?: Warning[] }
  | { ok: false; error: ActionError }

export function ok(): ActionResult<undefined>
export function ok<T>(data: T, warnings?: Warning[]): ActionResult<T>
export function ok<T>(data?: T, warnings?: Warning[]): ActionResult<T | undefined> {
  return warnings && warnings.length > 0 ? { ok: true, data, warnings } : { ok: true, data }
}

export function fail(code: ErrorCode, message: string, field?: string): ActionResult<never> {
  return { ok: false, error: field ? { code, message, field } : { code, message } }
}

/** Turns a Zod failure into a field-keyed error without leaking library internals. */
export function failValidation(issues: { path: (string | number | symbol)[]; message: string }[]) {
  const first = issues[0]
  const field = first?.path.filter((p) => typeof p !== 'symbol').join('.') || undefined
  return fail('invalid', first?.message ?? 'That input is not valid.', field)
}
