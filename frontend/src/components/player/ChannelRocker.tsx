import { ChevronDown, ChevronUp } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { withKey } from '@/lib/keyHints'
import { cn } from '@/lib/utils'

interface ChannelRockerProps {
  /** Channel up (+1) or down (-1), as PageUp/PageDown do */
  onStep: (dir: 1 | -1) => void
  /** The control bar's: -1 while it is hidden */
  tabIndex: number
  /** The control bar's button look */
  buttonClassName: string
  /** Extra classes for the group, such as when the bar is too narrow for it */
  className?: string
}

/**
 * CH-/CH+ in the control bar, for people flipping channels with a mouse in
 * theater or fullscreen, where the sidebar and guide are gone. Each press
 * goes through the page's zap, like PageUp/PageDown: the info rail follows
 * at once and the tune waits for the presses to stop.
 */
export function ChannelRocker({ onStep, tabIndex, buttonClassName, className }: ChannelRockerProps) {
  return (
    <div role="group" aria-label="Channel" className={cn('flex items-center', className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            tabIndex={tabIndex}
            onClick={() => onStep(-1)}
            aria-label="Channel down"
            aria-keyshortcuts="PageDown"
            className={buttonClassName}
          >
            <ChevronDown className="h-6 w-6 text-white" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{withKey('Channel down', 'PgDn')}</p>
        </TooltipContent>
      </Tooltip>
      <span aria-hidden="true" className="font-display text-sm font-extrabold leading-none tracking-wide text-white/80">
        CH
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            tabIndex={tabIndex}
            onClick={() => onStep(1)}
            aria-label="Channel up"
            aria-keyshortcuts="PageUp"
            className={buttonClassName}
          >
            <ChevronUp className="h-6 w-6 text-white" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{withKey('Channel up', 'PgUp')}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
