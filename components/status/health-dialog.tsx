'use client'
import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { HeartPulseIcon } from 'lucide-react'
import { recordHealthUpdate } from '@/lib/actions/health'
import {
  PROJECT_STATUSES, PROJECT_STATUS_LABELS, RISK_LABELS, RISK_LEVELS,
  type ProjectStatusName, type RiskLevelName,
} from '@/lib/domain/types'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Field, FormError, FormGrid } from '@/components/shared/form'

export function HealthDialog({
  projectId,
  projectName,
  current,
  today,
  trigger,
}: {
  projectId: string
  projectName: string
  current: { status: ProjectStatusName; risk: RiskLevelName; satisfaction: number | null } | null
  /** The workspace's day, resolved on the server. Never `new Date()` here — see lib/domain/dates. */
  today: string
  trigger?: React.ReactNode
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<string>(current?.status ?? 'on_track')
  const [risk, setRisk] = useState<string>(current?.risk ?? 'low')
  const [satisfaction, setSatisfaction] = useState<string>(
    current?.satisfaction ? String(current.satisfaction) : 'none',
  )

  const [state, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof recordHealthUpdate>> | null, formData: FormData) => {
      const result = await recordHealthUpdate(prev, formData)
      if (result.ok) {
        setOpen(false)
        toast.success('Health update recorded', {
          description: 'It is now the current status, and the previous one is kept in history.',
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
            <HeartPulseIcon />
            Log health
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Health update · {projectName}</DialogTitle>
          <DialogDescription>
            Updates are appended, never overwritten, so the history tells the story of the
            engagement.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="status" value={status} />
          <input type="hidden" name="risk" value={risk} />
          <input type="hidden" name="satisfaction" value={satisfaction} />
          <FormError error={error} />
          <FormGrid>
            <Field name="status" label="Status" error={error}>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_STATUSES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {PROJECT_STATUS_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field name="risk" label="Risk" error={error}>
              <Select value={risk} onValueChange={setRisk}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RISK_LEVELS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {RISK_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field name="satisfaction" label="Client satisfaction" error={error}>
              <Select value={satisfaction} onValueChange={setSatisfaction}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not recorded</SelectItem>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value} / 5
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field name="updateDate" label="Date" error={error}>
              <Input
                id="updateDate"
                name="updateDate"
                type="date"
                defaultValue={today}
                required
              />
            </Field>
            <Field name="comment" label="Comment" error={error} span>
              <Textarea
                id="comment"
                name="comment"
                rows={3}
                placeholder="What changed, and what happens next."
              />
            </Field>
          </FormGrid>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Record update'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
