'use client'
import { useState } from 'react'
import { CheckIcon } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

const HUES = Array.from({ length: 8 }, (_, i) => `var(--hue-${i + 1})`)

export function ColorPicker({
  name = 'color',
  label = 'Colour',
  defaultValue,
}: {
  name?: string
  label?: string
  defaultValue?: string
}) {
  const [value, setValue] = useState(defaultValue ?? HUES[0]!)
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${name}-picker`}>{label}</Label>
      <input type="hidden" name={name} value={value} />
      <div id={`${name}-picker`} role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {HUES.map((hue) => (
          <button
            key={hue}
            type="button"
            role="radio"
            aria-checked={value === hue}
            aria-label={hue}
            onClick={() => setValue(hue)}
            className={cn(
              'flex size-7 items-center justify-center rounded-full transition-transform',
              value === hue ? 'ring-2 ring-ring ring-offset-2 ring-offset-background' : 'hover:scale-110',
            )}
            style={{ backgroundColor: hue }}
          >
            {value === hue ? <CheckIcon className="size-3.5 text-white" /> : null}
          </button>
        ))}
      </div>
    </div>
  )
}
