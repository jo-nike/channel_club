import { useEffect, useState, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { X, Search, Square } from 'lucide-react'
import { useChannelStore } from '@/stores/channelStore'
import { useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { fetchGroupedChannels, fetchNowPlayingAll, clearCurrentChannel as clearCurrentChannelApi } from '@/services/api'
import { useSetLiveChannel } from '@/hooks/useSetLiveChannel'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CollapsibleChannelGroup } from '@/components/CollapsibleChannelGroup'
import { StopLiveTVDialog } from '@/components/StopLiveTVDialog'
import type { Channel, GroupedChannelsResponse, Program } from '@/types'

interface ChannelListProps {
  onChannelSelected?: () => void
}

export function ChannelList({ onChannelSelected }: ChannelListProps = {}) {
  const { currentChannel, setCurrentChannel } = useChannelStore()
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

  const handleClearChannel = useCallback(async () => {
    if (!isAdmin) return

    const previousChannel = currentChannel
    setCurrentChannel(null)

    // If callback provided (modal context), call it
    // Otherwise use existing sidebar close behavior
    if (onChannelSelected) {
      onChannelSelected()
    } else {
      setSidebarOpen(false)
    }

    try {
      await clearCurrentChannelApi()
    } catch (e) {
      // Revert on failure
      setCurrentChannel(previousChannel)
      toast.error('Could not stop live TV', {
        description: e instanceof Error ? e.message : 'Please try again',
      })
    }
  }, [isAdmin, currentChannel, setCurrentChannel, setSidebarOpen, onChannelSelected])

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

      {/* Stop live TV - admin only, and only while something is live. It stops
          the shared broadcast for everyone, so it asks first. */}
      {currentChannel && isAdmin && (
        // Keyed by channel so an open confirm is dropped when live TV stops or
        // changes elsewhere, instead of reopening when a channel is next picked
        <StopLiveTVControl
          key={currentChannel.id}
          channelName={currentChannel.name}
          onConfirm={handleClearChannel}
        />
      )}

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

function StopLiveTVControl({ channelName, onConfirm }: { channelName: string; onConfirm: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <div className="flex justify-end">
      <Button
        variant="outline"
        size="sm"
        className="text-destructive"
        onClick={() => setConfirmOpen(true)}
      >
        <Square />
        Stop live TV…
      </Button>
      <StopLiveTVDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        channelName={channelName}
        onConfirm={() => {
          setConfirmOpen(false)
          onConfirm()
        }}
      />
    </div>
  )
}
