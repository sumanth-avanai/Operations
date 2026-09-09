'use client'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRoundIcon } from 'lucide-react'
import { verifyPortalPin } from '@/lib/actions/access'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function PinForm({
  token,
  lockedUntil,
  hasPin,
}: {
  token: string
  lockedUntil: string | null
  hasPin: boolean
}) {
  const router = useRouter()
  const [state, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof verifyPortalPin>> | null, formData: FormData) => {
      const result = await verifyPortalPin(prev, formData)
      if (result.ok) router.refresh()
      return result
    },
    null,
  )
  const error = state && !state.ok ? state.error : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your timesheet</CardTitle>
        <CardDescription>
          {hasPin
            ? 'Enter your PIN to open your own week. You will only ever see your own hours.'
            : 'No PIN has been set for this link yet. Ask your operations lead to set one.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="token" value={token} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="pin">PIN</Label>
            <Input
              id="pin"
              name="pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              required
              disabled={!hasPin || Boolean(lockedUntil)}
              className="tracking-[0.4em]"
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? 'pin-error' : undefined}
            />
            {error ? (
              <p id="pin-error" role="alert" className="text-[13px] text-destructive">
                {error.message}
              </p>
            ) : null}
            {lockedUntil ? (
              <p className="text-[13px] text-warn">
                Too many attempts. This link is paused for a few minutes.
              </p>
            ) : null}
          </div>
          <Button type="submit" disabled={pending || !hasPin || Boolean(lockedUntil)}>
            <KeyRoundIcon />
            {pending ? 'Checking…' : 'Open my timesheet'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
