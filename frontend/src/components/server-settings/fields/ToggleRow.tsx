import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { SWITCH_HIT_AREA } from './styles'

interface ToggleRowProps {
  /** The switch's id; its title and description take `${id}-title` and `${id}-desc` */
  id: string
  icon: LucideIcon
  title: ReactNode
  description?: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

/** A switch on a row of its own inside a card: a house rule, or Zipline under Clips. */
export function ToggleRow({ id, icon: Icon, title, description, checked, onChange, disabled, className }: ToggleRowProps) {
  const titleId = `${id}-title`
  const descId = description ? `${id}-desc` : undefined

  return (
    <div className={cn('flex items-start gap-3', className)}>
      <Icon className="mt-0.5 size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p id={titleId} className="text-[14.5px] font-semibold">
          {title}
        </p>
        {description && (
          <p id={descId} className="text-[13px] leading-[1.45] text-pretty text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-labelledby={titleId}
        aria-describedby={descId}
        className={cn('mt-px', SWITCH_HIT_AREA)}
      />
    </div>
  )
}
