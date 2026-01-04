import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Radio } from 'lucide-react'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore } from '@/stores/tvStore'
import { getErsatzTVLogoUrl, fetchErsatzTVCurrentProgramme } from '@/services/ersatztvApi'
import type { UnifiedChannel } from '@/types'

interface TVChannelSidebarProps {
  isCollapsed?: boolean
  onToggleCollapse?: () => void
  liveEPGTitle?: string | null
}

export function TVChannelSidebar({
  isCollapsed = false,
  onToggleCollapse,
  liveEPGTitle,
}: TVChannelSidebarProps) {
  const { channels: ersatzTVChannels, channelsLoading, error, loadChannels } = useErsatztvStore()
  const { selectedChannel, selectChannel, getUnifiedChannels, isLiveChannelActive } = useTVStore()

  const [channelProgrammes, setChannelProgrammes] = useState<Record<string, string>>({})

  // Get unified channel list
  const unifiedChannels = getUnifiedChannels()
  const hasLiveChannel = isLiveChannelActive()

  // Fetch current programmes for ErsatzTV channels
  useEffect(() => {
    const fetchAllCurrentProgrammes = async () => {
      const results: Record<string, string> = {}
      await Promise.all(
        ersatzTVChannels.map(async (channel) => {
          try {
            const data = await fetchErsatzTVCurrentProgramme(channel.id)
            if (data.current) {
              results[channel.id] = data.current.title
            }
          } catch {
            // Ignore individual failures
          }
        })
      )
      setChannelProgrammes(results)
    }

    if (ersatzTVChannels.length > 0) {
      fetchAllCurrentProgrammes()
      const interval = setInterval(fetchAllCurrentProgrammes, 5 * 60 * 1000)
      return () => clearInterval(interval)
    }
  }, [ersatzTVChannels])

  const handleChannelClick = (channel: UnifiedChannel) => {
    selectChannel(channel)
  }

  if (channelsLoading && ersatzTVChannels.length === 0) {
    return <ChannelSidebarSkeleton isCollapsed={isCollapsed} />
  }

  if (error && ersatzTVChannels.length === 0) {
    return (
      <aside className="flex h-full w-72 items-center justify-center border-r bg-card p-4">
        <div className="text-center">
          <p className="text-destructive">{error}</p>
          <button
            onClick={() => loadChannels()}
            className="mt-2 rounded bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry
          </button>
        </div>
      </aside>
    )
  }

  // Collapsed state
  if (isCollapsed) {
    return (
      <aside className="flex h-full w-12 flex-col items-center border-r bg-card py-2">
        <button
          onClick={onToggleCollapse}
          className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Expand channel sidebar"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        <div className="mt-2 flex flex-1 flex-col items-center gap-1 overflow-y-auto pt-1">
          {unifiedChannels.map((channel) => (
            <CollapsedChannelButton
              key={channel.id}
              channel={channel}
              isSelected={selectedChannel?.id === channel.id}
              hasLiveChannel={hasLiveChannel}
              onSelect={handleChannelClick}
            />
          ))}
        </div>
      </aside>
    )
  }

  // Expanded state
  return (
    <aside className="epg-scroll h-full w-72 overflow-y-auto border-r bg-card">
      <div className="sticky top-0 flex items-center justify-between border-b bg-card/95 p-4 backdrop-blur">
        <h2 className="text-lg font-semibold">Channels</h2>
        <button
          onClick={onToggleCollapse}
          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Collapse channel sidebar"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      </div>

      <ul className="divide-y" role="list">
        {unifiedChannels.map((channel) => (
          <ChannelItem
            key={channel.id}
            channel={channel}
            isSelected={selectedChannel?.id === channel.id}
            onSelect={handleChannelClick}
            currentProgramme={
              channel.type === 'live' ? liveEPGTitle : channelProgrammes[channel.id]
            }
            hasLiveChannel={hasLiveChannel}
          />
        ))}
      </ul>
    </aside>
  )
}

// ============================================================================
// Collapsed Channel Button
// ============================================================================

interface CollapsedChannelButtonProps {
  channel: UnifiedChannel
  isSelected: boolean
  hasLiveChannel: boolean
  onSelect: (channel: UnifiedChannel) => void
}

