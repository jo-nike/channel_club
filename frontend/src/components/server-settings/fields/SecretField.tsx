import type { ReactNode } from 'react'
import { Check, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { cn } from '@/lib/utils'
import type { SecretEntry } from '../model/configDraft'
import { Chip } from './Chip'
import { Field } from './Field'
import { INPUT, LOCKED_INPUT, NOT_A_PASSWORD, SCROLL_MARGIN, SMALL_BUTTON } from './styles'

interface SecretFieldProps {
  id: string
  label: ReactNode
  /** Names the reveal button: "Show {noun}" */
  noun: string
  entry: SecretEntry
  /** A string replaces the saved one (blank keeps it); null removes it */
  onChange: (value: string | null) => void
  /** A key or token: no password manager, monospace. A password: the browser may offer to save it */
  kind: 'key' | 'password'
  placeholder?: string
  help?: ReactNode
  error?: string | null
  lockedBy?: readonly string[] | null
  optional?: boolean
}

/**
 * A key, token or password, never shown once saved. A saved one reads Saved
 * with a Remove button; typing replaces it and leaving it blank keeps it.
 * After Remove, "Keep it" takes it back until the section is saved.
 */
export function SecretField({
  id,
  label,
  noun,
  entry,
  onChange,
  kind,
  placeholder,
  help,
  error,
  lockedBy,
  optional,
}: SecretFieldProps) {
  const removing = entry.draft === null
  const aside = entry.locked ? null : removing ? (
    <Button type="button" variant="ghost" size="sm" className={SMALL_BUTTON} onClick={() => onChange('')}>
      Keep it
    </Button>
  ) : entry.saved ? (
    <span className="flex items-center gap-1">
      <Chip tone="ok">
        <Check aria-hidden="true" />
        Saved
      </Chip>
      <Button type="button" variant="ghost" size="sm" className={SMALL_BUTTON} onClick={() => onChange(null)}>
        Remove{' '}<span className="sr-only">{noun}</span>
      </Button>
    </span>
  ) : null
  const shownPlaceholder = removing
    ? 'Removed when you save'
    : entry.saved
      ? 'Saved · type to replace'
      : placeholder

  return (
    <Field
      id={id}
      label={label}
      labelAside={aside}
      optional={optional}
      help={help}
      error={error}
      lockedBy={lockedBy}
    >
      {(control) =>
        entry.locked ? (
          <div className="relative flex items-center">
            <Input
              {...control}
              type="password"
              value=""
              readOnly
              placeholder={entry.saved ? 'Set in the environment' : 'Not set'}
              className={cn(INPUT, SCROLL_MARGIN, LOCKED_INPUT)}
            />
            <Lock className="pointer-events-none absolute right-[13px] size-4 text-muted-foreground" aria-hidden="true" />
          </div>
        ) : (
          <PasswordInput
            {...control}
            {...(kind === 'key' ? NOT_A_PASSWORD : { autoComplete: 'new-password' })}
            noun={noun}
            spellCheck={false}
            value={typeof entry.draft === 'string' ? entry.draft : ''}
            placeholder={shownPlaceholder}
            onChange={(event) => onChange(event.target.value)}
            className={cn(INPUT, SCROLL_MARGIN, kind === 'key' && 'font-mono')}
          />
        )
      }
    </Field>
  )
}
