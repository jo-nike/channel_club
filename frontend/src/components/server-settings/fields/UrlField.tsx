import { useState, type ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useDebounce } from '@/hooks/useDebounce'
import { cn } from '@/lib/utils'
import { addressWarning, type WarningKind } from '../model/addressWarnings'
import { Field } from './Field'
import { INPUT, LOCKED_INPUT, SCROLL_MARGIN } from './styles'

/** How long typing pauses before an address is checked for a warning. */
export const WARNING_DELAY_MS = 350

interface UrlFieldProps {
  id: string
  label: ReactNode
  value: string
  onChange: (value: string) => void
  placeholder?: string
  help?: ReactNode
  error?: string | null
  lockedBy?: readonly string[] | null
  /** Check the address for this service's pitfalls, 350ms after typing stops and on leaving the field */
  warn?: WarningKind
}

/** An address. A locked one is read-only with a lock icon and says which variable sets it. */
export function UrlField({ id, label, value, onChange, placeholder, help, error, lockedBy, warn }: UrlFieldProps) {
  const [typing, setTyping] = useState(false)
  const settled = useDebounce(value, WARNING_DELAY_MS)
  const locked = lockedBy != null && lockedBy.length > 0
  const warning = warn && !locked ? addressWarning(warn, typing ? settled : value, window.location.protocol) : null

  return (
    <Field id={id} label={label} help={help} warning={warning} error={error} lockedBy={lockedBy}>
      {(control) => (
        <div className="relative flex items-center">
          <Input
            {...control}
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={value}
            placeholder={placeholder}
            readOnly={locked}
            onChange={(event) => {
              setTyping(true)
              onChange(event.target.value)
            }}
            onBlur={() => setTyping(false)}
            className={cn(INPUT, SCROLL_MARGIN, locked && LOCKED_INPUT)}
          />
          {locked && <Lock className="pointer-events-none absolute right-[13px] size-4 text-muted-foreground" aria-hidden="true" />}
        </div>
      )}
    </Field>
  )
}
