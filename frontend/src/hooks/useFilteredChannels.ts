import { useMemo } from 'react'
import { useChannelPrefsStore } from '@/stores/channelPrefsStore'
import { useDebounce } from '@/hooks/useDebounce'
import { useProgrammeClock } from '@/hooks/useProgrammeClock'
import { buildTitleIndex, filterChannels, isFilterActive } from '@/lib/channelSearch'
import type { ErsatzTVProgramme, UnifiedChannel } from '@/types'

/** How long typing must pause before the list follows the search box. */
export const SEARCH_DEBOUNCE_MS = 150

interface FilteredChannels {
  /** The channels the filter leaves, row 0 first. */
  channels: UnifiedChannel[]
  /** Whether the filter narrows the list (a query, or Favourites or Recent). */
  isFiltering: boolean
}

/**
 * The channel list through the shared filter (channelPrefsStore), for the
 * sidebar and the guide. The search box writes every keystroke to the
 * store; the list follows once typing pauses. Titles are searched in
 * programmesByChannel (the ErsatzTV guide).
 */
export function useFilteredChannels(
  channels: UnifiedChannel[],
  programmesByChannel: Record<string, readonly ErsatzTVProgramme[]>
): FilteredChannels {
  const mode = useChannelPrefsStore((s) => s.filter.mode)
  const typedQuery = useChannelPrefsStore((s) => s.filter.query)
  const favouriteChannelIds = useChannelPrefsStore((s) => s.favouriteChannelIds)
  const recentChannelIds = useChannelPrefsStore((s) => s.recentChannelIds)
  const query = useDebounce(typedQuery, SEARCH_DEBOUNCE_MS)
  const now = useProgrammeClock()
  // Cached per programme refresh and hour, so this is a lookup on most renders
  const titleIndex = buildTitleIndex(programmesByChannel, now)

  return useMemo(() => {
    const filter = { query, mode }
    return {
      channels: filterChannels(channels, filter, { favouriteChannelIds, recentChannelIds, titleIndex, nowMs: now }),
      isFiltering: isFilterActive(filter),
    }
  }, [channels, query, mode, favouriteChannelIds, recentChannelIds, titleIndex, now])
}
