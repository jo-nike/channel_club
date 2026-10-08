import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type ChipTone = 'ok' | 'muted' | 'primary' | 'env'

const TONES: Record<ChipTone, string> = {
  ok: 'bg-success/15 text-success',
  muted: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/15 text-foreground',
  env: 'bg-info/15 font-mono font-medium text-info',
}

/** A small label: a status (Online, FFmpeg ready), a role, or an environment variable's name. */
export function Chip({ tone = 'muted', className, children }: { tone?: ChipTone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[5px] whitespace-nowrap rounded-full px-[9px] py-0.5 font-sans text-xs font-semibold [&_svg]:size-[13px] [&_svg]:shrink-0',
        TONES[tone],
        className
      )}
    >
      {children}
    </span>
  )
}
