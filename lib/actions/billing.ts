'use server'
import { eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { invoices, projects, timeEntries } from '@/lib/db/schema'
import { isUniqueViolation } from '@/lib/db/errors'
import { requireCapability } from '@/lib/auth/context'
import { isoDate, optionalText, readId, uuid } from '@/lib/validation/schemas'
import { fail, failValidation, ok, type ActionResult } from './result'
import { priceCents, toNumber } from '@/lib/db/sql-money'

const markSchema = z
  .object({
    reference: z.string().trim().min(1, 'An invoice reference is required.').max(64),
    issuedDate: isoDate,
    periodStart: isoDate,
    periodEnd: isoDate,
    projectId: uuid,
    note: optionalText(1000),
  })
  .refine((v) => v.periodEnd >= v.periodStart, {
    message: 'The period end cannot be before the start.',
    path: ['periodEnd'],
  })

/**
 * Marks every unbilled billable entry for one project in one period as invoiced.
 *
 * One transaction: create the invoice, freeze each entry's amount at the role's current
 * rate, link them. Those entries become immutable afterwards, which is what makes the
 * frozen amount safe to store (data-model.md, Deliberate caches).
 */
export async function markInvoiced(
  _prev: ActionResult<{ invoiceId: string; amountCents: number; entryCount: number }> | null,
  formData: FormData,
): Promise<ActionResult<{ invoiceId: string; amountCents: number; entryCount: number }>> {
  const guard = await requireCapability('manage_billing')
  if (!('ctx' in guard)) return guard

  const parsed = markSchema.safeParse({
    reference: String(formData.get('reference') ?? ''),
    issuedDate: String(formData.get('issuedDate') ?? ''),
    periodStart: String(formData.get('periodStart') ?? ''),
    periodEnd: String(formData.get('periodEnd') ?? ''),
    projectId: String(formData.get('projectId') ?? ''),
    note: String(formData.get('note') ?? ''),
  })
  if (!parsed.success) return failValidation(parsed.error.issues)
  const input = parsed.data

  const db = await getDb()
  const project = (
    await db
      .select({ id: projects.id, name: projects.name, billable: projects.billable })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1)
  )[0]
  if (!project) return fail('not_found', 'That project no longer exists.')
  if (!project.billable) {
    return fail('invalid', `${project.name} is non-billable, so there is nothing to invoice.`)
  }

  // A fast pre-check purely so the refusal can name the project and the dates. The
  // authoritative set is the UPDATE below, inside the transaction.
  const pending = await db.execute<{ n: number }>(sql`
    select count(*)::int as n
    from time_entries te
    join project_roles pr on pr.id = te.project_role_id
    where pr.project_id = ${input.projectId}
      and te.entry_date between ${input.periodStart} and ${input.periodEnd}
      and te.invoice_id is null
  `)
  if (Number((pending.rows as unknown as { n: number }[])[0]?.n ?? 0) === 0) {
    return fail(
      'invalid',
      `${project.name} has no unbilled work between ${input.periodStart} and ${input.periodEnd}.`,
    )
  }

  try {
    let invoiceId = ''
    let total = 0
    let entryCount = 0

    await db.transaction(async (tx) => {
      // The invoice is created with a zero total and then set from the rows it actually
      // billed. Computing the total from a separate SELECT beforehand would leave a
      // window in which a concurrent time entry joins the scope, gets linked by the
      // UPDATE, and is missing from the stored amount — so the invoice would disagree
      // with its own entries. Deriving it from the UPDATE's RETURNING closes that.
      const inserted = await tx
        .insert(invoices)
        .values({
          reference: input.reference,
          issuedDate: input.issuedDate,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          projectId: input.projectId,
          amountCents: 0,
          note: input.note,
        })
        .returning({ id: invoices.id })
      invoiceId = inserted[0]!.id

      // Guarded by `invoice_id is null`, so two people invoicing the same scope at once
      // cannot double-bill: the second finds nothing left to link.
      const linked = await tx.execute<{ amount: number | string }>(sql`
        update time_entries te
        set invoice_id = ${invoiceId},
            invoiced_amount_cents = ${priceCents()}::bigint
        from project_roles pr
        where pr.id = te.project_role_id
          and pr.project_id = ${input.projectId}
          and te.entry_date between ${input.periodStart} and ${input.periodEnd}
          and te.invoice_id is null
        returning te.invoiced_amount_cents as amount
      `)

      const rows = linked.rows as unknown as { amount: number | string }[]
      entryCount = rows.length
      total = rows.reduce((sum, row) => sum + toNumber(row.amount), 0)

      if (entryCount === 0) throw new NothingToBill()

      await tx.update(invoices).set({ amountCents: total }).where(eq(invoices.id, invoiceId))
    })

    for (const path of ['/', '/billing', '/reports', '/status', '/projects', `/projects/${input.projectId}`]) {
      revalidatePath(path)
    }
    return ok({ invoiceId, amountCents: total, entryCount })
  } catch (error) {
    if (error instanceof NothingToBill) {
      return fail(
        'invalid',
        `${project.name} has no unbilled work between ${input.periodStart} and ${input.periodEnd}. Somebody may have invoiced it a moment ago.`,
      )
    }
    if (isUniqueViolation(error, 'invoices_reference_unique')) {
      return fail('duplicate', `Invoice reference ${input.reference} is already used.`, 'reference')
    }
    throw error
  }
}

/** Rolls the invoice back when the guarded UPDATE finds nothing left to bill. */
class NothingToBill extends Error {
  constructor() {
    super('nothing to bill')
    this.name = 'NothingToBill'
  }
}

/**
 * The only way to correct a mis-invoicing: explicit, not an edit. Returns those entries
 * to unbilled so they re-price at the current rate.
 */
export async function unmarkInvoice(invoiceId: string): Promise<ActionResult<{ entryCount: number }>> {
  const guard = await requireCapability('manage_billing')
  if (!('ctx' in guard)) return guard

  const id = readId(invoiceId)
  if (!id) return fail('not_found', 'That invoice could not be identified.')

  const db = await getDb()
  const invoice = (
    await db
      .select({ id: invoices.id, reference: invoices.reference, projectId: invoices.projectId })
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1)
  )[0]
  if (!invoice) return fail('not_found', 'That invoice no longer exists.')

  let entryCount = 0
  await db.transaction(async (tx) => {
    const cleared = await tx
      .update(timeEntries)
      .set({ invoiceId: null, invoicedAmountCents: null })
      .where(eq(timeEntries.invoiceId, id))
      .returning({ id: timeEntries.id })
    entryCount = cleared.length
    await tx.delete(invoices).where(eq(invoices.id, id))
  })

  for (const path of ['/', '/billing', '/reports', '/status', '/projects']) revalidatePath(path)
  if (invoice.projectId) revalidatePath(`/projects/${invoice.projectId}`)
  return ok({ entryCount })
}
