'use client'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Undo2Icon } from 'lucide-react'
import { unmarkInvoice } from '@/lib/actions/billing'
import { Button } from '@/components/ui/button'

export function UnmarkInvoiceButton({ invoiceId, reference }: { invoiceId: string; reference: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Button
      variant="ghost"
      size="xs"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await unmarkInvoice(invoiceId)
          if (result.ok) {
            toast.success(`${reference} reversed`, {
              description: `${result.data.entryCount} entries are unbilled again and re-price at the current rate.`,
            })
            router.refresh()
          } else toast.error(result.error.message)
        })
      }
    >
      <Undo2Icon />
      Reverse
    </Button>
  )
}
