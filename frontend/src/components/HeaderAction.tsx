import type { ComponentProps, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface HeaderActionProps extends Omit<ComponentProps<'button'>, 'children'> {
  icon: ReactNode
  // Accessible name and tooltip
  label: string
  // Short visible text, shown from lg (1024px); icon only below that
  visibleLabel?: string
  // Toggle state (aria-pressed); leave undefined for plain actions
  pressed?: boolean
  // Count shown on the corner, capped at 9+; hidden at 0
  badge?: number
  // 'default' is the filled primary button, for the one main action
  variant?: 'toolbar' | 'default'
}

export function HeaderAction({
  icon,
  label,
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
          {badge !== undefined && badge > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-0.5 text-xs font-bold text-destructive-foreground dark:bg-destructive/60">
              {badge > 9 ? '9+' : badge}
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  )
}
