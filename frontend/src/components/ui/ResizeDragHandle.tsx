import * as React from 'react'
import { GripHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ResizeDragHandleProps {
  onMouseDown: (e: React.MouseEvent) => void
  isDragging: boolean
  className?: string
}

export function ResizeDragHandle({
  onMouseDown,
  isDragging,
  className,
}: ResizeDragHandleProps) {
  return (
    <div
      className={cn(
        'group flex h-3 w-full cursor-ns-resize items-center justify-center',
        'border-t bg-muted/50 hover:bg-muted transition-colors',
        isDragging && 'bg-primary/20',
        className
      )}
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize EPG section"
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
