import { useEffect, useState } from 'react'
import { useSources } from '@/hooks/useSources'
import { useRecentLiveStore } from '@/stores/recentLiveStore'
import { fetchGroupedChannels } from '@/services/api'
import type { Channel } from '@/types'

/** The grouped channel catalogue by channel id, and whether it couldn't be loaded. */
export interface ChannelCatalogueLoad {
  /** null while loading or when it can't be loaded */
  catalogue: Map<string, Channel> | null
  /** The load failed; it is not retried while mounted */
  failed: boolean
}

// Without Dispatcharr the catalogue is empty, not missing: nothing to load or retry
const NOT_SET_UP: ChannelCatalogueLoad = { catalogue: new Map(), failed: false }

/**
 * The grouped channel catalogue by channel id, loaded once per mount, telling
 * a failed load apart from one still going. Once loaded, recent channels that
 * are no longer in it are forgotten. Without Dispatcharr it is empty and
 * nothing is fetched.
 */
export function useChannelCatalogueLoad(): ChannelCatalogueLoad {
  const [load, setLoad] = useState<ChannelCatalogueLoad>({ catalogue: null, failed: false })
  const pruneRecents = useRecentLiveStore((s) => s.prune)
  const dispatcharrOn = useSources().dispatcharr

  useEffect(() => {
    if (!dispatcharrOn) return
    let cancelled = false
    fetchGroupedChannels().then(
      ({ groups, ungrouped }) => {
        if (cancelled) return
        const channels = [...groups.flatMap((group) => group.channels), ...ungrouped]
        const byId = new Map(channels.map((channel) => [channel.id, channel]))
        setLoad({ catalogue: byId, failed: false })
        pruneRecents(new Set(byId.keys()))
      },
      () => {
        if (!cancelled) setLoad({ catalogue: null, failed: true })
      },
    )
    return () => {
      cancelled = true
    }
  }, [pruneRecents, dispatcharrOn])

  return dispatcharrOn ? load : NOT_SET_UP
}

/**
 * The grouped channel catalogue by channel id, loaded once per mount; null
 * while loading or when it can't be loaded (non-fatal: callers just go
 * without the channels, as the Recent row does).
 */
export function useChannelCatalogue(): Map<string, Channel> | null {
  return useChannelCatalogueLoad().catalogue
}
