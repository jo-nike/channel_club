import type { ReactNode } from 'react'
import { CircleAlert, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LockedNote } from './LockedNote'

/** What Field hands its control: the id its label points at, and what describes it. */
export interface ControlProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

/** A warning or an error under a control. */
export function FieldMessage({ id, tone, children }: { id?: string; tone: 'warning' | 'error'; children: ReactNode }) {
  const Icon = tone === 'error' ? CircleAlert : TriangleAlert
  return (
    <p
      id={id}
      className={cn(
        'flex items-start gap-[7px] text-[13px] leading-[1.45]',
        tone === 'error' ? 'text-destructive' : 'text-warning'
      )}
    >
      <Icon className="mt-px size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

interface FieldProps {
  /** The control's id; the ids of its help, note, warning and error follow from it */
  id: string
  label: ReactNode
  /** A small action at the end of the label's row, such as New name */
  labelAside?: ReactNode
  optional?: boolean
  help?: ReactNode
  warning?: string | null
  error?: string | null
  /** The environment variables that set it: the control is read-only, and this says why instead of the help */
  lockedBy?: readonly string[] | null
  className?: string
  children: (control: ControlProps) => ReactNode
}

/**
 * A labelled control with its help, the environment note when locked, a
 * warning and an error under it, each tied to the control by
 * aria-describedby. An error also sets aria-invalid.
 */
export function Field({ id, label, labelAside, optional, help, warning, error, lockedBy, className, children }: FieldProps) {
  const locked = lockedBy != null && lockedBy.length > 0
  const helpId = help && !locked ? `${id}-help` : undefined
  const envId = locked ? `${id}-env` : undefined
  const warnId = warning && !locked ? `${id}-warn` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [helpId, envId, warnId, errId].filter(Boolean).join(' ') || undefined

  const labelElement = (
    <label htmlFor={id} className="text-sm font-semibold">
      {label}
      {optional && (
        <>
          {' '}
          <span className="text-[13px] font-normal text-muted-foreground">optional</span>
        </>
      )}
    </label>
  )

  return (
    <div className={cn('flex min-w-0 flex-col gap-[7px]', className)}>
      {labelAside ? (
        <div className="flex min-h-[34px] items-center justify-between gap-3">
          {labelElement}
          {labelAside}
        </div>
      ) : (
        labelElement
      )}
      {children({ id, 'aria-describedby': describedBy, ...(error ? { 'aria-invalid': true as const } : {}) })}
      {helpId && (
        <p id={helpId} className="text-[13px] leading-[1.45] text-pretty text-muted-foreground">
          {help}
        </p>
      )}
      {locked && <LockedNote id={envId} names={lockedBy} />}
      {warnId && <FieldMessage id={warnId} tone="warning">{warning}</FieldMessage>}
      {errId && <FieldMessage id={errId} tone="error">{error}</FieldMessage>}
    </div>
  )
}
