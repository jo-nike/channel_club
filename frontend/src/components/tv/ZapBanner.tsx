import { useEffect, useState, type ReactNode } from 'react'
import { describeLiveChange, type LiveChannelChange } from '@/stores/channelStore'
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
  /** A change to the shared live channel to announce, while on channel 0 */
  liveChange?: LiveChannelChange | null
}

/**
 * Channel banner for the couch (TV) view. It appears when it mounts and again
 * whenever the channel changes, then hides 3s later. The hint tells remote
 * users how to change channel and how to open the guide.
 *
 * A typed number that matches no channel (yet) shows its digits instead of a
 * channel, and 'No channel 99' once it is entered, so the banner never
 * implies the number was taken.
 *
 * The info rail stays out of the couch view, so the banner also tells a
 * viewer on channel 0 who changed the live channel, in the rail's and the
 * toast's words ('jon put on TSN 5'), and comes up again for it.
 */
export function ZapBanner({ channel, entry = null, missing = null, liveChange = null }: ZapBannerProps) {
  const number = missing ?? entry
  // The last change announced: each one brings the banner back for its 3s,
  // and the announcement ending doesn't. (Adjusted while rendering, React's
  // pattern for state that follows a prop.)
  const [announcedAt, setAnnouncedAt] = useState(liveChange?.at ?? null)
  if (liveChange && liveChange.at !== announcedAt) setAnnouncedAt(liveChange.at)
  return (
    <div
      role="status"
      aria-live="polite"
      // Inside the TV's title-safe area (index.css .couch tokens)
      className="pointer-events-none absolute left-(--couch-safe-x) top-(--couch-safe-y) z-10"
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
          <ZapBannerCard
            key={`${channel.id}:${channel.name}:${announcedAt}`}
            detail={liveChange && describeLiveChange(liveChange.channelName, liveChange.by)}
          >
            <span className="font-display font-black tabular-nums">CH {channel.number}</span> · {channel.name}
          </ZapBannerCard>
        )
      )}
    </div>
  )
}

function ZapBannerCard({ children, detail = null }: { children: ReactNode; detail?: string | null }) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), ZAP_BANNER_MS)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <div className="rounded-2xl bg-black/70 px-8 py-6 text-white shadow-2xl">
      <p className="text-5xl font-bold">{children}</p>
      {detail && <p className="mt-3 text-3xl font-semibold">{detail}</p>}
      <p className="mt-3 text-2xl text-white/80">▲▼ change channel · 0-9 channel number · OK guide</p>
    </div>
  )
}