function CollapsedChannelButton({
  channel,
  isSelected,
  hasLiveChannel,
  onSelect,
}: CollapsedChannelButtonProps) {
  const isLive = channel.type === 'live'

  return (
    <button
      onClick={() => onSelect(channel)}
      className={`
        flex h-8 items-center justify-center rounded text-xs font-medium
        hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring
        ${isLive ? 'w-auto min-w-8 px-1' : 'w-8'}
        ${isSelected ? 'ring-2 ring-primary bg-primary/10' : ''}
        ${isLive && hasLiveChannel ? 'bg-destructive/20 text-destructive' : 'bg-muted'}
      `}
      title={channel.name}
      aria-label={isLive ? 'Live Channel' : `${channel.number} ${channel.name}`}
      aria-pressed={isSelected}
    >
      {isLive ? (
        hasLiveChannel ? (
          <span className="font-bold">LIVE</span>
        ) : (
          '0'
        )
      ) : (
        channel.number
      )}
    </button>
  )
}

// ============================================================================
// Expanded Channel Item
// ============================================================================

interface ChannelItemProps {
  channel: UnifiedChannel
  isSelected: boolean
  onSelect: (channel: UnifiedChannel) => void
  currentProgramme?: string | null
  hasLiveChannel: boolean
}

function ChannelItem({
  channel,
  isSelected,
  onSelect,
  currentProgramme,
  hasLiveChannel,
}: ChannelItemProps) {
  const isLive = channel.type === 'live'

  return (
    <li>
      <button
        onClick={() => onSelect(channel)}
        className={`
          flex w-full items-center gap-3 p-3 text-left transition-colors
          hover:bg-accent focus:bg-accent focus:outline-none
          focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring
          ${isSelected ? 'bg-primary/10 border-l-4 border-primary' : ''}
          ${isLive ? 'bg-destructive/5' : ''}
        `}
        aria-pressed={isSelected}
        aria-label={isLive ? 'Live Channel' : `${channel.number} ${channel.name}`}
      >
        {/* Channel logo / icon */}
        <div
          className={`h-12 w-12 flex-shrink-0 overflow-hidden rounded flex items-center justify-center ${
            isLive ? 'bg-destructive/20' : 'bg-muted'
          }`}
        >
          {isLive ? (
            <Radio className="h-6 w-6 text-destructive" />
          ) : channel.logoUrl ? (
            <img
              src={getErsatzTVLogoUrl(channel.id)}
              alt={`${channel.name} logo`}
              className="h-full w-full object-contain"
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = 'none'
              }}
            />
          ) : null}
        </div>

        {/* Channel info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-muted-foreground">
              {channel.number}
            </span>
            <span className="truncate font-medium">
              {isLive ? (hasLiveChannel ? channel.name : 'Live') : channel.name}
            </span>
            {isLive && hasLiveChannel && (
              <span className="rounded bg-destructive px-1.5 py-0.5 text-[10px] font-bold uppercase text-destructive-foreground">
                Live
              </span>
            )}
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {isLive
              ? hasLiveChannel
                ? currentProgramme || 'Now broadcasting...'
                : 'Awaiting broadcast...'
              : currentProgramme || 'Now playing...'}
          </p>
        </div>

        {/* Playing indicator */}
        {isSelected && (
          <div className="flex-shrink-0">
            <span
              className={`inline-flex h-3 w-3 animate-pulse rounded-full ${
                isLive ? 'bg-destructive' : 'bg-primary'
              }`}
            />
          </div>
        )}
      </button>
    </li>
  )
}

// ============================================================================
// Skeleton
// ============================================================================

function ChannelSidebarSkeleton({ isCollapsed = false }: { isCollapsed?: boolean }) {
  if (isCollapsed) {
    return (
      <aside
        className="flex h-full w-12 flex-col items-center border-r bg-card py-2"
        role="status"
        aria-label="Loading channels"
      >
        <div className="h-10 w-10 animate-pulse rounded bg-muted" />
        <div className="mt-2 flex flex-1 flex-col items-center gap-1">
          {/* Live channel skeleton */}
          <div className="h-8 w-8 animate-pulse rounded bg-destructive/20" />
          {/* Regular channel skeletons */}
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-8 w-8 animate-pulse rounded bg-muted" />
          ))}
        </div>
      </aside>
    )
  }

  return (
    <aside
      className="h-full w-72 border-r bg-card"
      role="status"
      aria-label="Loading channels"
    >
      <div className="border-b p-4">
        <div className="h-6 w-24 animate-pulse rounded bg-muted" />
      </div>
      <div className="divide-y">
        {/* Live channel skeleton */}
        <div className="flex items-center gap-3 p-3 bg-destructive/5">
          <div className="h-12 w-12 animate-pulse rounded bg-destructive/20" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
        {/* Regular channel skeletons */}
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <div className="h-12 w-12 animate-pulse rounded bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
