import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { FieldMessage } from './Field'
import { LockedNote } from './LockedNote'
import { SCROLL_MARGIN } from './styles'

interface NumberFieldProps {
  id: string
  label: string
  /** The text typed, in the unit shown */
  value: string
  onChange: (value: string) => void
  unit?: string
  /** Differs from the server's default: the label says "changed" */
  changed?: boolean
  error?: string | null
  lockedBy?: readonly string[] | null
}

/** One Advanced number: label, a short right-aligned input and its unit on one row. */
export function NumberField({ id, label, value, onChange, unit, changed, error, lockedBy }: NumberFieldProps) {
  const locked = lockedBy != null && lockedBy.length > 0
  const envId = locked ? `${id}-env` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [envId, errId].filter(Boolean).join(' ') || undefined

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <label htmlFor={id} className="min-w-0 flex-1 text-sm">
          {label}
          {changed && <span className="text-[12.5px] font-semibold text-primary"> · changed</span>}
        </label>
        <Input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          readOnly={locked}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            'h-[38px] w-24 shrink-0 text-right text-base tabular-nums md:text-base pointer-coarse:h-11',
            SCROLL_MARGIN,
            locked && 'bg-muted text-muted-foreground'
          )}
        />
        <span className="w-[26px] shrink-0 text-[13px] text-muted-foreground">{unit}</span>
      </div>
      {locked && <LockedNote id={envId} names={lockedBy} />}
      {errId && <FieldMessage id={errId} tone="error">{error}</FieldMessage>}
    </div>
  )
}
