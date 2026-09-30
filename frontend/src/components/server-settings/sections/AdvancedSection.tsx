import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { LogLevel } from '@/types/setup'
import { differsFromDefault, fieldValue, lockedBy } from '../model/configDraft'
import { ADVANCED_GROUPS, LOG_LEVELS, NUMBER_SPECS, type AdvancedField, type NumberField } from '../model/fields'
import { Field } from '../fields/Field'
import { LockedNote } from '../fields/LockedNote'
import { NativeSelect } from '../fields/NativeSelect'
import { NumberField as NumberInput } from '../fields/NumberField'
import { LOCKED_INPUT, SCROLL_MARGIN, SMALL_BUTTON, TWO_COLUMNS } from '../fields/styles'
import type { SectionProps } from './types'

function isNumberField(field: AdvancedField): field is NumberField {
  return field in NUMBER_SPECS
}

interface AdvancedSectionProps extends SectionProps {
  /** Put every unlocked Advanced setting back to its default */
  onReset: () => void
}

/**
 * The tuned defaults for casting, clips, feedback and the server, in their
 * groups. A setting that differs from its default says "changed".
 */
export function AdvancedSection({ state, errors, onField, idPrefix, onReset }: AdvancedSectionProps) {
  const { view } = state
  const logLock = lockedBy(view, 'logLevel')
  const originsLock = lockedBy(view, 'ersatztvLogoOrigins')

  const control = (field: AdvancedField) => {
    const id = `${idPrefix}-${field}`
    if (isNumberField(field)) {
      const spec = NUMBER_SPECS[field]
      return (
        <NumberInput
          key={field}
          id={id}
          label={spec.label}
          unit={spec.unit}
          value={fieldValue(state, field)}
          onChange={(value) => onField(field, value)}
          // Only what the admin can change back is marked
          changed={lockedBy(view, field) === null && differsFromDefault(state, field)}
          error={errors[field]}
          lockedBy={lockedBy(view, field)}
        />
      )
    }
    if (field === 'logLevel') {
      return (
        <div key={field} className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <label htmlFor={id} className="min-w-0 flex-1 text-sm">
              Log level
              {logLock === null && differsFromDefault(state, field) && <span className="text-[12.5px] font-semibold text-primary"> · changed</span>}
            </label>
            <NativeSelect
              id={id}
              value={fieldValue(state, field)}
              disabled={logLock !== null}
              aria-describedby={logLock ? `${id}-env` : undefined}
              onChange={(event) => onField('logLevel', event.target.value as LogLevel)}
              className={cn('h-[38px] w-[132px] shrink-0 pointer-coarse:h-11', SCROLL_MARGIN)}
            >
              {LOG_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </NativeSelect>
            <span className="w-[26px] shrink-0" />
          </div>
          {logLock && <LockedNote id={`${id}-env`} names={logLock} subject="Log level" />}
        </div>
      )
    }
    return (
      <Field
        key={field}
        id={id}
        label="Extra logo sources"
        help="Addresses ErsatzTV logos may also come from, separated by commas."
        error={errors.ersatztvLogoOrigins}
        lockedBy={originsLock}
        className="col-span-full"
      >
        {(props) => (
          <Input
            {...props}
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://images.example.com"
            value={fieldValue(state, 'ersatztvLogoOrigins')}
            readOnly={originsLock !== null}
            onChange={(event) => onField('ersatztvLogoOrigins', event.target.value)}
            className={cn('h-[38px] text-base md:text-base pointer-coarse:h-11', SCROLL_MARGIN, originsLock && LOCKED_INPUT)}
          />
        )}
      </Field>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {ADVANCED_GROUPS.map((group) => (
        <section key={group.title} aria-labelledby={`${idPrefix}-adv-${group.title}`} className="flex flex-col gap-2.5">
          <h3
            id={`${idPrefix}-adv-${group.title}`}
            className="font-sans text-xs font-semibold tracking-[0.09em] text-muted-foreground uppercase"
          >
            {group.title}
          </h3>
          <div className={cn('grid gap-x-7 gap-y-2.5', TWO_COLUMNS)}>{group.fields.map(control)}</div>
        </section>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="text-[13px] leading-[1.45] text-pretty text-muted-foreground">
          The log format, temporary folders, API docs and CORS stay in the environment: they belong to how the container runs.
        </p>
        <Button type="button" variant="ghost" size="sm" className={SMALL_BUTTON} onClick={onReset}>
          <RefreshCw aria-hidden="true" />
          Reset to defaults
        </Button>
      </div>
    </div>
  )
}
