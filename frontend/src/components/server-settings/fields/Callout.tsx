import type { ReactNode } from 'react'
import { CircleAlert, Info, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CalloutProps {
  tone: 'info' | 'danger'
  /** The icon at the start; an alert or info circle by default */
  icon?: LucideIcon
  /** 'alert' for an error that appears after an action, so it is read out */
  role?: 'alert' | 'status'
  id?: string
  className?: string
  children: ReactNode
}

/** A boxed note across a step: what the environment sets, or what stops the step going on. */
export function Callout({ tone, icon, role, id, className, children }: CalloutProps) {
  const Icon = icon ?? (tone === 'danger' ? CircleAlert : Info)
  return (
    <div
      id={id}
      role={role}
      className={cn(
        'flex items-start gap-3 rounded-xl border px-4 py-3.5 text-sm',
        tone === 'danger' ? 'border-destructive/40 bg-destructive/10 text-foreground' : 'border-info/35 bg-info/10',
        className
      )}
    >
      <Icon
        className={cn('mt-0.5 size-[18px] shrink-0', tone === 'danger' ? 'text-destructive' : 'text-info')}
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
    </div>
  )
}
