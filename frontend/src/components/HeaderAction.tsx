import type { ComponentProps, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { UnreadBadge } from '@/components/UnreadBadge'
import { cn } from '@/lib/utils'

interface HeaderActionProps extends Omit<ComponentProps<'button'>, 'children'> {
  icon: ReactNode
  // Accessible name, and the tooltip unless one is given
  label: string
  // Tooltip text when it adds to the name, e.g. a key hint 'Chat (C)'
  tooltip?: string
  // Short visible text, shown from lg (1024px); icon only below that
  visibleLabel?: string
  // Toggle state (aria-pressed); leave undefined for plain actions
  pressed?: boolean
  // Count shown on the corner, capped at 9+; hidden at 0. A background ring
  // keeps it apart from a filled button
  badge?: number
  // 'default' is the filled primary button, for the one main action
  variant?: 'toolbar' | 'default'
}

export function HeaderAction({
  icon,
  label,
  tooltip,
  visibleLabel,
  pressed,
  badge,
  variant = 'toolbar',
  className,
  ...props
}: HeaderActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size="toolbar"
          aria-label={label}
          aria-pressed={pressed}
          className={cn('relative', visibleLabel && 'lg:w-auto lg:px-3', className)}
          {...props}
        >
          {icon}
          {visibleLabel && <span className="hidden lg:inline">{visibleLabel}</span>}
          {badge !== undefined && <UnreadBadge count={badge} className="absolute -top-1.5 -right-1.5 ring-2 ring-background" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltip ?? label}</p>
      </TooltipContent>
    </Tooltip>
  )
}
