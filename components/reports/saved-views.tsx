'use client'
import { useActionState, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { BookmarkIcon, Trash2Icon } from 'lucide-react'
import { deleteView, saveView } from '@/lib/actions/views'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { FormError } from '@/components/shared/form'

export type SavedViewRow = { id: string; name: string; config: Record<string, string> }

/**
 * A saved view is the search params that produced it, so reopening one restores the
 * range, filters and grouping exactly (FR-043).
 */
export function SavedViews({ panel, views }: { panel: 'reports' | 'billing'; views: SavedViewRow[] }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [state, action, saving] = useActionState(
    async (prev: Awaited<ReturnType<typeof saveView>> | null, formData: FormData) => {
      formData.set('config', JSON.stringify(Object.fromEntries(searchParams.entries())))
      formData.set('panel', panel)
      const result = await saveView(prev, formData)
      if (result.ok) {
        setOpen(false)
        toast.success('View saved')
        router.refresh()
      }
      return result
    },
    null,
  )
  const error = state && !state.ok ? state.error : null

  const openView = (config: Record<string, string>) => {
    const params = new URLSearchParams(config)
    router.push(`/${panel}${params.toString() ? `?${params}` : ''}`)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <BookmarkIcon />
          Views
          {views.length > 0 ? (
            <span className="text-[11px] text-muted-foreground">{views.length}</span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        {views.length > 0 ? (
          <>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Saved views
            </p>
            <ul className="mb-3 flex flex-col gap-0.5">
              {views.map((view) => (
                <li key={view.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      openView(view.config)
                      setOpen(false)
                    }}
                    className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted"
                  >
                    {view.name}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${view.name}`}
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await deleteView(view.id)
                        if (result.ok) {
                          toast.success('View removed')
                          router.refresh()
                        } else toast.error(result.error.message)
                      })
                    }
                  >
                    <Trash2Icon />
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <form action={action} className="flex flex-col gap-2 border-t pt-3">
          <Label htmlFor="view-name" className="text-[11px]">
            Save the current view
          </Label>
          <FormError error={error} />
          <div className="flex gap-2">
            <Input id="view-name" name="name" placeholder="Monthly utilisation" required className="h-8" />
            <Button type="submit" size="sm" disabled={saving}>
              Save
            </Button>
          </div>
          {error?.field === 'name' ? (
            <p role="alert" className="text-[12px] text-destructive">
              {error.message}
            </p>
          ) : null}
        </form>
      </PopoverContent>
    </Popover>
  )
}
