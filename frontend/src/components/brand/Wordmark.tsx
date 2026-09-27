import { APP_NAME } from '@/lib/appInfo'
import { cn } from '@/lib/utils'

export type WordmarkSize = 'sm' | 'md' | 'lg'

interface WordmarkProps {
  /** sm for tight spots, md for the header, lg for sign-in and loading */
  size?: WordmarkSize
  className?: string
}

const textSize: Record<WordmarkSize, string> = {
  sm: 'gap-1.5 text-base',
  md: 'gap-2 text-xl',
  lg: 'gap-3 text-4xl',
}

/**
 * "Channel Club" in the display face, led by an 8px on-air dot in the live
 * colour. Until the display font is loaded it falls back to the sans stack.
 * It is one image to assistive tech, so the name is read once, in normal case.
 */
export function Wordmark({ size = 'md', className }: WordmarkProps) {
  return (
    <span
      role="img"
      aria-label={APP_NAME}
      data-size={size}
      className={cn(
        'inline-flex items-center font-display font-black uppercase leading-none tracking-[0.04em]',
        textSize[size],
        className
      )}
    >
      <span data-slot="wordmark-dot" className="size-2 shrink-0 rounded-full bg-live" />
      {APP_NAME}
    </span>
  )
}
