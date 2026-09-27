import { useEffect, useState, type ReactNode } from 'react'
import type { UnifiedChannel } from '@/types'

/** How long the banner stays up after the last channel change. */
const ZAP_BANNER_MS = 3000

interface ZapBannerProps {
  /** The channel to show: the one being zapped to, else the one playing. */
  channel: UnifiedChannel | null
  /** The digits of a channel number being typed while they match no channel */
  entry?: string | null
  /** A number just typed that no channel has */
  missing?: string | null
}

/**
 * Channel banner for TV theater mode. It appears when it mounts (entering
 * theater) and again whenever the channel changes, then hides 3s later. The
 * hint tells remote users how to zap and how to get the header back, since
 * theater hides it.
 *
 * A typed number that matches no channel (yet) shows its digits instead of a
 * channel, and 'No channel 99' once it is entered, so the banner never
 * implies the number was taken.
 */
export function ZapBanner({ channel, entry = null, missing = null }: ZapBannerProps) {
  const number = missing ?? entry
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute left-[4%] top-[6%] z-10"
    >
      {/* Remounting on each change restarts the 3s timer */}
      {number !== null ? (
        <ZapBannerCard key={`${missing !== null ? 'missing' : 'entry'}:${number}`}>
          {missing !== null ? (
            `No channel ${number}`
          ) : (
            <span className="font-display font-black tabular-nums">CH {number}</span>
          )}
        </ZapBannerCard>
      ) : (
        channel && (
          <ZapBannerCard key={`${channel.id}:${channel.name}`}>
            <span className="font-display font-black tabular-nums">CH {channel.number}</span> · {channel.name}
          </ZapBannerCard>
        )
      )}
    </div>
  )
}

function ZapBannerCard({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), ZAP_BANNER_MS)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <div className="rounded-2xl bg-black/70 px-8 py-6 text-white shadow-2xl">
      <p className="text-5xl font-bold">{children}</p>
      <p className="mt-3 text-2xl text-white/80">▲▼ change channel · Back for menu</p>
    </div>
  )
}
