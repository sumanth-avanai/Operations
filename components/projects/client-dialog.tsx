'use client'
import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { PlusIcon } from 'lucide-react'
import { createClient, updateClient } from '@/lib/actions/projects'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FormError, FormGrid } from '@/components/shared/form'
import { ColorPicker } from '@/components/shared/color-picker'

export type ClientFormValues = {
  id?: string
  name: string
  color: string
  contactEmail: string | null
  notes: string | null
}

export function ClientDialog({
  client,
  trigger,
  defaultOpen,
}: {
  client?: ClientFormValues
  trigger?: React.ReactNode
  defaultOpen?: boolean
}) {
  const router = useRouter()
  const editing = Boolean(client?.id)
  const [open, setOpen] = useState(defaultOpen ?? false)

  const [state, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof createClient>> | Awaited<ReturnType<typeof updateClient>> | null, formData: FormData) => {
      const result = editing ? await updateClient(null, formData) : await createClient(null, formData)
      if (result.ok) {
        setOpen(false)
        toast.success(editing ? 'Client updated' : 'Client added')
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
          <Button variant="outline" size="sm">
            <PlusIcon />
            Add client
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${client?.name}` : 'Add a client'}</DialogTitle>
          <DialogDescription>Projects belong to a client, and billing rolls up to them.</DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-4">
          {client?.id ? <input type="hidden" name="clientId" value={client.id} /> : null}
          <FormError error={error} />
          <FormGrid>
            <Field name="name" label="Client name" error={error} span>
              <Input id="name" name="name" defaultValue={client?.name ?? ''} required autoComplete="off" />
            </Field>
            <Field name="contactEmail" label="Contact email" error={error}>
              <Input id="contactEmail" name="contactEmail" type="email" defaultValue={client?.contactEmail ?? ''} />
            </Field>
            <ColorPicker defaultValue={client?.color ?? 'var(--hue-2)'} />
            <Field name="notes" label="Notes" error={error} span>
              <Textarea id="notes" name="notes" rows={2} defaultValue={client?.notes ?? ''} />
            </Field>
          </FormGrid>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : editing ? 'Save changes' : 'Add client'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
