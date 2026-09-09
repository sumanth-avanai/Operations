'use client'
import { useActionState } from 'react'
import { toast } from 'sonner'
import { changeWorkspacePassword } from '@/lib/actions/access'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FormError, FormGrid } from '@/components/shared/form'

export function PasswordForm() {
  const [state, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof changeWorkspacePassword>> | null, formData: FormData) => {
      const result = await changeWorkspacePassword(prev, formData)
      if (result.ok) {
        toast.success('Workspace password changed', {
          description: 'Everyone will need the new one next time they unlock.',
        })
      }
      return result
    },
    null,
  )
  const error = state && !state.ok ? state.error : null

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError error={error} />
      <FormGrid>
        <Field name="currentPassword" label="Current password" error={error}>
          <Input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <Field name="newPassword" label="New password" error={error} hint="At least six characters.">
          <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required />
        </Field>
      </FormGrid>
      <Button type="submit" variant="outline" disabled={pending} className="self-start">
        {pending ? 'Changing…' : 'Change password'}
      </Button>
    </form>
  )
}
