'use client'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArchiveIcon, ArchiveRestoreIcon } from 'lucide-react'
import { archiveMember } from '@/lib/actions/members'
import { Button } from '@/components/ui/button'

export function ArchiveMemberButton({
  memberId,
  memberName,
  archived,
}: {
  memberId: string
  memberName: string
  archived: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await archiveMember(memberId, !archived)
          if (result.ok) {
            toast.success(
              archived
                ? `${memberName} is active again`
                : `${memberName} archived — their history and invoiced work are kept`,
            )
            router.refresh()
          } else toast.error(result.error.message)
        })
      }
    >
      {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
      {archived ? 'Restore' : 'Archive'}
    </Button>
  )
}
