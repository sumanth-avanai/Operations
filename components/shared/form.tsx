'use client'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'
import type { ActionError } from '@/lib/actions/result'

export function FormGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid gap-4 sm:grid-cols-2', className)}>{children}</div>
}

export function Field({
  name,
  label,
  hint,
  error,
  children,
  className,
  span,
}: {
  name: string
  label: string
  hint?: string
  error?: ActionError | null
  children: React.ReactNode
  className?: string
  span?: boolean
}) {
  const showError = error?.field === name ? error.message : null
  return (
    <div className={cn('flex flex-col gap-1.5', span && 'sm:col-span-2', className)}>
      <Label htmlFor={name}>{label}</Label>
      {children}
      {showError ? (
        <p role="alert" className="text-[13px] text-destructive">
          {showError}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

/** A refusal that is not tied to one field. */
export function FormError({ error }: { error?: ActionError | null }) {
  if (!error || error.field) return null
  return (
    <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
      {error.message}
    </p>
  )
}
