'use client'
import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { PlusIcon } from 'lucide-react'
import { upsertProjectRole } from '@/lib/actions/projects'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Field, FormError, FormGrid } from '@/components/shared/form'

export type RoleFormValues = {
  id?: string
  name: string
  rate: string
  budget: string
  budgetHours: string
  sortOrder: number
}

export function RoleDialog({
  projectId,
  role,
  currency,
  defaultRate,
  nextSortOrder,
  trigger,
}: {
  projectId: string
  role?: RoleFormValues
  currency: string
  defaultRate: string
  nextSortOrder: number
  trigger?: React.ReactNode
}) {
  const router = useRouter()
  const editing = Boolean(role?.id)
  const [open, setOpen] = useState(false)

  const [state, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof upsertProjectRole>> | null, formData: FormData) => {
      const result = await upsertProjectRole(prev, formData)
      if (result.ok) {
        setOpen(false)
        toast.success(editing ? 'Role updated' : 'Role added', {
          description: result.warnings?.[0]?.message,
          duration: result.warnings?.length ? 9000 : 4000,
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
          <Button variant="outline" size="sm">
            <PlusIcon />
            Add role
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${role?.name}` : 'Add a role'}</DialogTitle>
          <DialogDescription>
            A role carries the rate and the budget. It is the only place a price lives, so correcting
            a rate re-prices all unbilled work on it.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="projectId" value={projectId} />
          {role?.id ? <input type="hidden" name="roleId" value={role.id} /> : null}
          <input type="hidden" name="sortOrder" value={role?.sortOrder ?? nextSortOrder} />
          <FormError error={error} />
          <FormGrid>
            <Field name="name" label="Role name" error={error} span>
              <Input
                id="name"
                name="name"
                defaultValue={role?.name ?? ''}
                placeholder="Senior Designer"
                required
                autoComplete="off"
              />
            </Field>
            <Field name="rateCents" label={`Hourly rate (${currency})`} error={error}>
              <Input id="rateCents" name="rateCents" defaultValue={role?.rate ?? defaultRate} inputMode="decimal" />
            </Field>
            <Field name="budgetCents" label={`Budget (${currency})`} error={error}>
              <Input id="budgetCents" name="budgetCents" defaultValue={role?.budget ?? '0'} inputMode="decimal" />
            </Field>
            <Field
              name="budgetMinutes"
              label="Budget in hours"
              error={error}
              hint="Optional cap alongside the money budget."
              span
            >
              <Input
                id="budgetMinutes"
                name="budgetMinutes"
                defaultValue={role?.budgetHours ?? ''}
                placeholder="leave empty for money only"
              />
            </Field>
          </FormGrid>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : editing ? 'Save role' : 'Add role'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
