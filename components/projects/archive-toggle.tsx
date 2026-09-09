'use client'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArchiveIcon, ArchiveRestoreIcon } from 'lucide-react'
import { archiveClient, archiveProject, archiveProjectRole } from '@/lib/actions/projects'
import { Button } from '@/components/ui/button'

export function ArchiveToggle({
  kind,
  id,
  name,
  archived,
  size = 'sm',
}: {
  kind: 'client' | 'project' | 'role'
  id: string
  name: string
  archived: boolean
  size?: 'xs' | 'sm'
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Button
      variant="outline"
      size={size}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result =
            kind === 'client'
              ? await archiveClient(id, !archived)
              : kind === 'project'
                ? await archiveProject(id, !archived)
                : await archiveProjectRole(id, !archived)
          if (result.ok) {
            toast.success(archived ? `${name} restored` : `${name} archived — history is kept`)
            router.refresh()
          } else {
            toast.error(result.error.message)
          }
        })
      }
    >
      {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
      {archived ? 'Restore' : 'Archive'}
    </Button>
  )
}
