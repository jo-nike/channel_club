import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { getErsatzTVStreamUrl, getErsatzTVLogoUrl } from '@/services/ersatztvApi'
import { HLSVideoPlayer } from '@/components/ersatztv/HLSVideoPlayer'
import { EPGGrid } from '@/components/ersatztv/EPGGrid'
import { EPGChannelSidebar } from '@/components/ersatztv/EPGChannelSidebar'
import { ProgrammeDetailsModal } from '@/components/ersatztv/ProgrammeDetailsModal'
import { Button } from '@/components/ui/button'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import type { ErsatzTVProgramme, ErsatzTVChannel } from '@/types'

// Refresh interval for programme data (5 minutes)
const REFRESH_INTERVAL = 5 * 60 * 1000

export function ErsatzTVView() {
  const {
    channels,
    selectedChannel,
    loading,
    error,
    loadChannels,
    selectChannel,
    loadProgrammes,
  } = useErsatztvStore()

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedProgramme, setSelectedProgramme] =
    useState<ErsatzTVProgramme | null>(null)
  const [modalChannel, setModalChannel] = useState<ErsatzTVChannel | null>(null)

  // Responsive
  const isMobile = useMediaQuery('(max-width: 768px)')

  // Stream URL for current channel
  const streamUrl = selectedChannel
    ? getErsatzTVStreamUrl(selectedChannel.id)
    : null

  // Load channels on mount
  useEffect(() => {
    loadChannels()
  }, [loadChannels])

  // Auto-select first channel when loaded
  useEffect(() => {
    if (channels.length > 0 && !selectedChannel) {
      selectChannel(channels[0])
    }
  }, [channels, selectedChannel, selectChannel])

  // Auto-refresh programme data
  useEffect(() => {
    const refreshProgrammes = () => {
      if (selectedChannel) {
        loadProgrammes(selectedChannel.id)
      }
    }

    const interval = setInterval(refreshProgrammes, REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [selectedChannel, loadProgrammes])

  // Handle programme click from grid
  const handleProgrammeClick = useCallback(
    (programme: ErsatzTVProgramme, channel: ErsatzTVChannel) => {
      setSelectedProgramme(programme)
      setModalChannel(channel)
      setModalOpen(true)
    },
    []
  )

  // Handle watch from modal
  const handleWatch = useCallback(
    (channel: ErsatzTVChannel) => {
      selectChannel(channel)
      setModalOpen(false)
    },
    [selectChannel]
  )

  // Handle channel selection from sidebar
  const handleChannelSelect = useCallback(
    (channel: ErsatzTVChannel) => {
      selectChannel(channel)
    },
    [selectChannel]
  )

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between border-b bg-card px-4 py-2">
        <div className="flex items-center gap-4">
          <Link to="/">
            <Button variant="ghost" size="sm">
              ← Live TV
            </Button>
          </Link>
          <h1 className="text-lg font-semibold">Movie Channels</h1>
        </div>

        {/* Current channel indicator */}
        {selectedChannel && (
          <div className="text-sm text-muted-foreground">
            Now watching:{' '}
            <span className="font-medium">{selectedChannel.name}</span>
          </div>
        )}
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Desktop: Sidebar */}
        {!isMobile && <EPGChannelSidebar onChannelSelect={handleChannelSelect} />}

        {/* Content area */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {/* Video player */}
          <div className="relative aspect-video w-full flex-shrink-0 bg-black">
            {streamUrl ? (
              <HLSVideoPlayer
                streamUrl={streamUrl}
                title={selectedChannel?.name}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-muted-foreground">
                  {loading
                    ? 'Loading channels...'
                    : 'Select a channel to start watching'}
                </p>
              </div>
            )}
          </div>

          {/* EPG section */}
          <div className="flex-1 overflow-y-auto">
            {isMobile ? (
              <MobileChannelList
                channels={channels}
                selectedChannel={selectedChannel}
                onChannelSelect={handleChannelSelect}
              />
            ) : (
              <EPGGrid hours={6} onProgrammeClick={handleProgrammeClick} />
            )}
          </div>
        </main>
      </div>

      {/* Programme details modal */}
      <ProgrammeDetailsModal
        programme={selectedProgramme}
        channel={modalChannel}
        open={modalOpen}
        onOpenChange={setModalOpen}
        onWatch={handleWatch}
      />

      {/* Error toast */}
      {error && (
        <div className="fixed bottom-4 right-4 rounded-lg bg-destructive px-4 py-2 text-destructive-foreground">
          {error}
        </div>
      )}
    </div>
  )
}

// Mobile card layout
interface MobileChannelListProps {
  channels: ErsatzTVChannel[]
  selectedChannel: ErsatzTVChannel | null
  onChannelSelect: (channel: ErsatzTVChannel) => void
}

function MobileChannelList({
  channels,
  selectedChannel,
  onChannelSelect,
}: MobileChannelListProps) {
  return (
    <div className="space-y-2 p-4">
      <h2 className="text-lg font-semibold">Channels</h2>
      <div className="grid grid-cols-1 gap-2">
        {channels.map((channel) => (
          <button
            key={channel.id}
            onClick={() => onChannelSelect(channel)}
            className={`
              flex items-center gap-3 rounded-lg border p-3 text-left
              transition-colors hover:bg-accent
              ${selectedChannel?.id === channel.id ? 'border-primary bg-primary/10' : ''}
            `}
          >
            <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded bg-muted">
              <img
                src={getErsatzTVLogoUrl(channel.id)}
                alt=""
                className="h-full w-full object-contain"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{channel.name}</p>
              <p className="text-sm text-muted-foreground">{channel.group}</p>
            </div>
            {selectedChannel?.id === channel.id && (
              <span className="h-3 w-3 animate-pulse rounded-full bg-primary" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
