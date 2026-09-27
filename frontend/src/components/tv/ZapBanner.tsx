import { useEffect, useState } from 'react'
import type { UnifiedChannel } from '@/types'

/** How long the banner stays up after the last channel change. */
const ZAP_BANNER_MS = 3000

interface ZapBannerProps {
  /** The channel to show: the one being zapped to, else the one playing. */
  channel: UnifiedChannel | null
}

/**
 * Channel banner for TV theater mode. It appears when it mounts (entering
 * theater) and again whenever the channel changes, then hides 3s later. The
 * hint tells remote users how to zap and how to get the header back, since
 * theater hides it.
 */
export function ZapBanner({ channel }: ZapBannerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute left-[4%] top-[6%] z-10"
    >
      {/* Remounting on each change restarts the 3s timer */}
      {channel && <ZapBannerCard key={`${channel.id}:${channel.name}`} channel={channel} />}
    </div>
  )
}

function ZapBannerCard({ channel }: { channel: UnifiedChannel }) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), ZAP_BANNER_MS)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <div className="rounded-2xl bg-black/70 px-8 py-6 text-white shadow-2xl">
      <p className="text-5xl font-bold">
        <span className="font-display font-black tabular-nums">CH {channel.number}</span> · {channel.name}
      </p>
      <p className="mt-3 text-2xl text-white/80">▲▼ change channel · Back for menu</p>
    </div>
  )
}
