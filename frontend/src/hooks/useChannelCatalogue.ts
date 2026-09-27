import { useEffect, useState } from 'react'
import { useRecentLiveStore } from '@/stores/recentLiveStore'
import { fetchGroupedChannels } from '@/services/api'
import type { Channel } from '@/types'

/**
 * The grouped channel catalogue by channel id, loaded once per mount; null
 * while loading or when it can't be loaded. Once loaded, recent channels that
 * are no longer in it are forgotten.
 */
export function useChannelCatalogue(): Map<string, Channel> | null {
  const [catalogue, setCatalogue] = useState<Map<string, Channel> | null>(null)
  const pruneRecents = useRecentLiveStore((s) => s.prune)

  useEffect(() => {
    let cancelled = false
    fetchGroupedChannels().then(
      ({ groups, ungrouped }) => {
        if (cancelled) return
        const channels = [...groups.flatMap((group) => group.channels), ...ungrouped]
        const byId = new Map(channels.map((channel) => [channel.id, channel]))
        setCatalogue(byId)
        pruneRecents(new Set(byId.keys()))
      },
      () => {
        // Non-fatal: callers just go without the channels (the Recent row)
      },
    )
    return () => {
      cancelled = true
    }
  }, [pruneRecents])

  return catalogue
}
