/**
 * Shared Zod schemas. Every server action validates through one of these before it
 * touches anything, and the parsers convert display units (hours, currency) into the
 * integer minutes and cents the database stores.
 */
import { z } from 'zod'
import { isISODate, isTimeZone } from '@/lib/domain/dates'
import { parseHoursInput, parseMoneyInput } from '@/lib/domain/money'
import {
  BILLING_METHODS, BOOKING_STATUSES, LEAVE_PORTIONS, LEAVE_TYPES, MEMBER_ROLES, PROJECT_STATUSES,
  RISK_LEVELS,
  WEEKDAY_KEYS,
} from '@/lib/domain/types'

export const isoDate = z
  .string()
  .refine(isISODate, 'Use a real calendar date.')

export const uuid = z.uuid('That record could not be identified.')

/**
 * An IANA time zone this runtime can actually resolve, e.g. 'Europe/Berlin'.
 *
 * Checked here rather than in the database, because Postgres cannot tell a real zone
 * name from a typo and an unresolvable one would otherwise be written once and then
 * quietly change what the whole workspace calls today.
 */
export const timeZoneSchema = z
  .string()
  .trim()
  .min(1, 'Choose a time zone.')
  .max(64)
  .refine(isTimeZone, 'That is not a time zone this server knows.')

/**
 * Validates an id that arrives as a bare action argument rather than in a form.
 *
 * Every export of a `'use server'` module is an endpoint the browser can call with any
 * value at all, so an id has to be checked even when the query that uses it is
 * parameterised — otherwise a malformed one reaches Postgres and comes back as a driver
 * error instead of a clean refusal.
 */
export function readId(value: unknown): string | null {
  const parsed = uuid.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** Hours typed by a person ('7.5', '7:30', '90m') into exact minutes. */
export const minutesFromInput = (max = 1440) =>
  z
    .string()
    .transform((raw, ctx) => {
      const minutes = parseHoursInput(raw)
      if (minutes === null) {
        ctx.addIssue({ code: 'custom', message: `"${raw}" is not a number of hours.` })
        return z.NEVER
      }
      return minutes
    })
    .pipe(z.number().int().min(0).max(max, `That is more than ${max / 60} hours.`))

/** Money typed by a person into exact cents. */
export const centsFromInput = z
  .string()
  .transform((raw, ctx) => {
    const cents = parseMoneyInput(raw)
    if (cents === null) {
      ctx.addIssue({ code: 'custom', message: `"${raw}" is not an amount.` })
      return z.NEVER
    }
    return cents
  })
  .pipe(z.number().int().min(0, 'Amounts cannot be negative.'))

export const workingMinutesSchema = z.object({
  mon: z.number().int().min(0).max(1440),
  tue: z.number().int().min(0).max(1440),
  wed: z.number().int().min(0).max(1440),
  thu: z.number().int().min(0).max(1440),
  fri: z.number().int().min(0).max(1440),
  sat: z.number().int().min(0).max(1440),
  sun: z.number().int().min(0).max(1440),
})

/** Reads mon…sun hour fields off a form into the stored minutes shape. */
export function workingMinutesFromForm(formData: FormData) {
  const out: Record<string, number> = {}
  for (const key of WEEKDAY_KEYS) {
    const raw = String(formData.get(`workingMinutes.${key}`) ?? '0')
    out[key] = parseHoursInput(raw) ?? 0
  }
  return out
}

export const memberRoleSchema = z.enum(MEMBER_ROLES)
export const billingMethodSchema = z.enum(BILLING_METHODS)
export const projectStatusSchema = z.enum(PROJECT_STATUSES)
export const riskLevelSchema = z.enum(RISK_LEVELS)
export const leaveTypeSchema = z.enum(LEAVE_TYPES)
export const leavePortionSchema = z.enum(LEAVE_PORTIONS)
export const bookingStatusSchema = z.enum(BOOKING_STATUSES)

export const colorSchema = z
  .string()
  .regex(/^(var\(--hue-[1-8]\)|#[0-9a-fA-F]{6})$/, 'Pick one of the workspace colours.')

export const optionalText = (max = 2000) =>
  z
    .string()
    .max(max)
    .transform((v) => (v.trim() === '' ? null : v.trim()))
    .nullable()

/** Form checkbox semantics: absent means false. */
export function boolFromForm(formData: FormData, name: string): boolean {
  const value = formData.get(name)
  return value === 'on' || value === 'true' || value === '1'
}

export function nullableDateFromForm(formData: FormData, name: string): string | null {
  const raw = String(formData.get(name) ?? '').trim()
  return raw === '' ? null : raw
}
