import * as React from 'react'
import { GripHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ResizeDragHandleProps {
  onPointerDown: (e: React.PointerEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  isDragging: boolean
  // The guide's share of the height, in percent, and its limits
  valueNow: number
  valueMin: number
  valueMax: number
  className?: string
}

export function ResizeDragHandle({
  onPointerDown,
  onKeyDown,
  isDragging,
  valueNow,
  valueMin,
  valueMax,
  className,
}: ResizeDragHandleProps) {
  return (
    <div
      className={cn(
        // touch-none: a touch drag moves the splitter instead of scrolling the page
        'group flex h-3 w-full cursor-ns-resize touch-none items-center justify-center focus-visible:-outline-offset-2',
        'border-t bg-muted/50 hover:bg-muted transition-colors rounded-t-lg',
        isDragging && 'bg-primary/20',
        className
      )}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize EPG section"
      aria-valuenow={Math.round(valueNow)}
      aria-valuemin={valueMin}
      aria-valuemax={valueMax}
    >
      <GripHorizontal
        className={cn(
          'h-4 w-8 text-muted-foreground/50 group-hover:text-muted-foreground',
          isDragging && 'text-primary'
        )}
      />
    </div>
  )
}
