'use client'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { LockIcon } from 'lucide-react'
import { unlockWorkspace } from '@/lib/actions/access'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function UnlockForm({ next }: { next: string }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof unlockWorkspace>> | null, formData: FormData) => {
      const result = await unlockWorkspace(prev, formData)
      if (result.ok) router.replace(`/unlock?next=${encodeURIComponent(next)}`)
      return result
    },
    null,
  )

  const error = state && !state.ok ? state.error : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Unlock the workspace</CardTitle>
        <CardDescription>
          Internal staff share one password, then choose who they are working as.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Workspace password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? 'password-error' : undefined}
            />
            {error ? (
              <p id="password-error" role="alert" className="text-[13px] text-destructive">
                {error.message}
              </p>
            ) : null}
          </div>
          <Button type="submit" disabled={pending}>
            <LockIcon />
            {pending ? 'Checking…' : 'Unlock'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
