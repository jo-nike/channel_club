import { useState } from 'react'
import { apiAssetUrl } from '@/services/apiBase'
import { cn } from '@/lib/utils'
import type { Channel } from '@/types'

interface ChannelLogoProps {
  channel: Pick<Channel, 'name' | 'logoUrl'>
  className?: string
}

/**
 * A 40px channel logo, or a monogram of the channel's name when it has no
 * logo or the logo fails to load. Decorative: the channel's name is always
 * shown next to it.
 */
export function ChannelLogo({ channel, className }: ChannelLogoProps) {
  const src = channel.logoUrl ? apiAssetUrl(channel.logoUrl) : null
  // Remembers which URL failed, so a new logo URL gets its own try
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showLogo = src !== null && src !== failedSrc

  return (
    <span
      aria-hidden="true"
      data-testid="channel-logo"
      className={cn(
        'flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted',
        className
      )}
    >
      {showLogo ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-contain"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        // Drawn by CSS from the attribute, so the monogram never becomes a second
        // text node repeating the name beside it ("TSN" next to "TSN")
        <span
          data-monogram={monogram(channel.name)}
          className="font-display text-[13px] font-black leading-none tracking-[0.04em] text-muted-foreground before:content-[attr(data-monogram)]"
        />
      )}
    </span>
  )
}

/**
 * A short acronym stays whole ("TSN 3" is TSN, "RDS" is RDS); otherwise the
 * initials of the first two words ("Sportsnet One" is SO).
 */
function monogram(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? []
  const [first] = words
  if (first === undefined) return '#'
  if (first.length <= 4 && /\p{Lu}/u.test(first) && first === first.toUpperCase()) return first
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join('')
    .toUpperCase()
}
