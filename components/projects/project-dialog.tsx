'use client'
import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { PlusIcon } from 'lucide-react'
import { createProject, updateProject } from '@/lib/actions/projects'
import { BILLING_METHODS, BILLING_METHOD_LABELS, type BillingMethodName } from '@/lib/domain/types'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Field, FormError, FormGrid } from '@/components/shared/form'
import { ColorPicker } from '@/components/shared/color-picker'

export type ProjectFormValues = {
  id?: string
  clientId: string
  name: string
  code: string | null
  color: string
  billable: boolean
  billingMethod: BillingMethodName
  startDate: string | null
  endDate: string | null
  ownerMemberId: string | null
  notes: string | null
}

export function ProjectDialog({
  clients,
  managers,
  project,
  defaultClientId,
  trigger,
  defaultOpen,
}: {
  clients: { id: string; name: string }[]
  managers: { id: string; name: string }[]
  project?: ProjectFormValues
  defaultClientId?: string
  trigger?: React.ReactNode
  defaultOpen?: boolean
}) {
  const router = useRouter()
  const editing = Boolean(project?.id)
  const [open, setOpen] = useState(defaultOpen ?? false)
  const [clientId, setClientId] = useState(project?.clientId ?? defaultClientId ?? clients[0]?.id ?? '')
  const [billingMethod, setBillingMethod] = useState<string>(project?.billingMethod ?? 'time_and_materials')
  const [owner, setOwner] = useState<string>(project?.ownerMemberId ?? 'none')
  const [billable, setBillable] = useState(project?.billable ?? true)

  const [state, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof createProject>> | Awaited<ReturnType<typeof updateProject>> | null, formData: FormData) => {
      const result = editing ? await updateProject(null, formData) : await createProject(null, formData)
      if (result.ok) {
        setOpen(false)
        toast.success(editing ? 'Project updated' : 'Project created', {
          description: result.warnings?.[0]?.message,
          duration: result.warnings?.length ? 9000 : 4000,
        })
        router.refresh()
        if (!editing && result.data && 'projectId' in result.data) {
          router.push(`/projects/${result.data.projectId}`)
        }
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
            <PlusIcon />
            Add project
          </Button>
        )}
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${project?.name}` : 'Create a project'}</DialogTitle>
          <DialogDescription>
            Budgets live on the roles you add next — a project&apos;s budget is always the sum of its
            roles.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-4">
          {project?.id ? <input type="hidden" name="projectId" value={project.id} /> : null}
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="billingMethod" value={billingMethod} />
          <input type="hidden" name="ownerMemberId" value={owner} />
          <input type="hidden" name="billable" value={billable ? 'on' : 'off'} />

          <FormError error={error} />
          <FormGrid>
            <Field name="clientId" label="Client" error={error}>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a client" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field name="name" label="Project name" error={error}>
              <Input id="name" name="name" defaultValue={project?.name ?? ''} required autoComplete="off" />
            </Field>

            <Field name="code" label="Code" error={error} hint="Short reference used on invoices.">
              <Input id="code" name="code" defaultValue={project?.code ?? ''} placeholder="HB-ONB" />
            </Field>
            <Field name="billingMethod" label="Billing method" error={error}>
              <Select value={billingMethod} onValueChange={setBillingMethod}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_METHODS.map((method) => (
                    <SelectItem key={method} value={method}>
                      {BILLING_METHOD_LABELS[method]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field name="startDate" label="Start date" error={error}>
              <Input id="startDate" name="startDate" type="date" defaultValue={project?.startDate ?? ''} />
            </Field>
            <Field name="endDate" label="End date" error={error}>
              <Input id="endDate" name="endDate" type="date" defaultValue={project?.endDate ?? ''} />
            </Field>

            <Field
              name="ownerMemberId"
              label="Project manager"
              error={error}
              hint="A Project Manager can only touch the engagements they own."
            >
              <Select value={owner} onValueChange={setOwner}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {managers.map((manager) => (
                    <SelectItem key={manager.id} value={manager.id}>
                      {manager.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <ColorPicker defaultValue={project?.color ?? 'var(--hue-3)'} />

            <div className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5 sm:col-span-2">
              <Switch id="billable-switch" checked={billable} onCheckedChange={setBillable} />
              <div>
                <Label htmlFor="billable-switch" className="cursor-pointer">
                  Billable work
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Non-billable projects never appear in billing figures, and their hours are excluded
                  from billable utilization.
                </p>
              </div>
            </div>

            <Field name="notes" label="Notes" error={error} span>
              <Textarea id="notes" name="notes" rows={2} defaultValue={project?.notes ?? ''} />
            </Field>
          </FormGrid>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !clientId}>
              {pending ? 'Saving…' : editing ? 'Save changes' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
