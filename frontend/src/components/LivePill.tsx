import { cn } from '@/lib/utils'

interface LivePillProps {
  // Placement only (margins, alignment); the pill's look is the same everywhere
  className?: string
}

/**
 * The one LIVE badge: a solid live fill with a dot, in the display face.
 * Marks channel 0 while something is on it, wherever it's listed or named.
 */
export function LivePill({ className }: LivePillProps) {
  return (
    <span
      data-testid="live-pill"
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded bg-live py-1 pr-[7px] pl-1.5',
        'font-display text-[11px] font-extrabold uppercase leading-none tracking-[0.12em] text-live-foreground',
        className
      )}
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-live-foreground" />
      Live
    </span>
  )
}
