import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Tv, LayoutList, RefreshCw } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useUIStore } from '@/stores/uiStore'
import { getErsatzTVStreamUrl, getErsatzTVLogoUrl } from '@/services/ersatztvApi'
import { HLSVideoPlayer } from '@/components/ersatztv/HLSVideoPlayer'
import { EPGGrid } from '@/components/ersatztv/EPGGrid'
import { EPGChannelSidebar } from '@/components/ersatztv/EPGChannelSidebar'
import { ProgrammeDetailsModal } from '@/components/ersatztv/ProgrammeDetailsModal'
import { ResizeDragHandle } from '@/components/ui/ResizeDragHandle'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useResizable } from '@/hooks/useResizable'
import { useMobileLandscape } from '@/hooks/useMobileLandscape'
import { ThemePicker } from '@/components/ThemePicker'
import { cn } from '@/lib/utils'
import type { ErsatzTVProgramme, ErsatzTVChannel } from '@/types'

// Refresh interval for programme data (5 minutes)
const REFRESH_INTERVAL = 5 * 60 * 1000

export function ErsatzTVView() {
  const { logout } = useAuth()
  const navigate = useNavigate()

  // Initialize theme - ensures theme syncs across views
  useTheme()
  const {
    channels,
    selectedChannel,
    channelsLoading,
    programmesLoading,
    programmesByChannel,
    error,
    loadChannels,
    selectChannel,
    loadAllProgrammes,
  } = useErsatztvStore()

  const setLastRoute = useUIStore((s) => s.setLastRoute)
  const isEPGVisible = useUIStore((s) => s.isEPGVisible)
  const toggleEPG = useUIStore((s) => s.toggleEPG)
  const epgHeightPercent = useUIStore((s) => s.epgHeightPercent)
  const setEPGHeightPercent = useUIStore((s) => s.setEPGHeightPercent)
  const isChannelSidebarCollapsed = useUIStore((s) => s.isChannelSidebarCollapsed)
  const toggleChannelSidebar = useUIStore((s) => s.toggleChannelSidebar)
  const lastErsatzTVChannelId = useUIStore((s) => s.lastErsatzTVChannelId)
  const setLastErsatzTVChannelId = useUIStore((s) => s.setLastErsatzTVChannelId)
  const isTheaterMode = useUIStore((s) => s.isTheaterMode)
  const setTheaterMode = useUIStore((s) => s.setTheaterMode)
  const toggleTheaterMode = useUIStore((s) => s.toggleTheaterMode)

  // Handle Escape key to exit theater mode or fullscreen
  const handleEscape = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else if (isTheaterMode) {
      setTheaterMode(false)
    }
  }, [isTheaterMode, setTheaterMode])

  useEscapeKey({ onEscape: handleEscape })

  // Track that user visited this route
  useEffect(() => {
    setLastRoute('/ersatztv')
  }, [setLastRoute])

  // Container ref for measuring height
  const containerRef = useRef<HTMLDivElement>(null)

  // Resize hook for EPG
  const { isDragging, handleMouseDown } = useResizable({
    initialHeightPercent: epgHeightPercent,
    minHeightPercent: 15,
    maxHeightPercent: 50,
    containerRef,
    onHeightChange: setEPGHeightPercent,
  })

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedProgramme, setSelectedProgramme] =
    useState<ErsatzTVProgramme | null>(null)
  const [modalChannel, setModalChannel] = useState<ErsatzTVChannel | null>(null)

  // Video refresh key
  const [videoRefreshKey, setVideoRefreshKey] = useState(0)

  // Responsive
  const isMobile = useMediaQuery('(max-width: 768px)')

  // Detect mobile landscape for CSS-based pseudo-fullscreen
  const isMobileLandscape = useMobileLandscape()

  // Stream URL for current channel
  const streamUrl = selectedChannel
    ? getErsatzTVStreamUrl(selectedChannel.id)
    : null

  // Get currently playing programme for header display
  const currentProgramme = selectedChannel
    ? programmesByChannel[selectedChannel.id]?.find((p) => {
        const now = new Date()
        return new Date(p.start) <= now && new Date(p.stop) > now
      })
    : null

  // Load channels on mount
  useEffect(() => {
    loadChannels()
  }, [loadChannels])

  // Load all programmes after channels are loaded
  useEffect(() => {
    if (channels.length > 0) {
      loadAllProgrammes(6)
    }
  }, [channels.length, loadAllProgrammes])

  // Auto-select last used channel (or first) when loaded
  useEffect(() => {
    if (channels.length > 0 && !selectedChannel) {
      const savedChannel = lastErsatzTVChannelId
        ? channels.find((c) => c.id === lastErsatzTVChannelId)
        : null
      selectChannel(savedChannel ?? channels[0])
    }
  }, [channels, selectedChannel, selectChannel, lastErsatzTVChannelId])

  // Auto-refresh programme data
  useEffect(() => {
    if (channels.length === 0) return

    const interval = setInterval(() => {
      loadAllProgrammes(6)
    }, REFRESH_INTERVAL)

    return () => clearInterval(interval)
  }, [channels.length, loadAllProgrammes])

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
      setLastErsatzTVChannelId(channel.id)
      setModalOpen(false)
    },
    [selectChannel, setLastErsatzTVChannelId]
  )

  // Handle channel selection from sidebar
  const handleChannelSelect = useCallback(
    (channel: ErsatzTVChannel) => {
      selectChannel(channel)
      setLastErsatzTVChannelId(channel.id)
    },
    [selectChannel, setLastErsatzTVChannelId]
  )

  // Handle Live TV navigation - update state synchronously before navigating
  // to avoid race condition with async effects
  const handleLiveTVClick = useCallback(() => {
    setLastRoute('/')
    navigate('/')
  }, [setLastRoute, navigate])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Header - hidden in theater mode or mobile landscape */}
      {!isTheaterMode && !isMobileLandscape && (
      <header className="flex justify-between items-center px-4 py-2 bg-background border-b">
        <div className="flex items-center gap-4">
          {/* Theme picker - consistent with MainView placement */}
          <ThemePicker />
          {/* Current programme info */}
          <span className="text-muted-foreground text-sm">
            {selectedChannel?.name && currentProgramme
              ? `${selectedChannel.name} - ${currentProgramme.title}`
              : selectedChannel?.name || 'No programme'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* EPG toggle button - desktop only */}
          {!isMobile && (
            <button
              onClick={toggleEPG}
              className={`
                h-8 px-3 flex items-center gap-2 rounded-md text-sm
                focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
                ${isEPGVisible ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80' : 'bg-muted text-muted-foreground hover:bg-muted/80'}
              `}
              aria-pressed={isEPGVisible}
              aria-label={isEPGVisible ? 'Hide EPG guide' : 'Show EPG guide'}
            >
              <LayoutList className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline">EPG</span>
            </button>
          )}

          {/* Live TV button - uses callback to ensure state sync before navigation */}
          <button
            onClick={handleLiveTVClick}
            className="h-8 px-3 md:w-[130px] flex items-center justify-center gap-2 bg-secondary text-secondary-foreground rounded-md text-sm hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <Tv className="h-4 w-4 shrink-0" />
            <span className="hidden md:inline">Live TV</span>
          </button>
          <button
            onClick={() => setVideoRefreshKey((k) => k + 1)}
            className="h-8 w-8 flex items-center justify-center bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label="Refresh video"
            title="Refresh video"
          >
            <RefreshCw className="h-4 w-4 shrink-0" />
          </button>
          <button
            onClick={logout}
            className="h-8 px-3 text-sm whitespace-nowrap shrink-0 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            Logout
          </button>
        </div>
      </header>
      )}

      {/* Main content */}
      <div ref={containerRef} className="flex flex-1 min-h-0 overflow-hidden">
        {/* Desktop: Collapsible Sidebar - hidden in theater mode/landscape */}
        {!isMobile && !isTheaterMode && !isMobileLandscape && (
          <EPGChannelSidebar
            onChannelSelect={handleChannelSelect}
            isCollapsed={isChannelSidebarCollapsed}
            onToggleCollapse={toggleChannelSidebar}
          />
        )}

        {/* Content area */}
        <main className="flex flex-1 flex-col min-h-0 overflow-hidden">
          {/* Video player - fixed full viewport in theater mode or mobile landscape */}
          <div
            className={cn(
              'relative w-full min-h-0 overflow-hidden bg-black',
              (isTheaterMode || isMobileLandscape) && 'fixed inset-0 z-50'
            )}
            style={!isTheaterMode && !isMobileLandscape && isEPGVisible && !isMobile ? { flex: `1 1 ${100 - epgHeightPercent}%` } : !isTheaterMode && !isMobileLandscape ? { flex: '1 1 100%' } : undefined}
          >
            {streamUrl ? (
              <div key={videoRefreshKey} className="h-full w-full">
                <HLSVideoPlayer
                  streamUrl={streamUrl}
                  title={selectedChannel?.name}
                  isTheaterMode={isTheaterMode}
                  isMobile={isMobile}
                  onTheaterModeToggle={toggleTheaterMode}
                />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-muted-foreground">
                  {channelsLoading
                    ? 'Loading channels...'
                    : 'Select a channel to start watching'}
                </p>
              </div>
            )}
          </div>

          {/* Resize handle - only on desktop when EPG visible, hidden in theater/landscape */}
          {!isMobile && isEPGVisible && !isTheaterMode && !isMobileLandscape && (
            <ResizeDragHandle
              onMouseDown={handleMouseDown}
              isDragging={isDragging}
            />
          )}

          {/* EPG section - hidden in theater mode or mobile landscape */}
          {!isTheaterMode && !isMobileLandscape && (isMobile || isEPGVisible) && (
            <div
              className="epg-scroll min-h-0 overflow-y-auto"
              style={!isMobile && isEPGVisible ? { flex: `0 0 ${epgHeightPercent}%` } : { flex: '1 1 auto' }}
            >
              {isMobile ? (
                <MobileChannelList
                  channels={channels}
                  selectedChannel={selectedChannel}
                  programmesByChannel={programmesByChannel}
                  onChannelSelect={handleChannelSelect}
                />
              ) : (
                <EPGGrid
                  hours={6}
                  programmesByChannel={programmesByChannel}
                  loading={programmesLoading}
                  onProgrammeClick={handleProgrammeClick}
                  onChannelClick={handleChannelSelect}
                />
              )}
            </div>
          )}
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
  programmesByChannel: Record<string, ErsatzTVProgramme[]>
  onChannelSelect: (channel: ErsatzTVChannel) => void
}

function MobileChannelList({
  channels,
  selectedChannel,
  programmesByChannel,
  onChannelSelect,
}: MobileChannelListProps) {
  // Helper to get current programme for a channel
  const getCurrentProgramme = (channelId: string): ErsatzTVProgramme | undefined => {
    const programmes = programmesByChannel[channelId]
    if (!programmes) return undefined
    const now = new Date()
    return programmes.find((p) => new Date(p.start) <= now && new Date(p.stop) > now)
  }

  return (
    <div className="space-y-2 p-4">
      <h2 className="text-lg font-semibold">Channels</h2>
      <div className="grid grid-cols-1 gap-2">
        {channels.map((channel) => {
          const currentProgramme = getCurrentProgramme(channel.id)
          return (
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
                <p className="truncate text-sm text-muted-foreground">
                  {currentProgramme?.title || channel.group}
                </p>
              </div>
              {selectedChannel?.id === channel.id && (
                <span className="h-3 w-3 animate-pulse rounded-full bg-primary" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
