'use client'
import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ReceiptTextIcon } from 'lucide-react'
import { markInvoiced } from '@/lib/actions/billing'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FormError, FormGrid } from '@/components/shared/form'

export function InvoiceDialog({
  projectId,
  projectName,
  periodStart,
  periodEnd,
  amountLabel,
  entryCount,
  suggestedReference,
  today,
  trigger,
}: {
  projectId: string
  projectName: string
  periodStart: string
  periodEnd: string
  amountLabel: string
  entryCount: number
  suggestedReference: string
  /** The workspace's day, resolved on the server. Never `new Date()` here — see lib/domain/dates. */
  today: string
  trigger?: React.ReactNode
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const [state, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof markInvoiced>> | null, formData: FormData) => {
      const result = await markInvoiced(prev, formData)
      if (result.ok) {
        setOpen(false)
        toast.success(`Invoiced ${result.data.entryCount} entries`, {
          description: 'Those hours are now locked against edits and moved to invoiced.',
        })
        router.refresh()
      }
      return result
    },
    null,
  )
  const error = state && !state.ok ? state.error : null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <ReceiptTextIcon />
            Mark invoiced
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark {projectName} invoiced</DialogTitle>
          <DialogDescription>
            {entryCount} unbilled {entryCount === 1 ? 'entry' : 'entries'} worth {amountLabel} between{' '}
            {periodStart} and {periodEnd}. Each amount is frozen at the current rate, and those hours
            can no longer be edited.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="periodStart" value={periodStart} />
          <input type="hidden" name="periodEnd" value={periodEnd} />
          <FormError error={error} />
          <FormGrid>
            <Field name="reference" label="Invoice reference" error={error}>
              <Input
                id="reference"
                name="reference"
                defaultValue={suggestedReference}
                required
                autoComplete="off"
              />
            </Field>
            <Field name="issuedDate" label="Issued" error={error}>
              <Input
                id="issuedDate"
                name="issuedDate"
                type="date"
                defaultValue={today}
                required
              />
            </Field>
            <Field name="note" label="Note" error={error} span>
              <Textarea id="note" name="note" rows={2} placeholder="Anything finance should know." />
            </Field>
          </FormGrid>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Invoicing…' : `Invoice ${amountLabel}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
