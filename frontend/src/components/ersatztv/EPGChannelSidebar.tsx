import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { getErsatzTVLogoUrl, fetchErsatzTVCurrentProgramme } from '@/services/ersatztvApi'
import type { ErsatzTVChannel } from '@/types'

interface EPGChannelSidebarProps {
  onChannelSelect?: (channel: ErsatzTVChannel) => void
  isCollapsed?: boolean
  onToggleCollapse?: () => void
}

export function EPGChannelSidebar({
  onChannelSelect,
  isCollapsed = false,
  onToggleCollapse,
}: EPGChannelSidebarProps) {
  const {
    channels,
    selectedChannel,
    channelsLoading,
    error,
    loadChannels,
    selectChannel,
  } = useErsatztvStore()

  const [channelProgrammes, setChannelProgrammes] = useState<Record<string, string>>({})

  // Fetch current programmes for all channels
  useEffect(() => {
    const fetchAllCurrentProgrammes = async () => {
      const results: Record<string, string> = {}
      await Promise.all(
        channels.map(async (channel) => {
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

    if (channels.length > 0) {
      fetchAllCurrentProgrammes()
      // Refresh every 5 minutes
      const interval = setInterval(fetchAllCurrentProgrammes, 5 * 60 * 1000)
      return () => clearInterval(interval)
    }
  }, [channels])

  const handleChannelClick = (channel: ErsatzTVChannel) => {
    selectChannel(channel)
    onChannelSelect?.(channel)
  }

  if (channelsLoading && channels.length === 0) {
    return <ChannelSidebarSkeleton isCollapsed={isCollapsed} />
  }

  if (error && channels.length === 0) {
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

  // Collapsed state - narrow strip with channel numbers
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
          {channels.map((channel) => (
            <button
              key={channel.id}
              onClick={() => {
                selectChannel(channel)
                onChannelSelect?.(channel)
              }}
              className={`
                flex h-8 w-8 items-center justify-center rounded bg-muted text-xs font-medium
                hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring
                ${selectedChannel?.id === channel.id ? 'ring-2 ring-primary bg-primary/10' : ''}
              `}
              title={channel.name}
              aria-label={`${channel.number} ${channel.name}`}
              aria-pressed={selectedChannel?.id === channel.id}
            >
              {channel.number}
            </button>
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
        {channels.map((channel) => (
          <ChannelItem
            key={channel.id}
            channel={channel}
            isSelected={selectedChannel?.id === channel.id}
            onSelect={handleChannelClick}
            currentProgramme={channelProgrammes[channel.id]}
          />
        ))}
      </ul>
    </aside>
  )
}

interface ChannelItemProps {
  channel: ErsatzTVChannel
  isSelected: boolean
  onSelect: (channel: ErsatzTVChannel) => void
  currentProgramme?: string
}

function ChannelItem({ channel, isSelected, onSelect, currentProgramme }: ChannelItemProps) {
  return (
    <li>
      <button
        onClick={() => onSelect(channel)}
        className={`
          flex w-full items-center gap-3 p-3 text-left transition-colors
          hover:bg-accent focus:bg-accent focus:outline-none
          focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring
          ${isSelected ? 'bg-primary/10 border-l-4 border-primary' : ''}
        `}
        aria-pressed={isSelected}
        aria-label={`${channel.number} ${channel.name}`}
      >
        {/* Channel logo */}
        <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded bg-muted">
          <img
            src={getErsatzTVLogoUrl(channel.id)}
            alt={`${channel.name} logo`}
            className="h-full w-full object-contain"
            onError={(e) => {
              // Hide broken image
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        </div>

        {/* Channel info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-muted-foreground">
              {channel.number}
            </span>
            <span className="truncate font-medium">{channel.name}</span>
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {currentProgramme || 'Now playing...'}
          </p>
        </div>

        {/* Playing indicator */}
        {isSelected && (
          <div className="flex-shrink-0">
            <span className="inline-flex h-3 w-3 animate-pulse rounded-full bg-primary" />
          </div>
        )}
      </button>
    </li>
  )
}

function ChannelSidebarSkeleton({ isCollapsed = false }: { isCollapsed?: boolean }) {
  if (isCollapsed) {
    return (
      <aside className="flex h-full w-12 flex-col items-center border-r bg-card py-2" role="status" aria-label="Loading channels">
        <div className="h-10 w-10 animate-pulse rounded bg-muted" />
        <div className="mt-2 flex flex-1 flex-col items-center gap-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-8 w-8 animate-pulse rounded bg-muted" />
          ))}
        </div>
      </aside>
    )
  }

  return (
    <aside className="h-full w-72 border-r bg-card" role="status" aria-label="Loading channels">
      <div className="border-b p-4">
        <div className="h-6 w-24 animate-pulse rounded bg-muted" />
      </div>
      <div className="divide-y">
        {Array.from({ length: 8 }).map((_, i) => (
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
