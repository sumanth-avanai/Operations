'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckIcon, CopyIcon, KeyRoundIcon, LinkIcon, ShieldOffIcon } from 'lucide-react'
import { resetMemberPin, setPortalRevoked } from '@/lib/actions/access'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

/**
 * The account-free access controls for one member: their private link, a PIN reset that
 * takes effect immediately, and revocation that keeps all their logged history.
 */
export function PortalLink({
  memberId,
  memberName,
  token,
  revoked,
  hasPin,
  canManage,
}: {
  memberId: string
  memberName: string
  /** null when the acting role may not see this credential. */
  token: string | null
  revoked: boolean
  hasPin: boolean
  canManage: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [copied, setCopied] = useState(false)
  const [newPin, setNewPin] = useState<string | null>(null)
  const path = token ? `/portal/${token}` : null

  const copy = async () => {
    if (!path) return
    const url = `${window.location.origin}${path}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast.success('Private link copied')
    } catch {
      toast.error('Could not copy', { description: url })
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <LinkIcon className="size-4 text-muted-foreground" />
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 text-[12px]">
          {path ?? '/portal/••••••••••••••••••••'}
        </code>
        {path ? (
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        ) : null}
        {revoked ? (
          <Badge variant="danger">Revoked</Badge>
        ) : hasPin ? (
          <Badge variant="ok">Active</Badge>
        ) : (
          <Badge variant="warn">No PIN set</Badge>
        )}
      </div>

      {newPin ? (
        <div className="flex items-center gap-2 rounded-lg bg-ok-soft px-3 py-2 text-[13px]">
          <span className="text-foreground/90">
            New PIN for {memberName}: <strong className="tnum tracking-[0.2em]">{newPin}</strong> — share
            it with them now, it is not shown again.
          </span>
        </div>
      ) : null}

      {!token ? (
        <p className="text-xs text-muted-foreground">
          The link itself is a credential, so it is only shown to the roles that manage
          members.
        </p>
      ) : null}

      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await resetMemberPin(memberId)
                if (result.ok) {
                  setNewPin(result.data.pin)
                  toast.success('PIN reset — the previous one stopped working immediately')
                  router.refresh()
                } else {
                  toast.error(result.error.message)
                }
              })
            }
          >
            <KeyRoundIcon />
            Reset PIN
          </Button>
          <Button
            variant={revoked ? 'outline' : 'destructive'}
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await setPortalRevoked(memberId, !revoked)
                if (result.ok) {
                  toast.success(revoked ? 'Access restored' : 'Access revoked — their history is kept')
                  router.refresh()
                } else {
                  toast.error(result.error.message)
                }
              })
            }
          >
            <ShieldOffIcon />
            {revoked ? 'Restore access' : 'Revoke access'}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Only an Owner/Admin can reset a PIN or revoke a link.
        </p>
      )}
    </div>
  )
}
