import { cn } from '@/lib/utils'

interface UnreadBadgeProps {
  // Hidden at 0, capped at 9+
  count: number
  // Placement, which differs by host (a button's corner, beside a tab label)
  className?: string
}

/**
 * The unread count pill, on destructive; dimmed in dark themes so white text
 * passes. The dimmed fill is opaque (mixed with the page background), so it
 * reads the same on any host, including the filled amber Chat button.
 */
export function UnreadBadge({ count, className }: UnreadBadgeProps) {
  if (count <= 0) return null
  return (
    <span
      className={cn(
        'flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-0.5 text-xs font-bold text-destructive-foreground dark:bg-[color-mix(in_oklab,var(--destructive)_60%,var(--background))]',
        className
      )}
    >
      {count > 9 ? '9+' : count}
    </span>
  )
}
