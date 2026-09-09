'use client'
import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { updateWorkspaceSettings } from '@/lib/actions/settings'
import { BILLING_METHODS, BILLING_METHOD_LABELS, type BillingMethodName } from '@/lib/domain/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Field, FormError, FormGrid } from '@/components/shared/form'

const CURRENCIES = ['EUR', 'GBP', 'USD', 'CHF', 'SEK', 'DKK', 'NOK', 'PLN', 'CAD', 'AUD']
const DATE_FORMATS = [
  { value: 'dd/MM/yyyy', label: '31/12/2026' },
  { value: 'dd.MM.yyyy', label: '31.12.2026' },
  { value: 'MM/dd/yyyy', label: '12/31/2026' },
  { value: 'yyyy-MM-dd', label: '2026-12-31' },
  { value: 'd MMM yyyy', label: '31 Dec 2026' },
]
const WEEK_STARTS = [
  { value: '1', label: 'Monday' },
  { value: '0', label: 'Sunday' },
  { value: '6', label: 'Saturday' },
]
/**
 * A spread of IANA zones rather than all ~400: enough to cover an agency and its
 * clients without turning the field into a search problem. Whatever is already saved is
 * added to the list below, so a zone set elsewhere is never silently replaced.
 */
const TIME_ZONES = [
  'UTC',
  'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Madrid', 'Europe/Paris',
  'Europe/Amsterdam', 'Europe/Berlin', 'Europe/Zurich', 'Europe/Stockholm', 'Europe/Warsaw',
  'Europe/Athens', 'Europe/Istanbul',
  'Africa/Lagos', 'Africa/Nairobi', 'Africa/Johannesburg',
  'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Colombo', 'Asia/Dhaka', 'Asia/Bangkok',
  'Asia/Jakarta', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul',
  'Australia/Perth', 'Australia/Sydney', 'Pacific/Auckland',
  'America/Sao_Paulo', 'America/New_York', 'America/Toronto', 'America/Chicago',
  'America/Mexico_City', 'America/Denver', 'America/Los_Angeles', 'America/Vancouver',
  'America/Anchorage', 'Pacific/Honolulu',
]

export function WorkspaceForm({
  values,
  todayLabel,
}: {
  values: {
    agencyName: string
    currency: string
    dateFormat: string
    weekStartDay: number
    timeZone: string
    defaultRate: string
    defaultBillingMethod: BillingMethodName
    defaultBillable: boolean
  }
  /** Today in the saved zone, already formatted — so the setting's effect is visible. */
  todayLabel: string
}) {
  const router = useRouter()
  const [currency, setCurrency] = useState(values.currency)
  const [dateFormat, setDateFormat] = useState(values.dateFormat)
  const [weekStart, setWeekStart] = useState(String(values.weekStartDay))
  const [timeZone, setTimeZone] = useState(values.timeZone)
  const zoneOptions = TIME_ZONES.includes(values.timeZone)
    ? TIME_ZONES
    : [values.timeZone, ...TIME_ZONES]
  const [method, setMethod] = useState<string>(values.defaultBillingMethod)
  const [billable, setBillable] = useState(values.defaultBillable)

  const [state, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof updateWorkspaceSettings>> | null, formData: FormData) => {
      const result = await updateWorkspaceSettings(prev, formData)
      if (result.ok) {
        toast.success('Settings saved', { description: 'Money and dates now use the new formats everywhere.' })
        router.refresh()
      }
      return result
    },
    null,
  )
  const error = state && !state.ok ? state.error : null

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="dateFormat" value={dateFormat} />
      <input type="hidden" name="weekStartDay" value={weekStart} />
      <input type="hidden" name="timeZone" value={timeZone} />
      <input type="hidden" name="defaultBillingMethod" value={method} />
      <input type="hidden" name="defaultBillable" value={billable ? 'on' : 'off'} />
      <FormError error={error} />
      <FormGrid>
        <Field name="agencyName" label="Workspace name" error={error} span>
          <Input id="agencyName" name="agencyName" defaultValue={values.agencyName} required />
        </Field>

        <Field name="currency" label="Currency" error={error}>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field name="dateFormat" label="Date format" error={error}>
          <Select value={dateFormat} onValueChange={setDateFormat}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_FORMATS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field name="weekStartDay" label="Week starts on" error={error}>
          <Select value={weekStart} onValueChange={setWeekStart}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEK_STARTS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          name="timeZone"
          label="Time zone"
          error={error}
          span
          hint={`Which day the workspace calls today — right now, ${todayLabel}. Timesheets, slipped work and invoice aging are all measured from it.`}
        >
          <Select value={timeZone} onValueChange={setTimeZone}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {zoneOptions.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zone.replace(/_/g, ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          name="defaultRateCents"
          label={`Default hourly rate (${currency})`}
          error={error}
          hint="Pre-fills a new project role."
        >
          <Input
            id="defaultRateCents"
            name="defaultRateCents"
            defaultValue={values.defaultRate}
            inputMode="decimal"
          />
        </Field>

        <Field name="defaultBillingMethod" label="Default billing method" error={error}>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BILLING_METHODS.map((option) => (
                <SelectItem key={option} value={option}>
                  {BILLING_METHOD_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div className="flex items-center gap-2.5 sm:col-span-2">
          <Switch id="defaultBillable" checked={billable} onCheckedChange={setBillable} />
          <Label htmlFor="defaultBillable" className="cursor-pointer">
            New projects are billable by default
          </Label>
        </div>
      </FormGrid>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Saving…' : 'Save settings'}
      </Button>
    </form>
  )
}
