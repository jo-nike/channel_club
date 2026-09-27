import { useEffect, useState, useCallback, useMemo } from 'react'
import { X, Search } from 'lucide-react'
import { useChannelStore } from '@/stores/channelStore'
import { useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { fetchGroupedChannels, fetchNowPlayingAll } from '@/services/api'
import { useSetLiveChannel } from '@/hooks/useSetLiveChannel'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CollapsibleChannelGroup } from '@/components/CollapsibleChannelGroup'
import type { Channel, GroupedChannelsResponse, Program } from '@/types'

interface ChannelListProps {
  onChannelSelected?: () => void
}

export function ChannelList({ onChannelSelected }: ChannelListProps = {}) {
  const { currentChannel } = useChannelStore()
  const { role } = useAuthStore()
  const userChannelSelection = useSettingsStore((s) => s.userChannelSelection)
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
  const setLiveChannel = useSetLiveChannel()
  const isAdmin = role === 'admin'
  // Admins always may; everyone else only when the admin has opened it up
  const canSelect = isAdmin || userChannelSelection

  const [groupedData, setGroupedData] = useState<GroupedChannelsResponse | null>(null)
  const [nowPlaying, setNowPlaying] = useState<Record<string, Program>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Filter groups and channels based on search query
  const { filteredGroups, filteredUngrouped, expandedGroupIds } = useMemo(() => {
    if (!groupedData) {
      return { filteredGroups: [], filteredUngrouped: [], expandedGroupIds: new Set<number>() }
    }

    const query = searchQuery.toLowerCase().trim()
    if (!query) {
      return {
        filteredGroups: groupedData.groups,
        filteredUngrouped: groupedData.ungrouped,
        expandedGroupIds: new Set<number>(),
      }
    }

    const expandedIds = new Set<number>()
    const filteredGroups = groupedData.groups
      .map((group) => {
        const matchingChannels = group.channels.filter((ch) =>
          ch.name.toLowerCase().includes(query)
        )
        if (matchingChannels.length > 0) {
          expandedIds.add(group.id)
        }
        return {
          ...group,
          channels: matchingChannels,
          channelCount: matchingChannels.length,
        }
      })
      .filter((g) => g.channels.length > 0)

    const filteredUngrouped = groupedData.ungrouped.filter((ch) =>
      ch.name.toLowerCase().includes(query)
    )

    return { filteredGroups, filteredUngrouped, expandedGroupIds: expandedIds }
  }, [groupedData, searchQuery])

  const handleSelectChannel = useCallback(async (channel: Channel) => {
    if (!canSelect) return

    // Switches the store straight away; the request settles below
    const switching = setLiveChannel(channel)

    // If callback provided (modal context), call it
    // Otherwise use existing sidebar close behavior
    if (onChannelSelected) {
      onChannelSelected()
    } else {
      setSidebarOpen(false)
    }

    await switching
  }, [canSelect, setLiveChannel, setSidebarOpen, onChannelSelected])

  useEffect(() => {
    loadGroupedChannels()
    loadNowPlaying()
  }, [])

  async function loadGroupedChannels() {
    setIsLoading(true)
    setError(null)
    try {
      const data = await fetchGroupedChannels()
      setGroupedData(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load channels')
    } finally {
      setIsLoading(false)
    }
  }

  // Non-fatal: without EPG the list still renders, just without programme titles
  async function loadNowPlaying() {
    try {
      setNowPlaying(await fetchNowPlayingAll())
    } catch {
      setNowPlaying({})
    }
  }

  if (isLoading) {
    return <ChannelListSkeleton />
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 p-4">
        <p className="text-destructive">Unable to load channels</p>
        <Button onClick={loadGroupedChannels}>Retry</Button>
      </div>
    )
  }

  const hasChannels = filteredGroups.length > 0 || filteredUngrouped.length > 0
  // The group holding the live channel starts open, so it's in view without hunting
  const containsCurrentChannel = (channels: Channel[]) =>
    currentChannel !== null && channels.some((ch) => ch.id === currentChannel.id)
  const totalChannels = groupedData
    ? groupedData.groups.reduce((sum, g) => sum + g.channels.length, 0) + groupedData.ungrouped.length
    : 0

  if (totalChannels === 0) {
    return (
      <div className="flex items-center justify-center p-4">
        <p className="text-muted-foreground">No channels available</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {/* Search Input */}
      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search channels..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* No matches message */}
      {!hasChannels && searchQuery && (
        <div className="flex items-center justify-center p-4">
          <p className="text-muted-foreground">No channels match "{searchQuery}"</p>
        </div>
      )}

      {/* Channel Groups */}
      <div role="listbox" aria-label="Channel list" className="space-y-2">
        {filteredGroups.map((group) => (
          <CollapsibleChannelGroup
            key={group.id}
            group={group}
            currentChannelId={currentChannel?.id ?? null}
            canSelect={canSelect}
            nowPlaying={nowPlaying}
            onSelectChannel={handleSelectChannel}
            forceOpen={expandedGroupIds.has(group.id)}
            defaultOpen={containsCurrentChannel(group.channels)}
          />
        ))}

        {/* Ungrouped channels */}
        {filteredUngrouped.length > 0 && (
          <CollapsibleChannelGroup
            group={{
              id: -1,
              name: 'Ungrouped',
              channelCount: filteredUngrouped.length,
              channels: filteredUngrouped,
            }}
            currentChannelId={currentChannel?.id ?? null}
            canSelect={canSelect}
            nowPlaying={nowPlaying}
            onSelectChannel={handleSelectChannel}
            forceOpen={searchQuery.length > 0}
            defaultOpen={containsCurrentChannel(filteredUngrouped)}
          />
        )}
      </div>
    </div>
  )
}

function ChannelListSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4">
      {/* Search skeleton */}
      <Skeleton className="h-10 w-full rounded-lg mb-2" />
      {/* Group skeletons */}
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  )
}
