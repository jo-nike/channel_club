import { useEffect, useState, useCallback, useRef } from 'react'
import { Settings, LayoutList, RefreshCw } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useChannelStore } from '@/stores/channelStore'
import { useTVStore, initializeTVStore } from '@/stores/tvStore'
import { useUIStore } from '@/stores/uiStore'
import { DualModeVideoPlayer } from '@/components/tv/DualModeVideoPlayer'
import { TVEPGGrid } from '@/components/tv/TVEPGGrid'
import { TVChannelSidebar } from '@/components/tv/TVChannelSidebar'
import { ProgrammeDetailsModal } from '@/components/ersatztv/ProgrammeDetailsModal'
import { ResizeDragHandle } from '@/components/ui/ResizeDragHandle'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useResizable } from '@/hooks/useResizable'
import { useMobileLandscape } from '@/hooks/useMobileLandscape'
import { ThemePicker } from '@/components/ThemePicker'
import { NotificationToggle } from '@/components/NotificationToggle'
import { AdminModal } from '@/components/AdminModal'
import { ConnectionStatus } from '@/components/ConnectionStatus'
import { cn } from '@/lib/utils'
import type { ErsatzTVProgramme, UnifiedChannel, ErsatzTVChannel } from '@/types'

// Refresh interval for programme data (120 minutes)
const REFRESH_INTERVAL = 120 * 60 * 1000

export function TVView() {
  const { logout, isAdmin } = useAuth()

  // WebSocket for presence tracking
  const { status, sendChannelUpdate } = useWebSocket({ view: 'tv' })

  // Initialize theme
  useTheme()

  // ErsatzTV store - for loading channels and programmes
  const {
    channels: ersatzTVChannels,
    programmesLoading,
    programmesByChannel,
    error,
    loadChannels,
    loadAllProgrammes,
  } = useErsatztvStore()

  // Live channel from channel store
  const liveChannel = useChannelStore((s) => s.currentChannel)

  // TV store - unified channel management
  const {
    selectedChannel,
    selectChannel,
    liveEPG,
    loadLiveEPG,
    getUnifiedChannels,
  } = useTVStore()

  // UI state
  const setLastRoute = useUIStore((s) => s.setLastRoute)
  const isEPGVisible = useUIStore((s) => s.isEPGVisible)
  const toggleEPG = useUIStore((s) => s.toggleEPG)
  const epgHeightPercent = useUIStore((s) => s.epgHeightPercent)
  const setEPGHeightPercent = useUIStore((s) => s.setEPGHeightPercent)
  const isChannelSidebarCollapsed = useUIStore((s) => s.isChannelSidebarCollapsed)
  const toggleChannelSidebar = useUIStore((s) => s.toggleChannelSidebar)
  const isTheaterMode = useUIStore((s) => s.isTheaterMode)
  const setTheaterMode = useUIStore((s) => s.setTheaterMode)
  const toggleTheaterMode = useUIStore((s) => s.toggleTheaterMode)

  // Handle Escape key
  const handleEscape = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else if (isTheaterMode) {
      setTheaterMode(false)
    }
  }, [isTheaterMode, setTheaterMode])

  useEscapeKey({ onEscape: handleEscape })

  // Get currently playing programme for presence tracking
  const currentProgrammeTitle = (() => {
    if (!selectedChannel) return null

    if (selectedChannel.type === 'live') {
      return liveEPG?.currentProgram?.title ?? null
    }

    const programmes = programmesByChannel[selectedChannel.id]
    if (!programmes) return null
    const now = new Date()
    const current = programmes.find(
      (p) => new Date(p.start) <= now && new Date(p.stop) > now
    )
    return current?.title ?? null
  })()

  // Track that user visited this route (now at root)
  useEffect(() => {
    setLastRoute('/')
  }, [setLastRoute])

  // Send channel updates for presence tracking (including view type for unified view)
  useEffect(() => {
    if (status === 'connected') {
      const viewType = selectedChannel?.type === 'ersatztv' ? 'ersatztv' : 'live'
      sendChannelUpdate(selectedChannel?.name ?? null, currentProgrammeTitle, viewType)
    }
  }, [selectedChannel, currentProgrammeTitle, sendChannelUpdate, status])

  // Container ref for resize
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
  const [selectedProgramme, setSelectedProgramme] = useState<ErsatzTVProgramme | null>(null)
  const [modalChannel, setModalChannel] = useState<ErsatzTVChannel | null>(null)

  // Admin modal state
  const [adminModalOpen, setAdminModalOpen] = useState(false)

  // Video refresh key
  const [videoRefreshKey, setVideoRefreshKey] = useState(0)

  // Responsive
  const isMobile = useMediaQuery('(max-width: 768px)')
  const isMobileLandscape = useMobileLandscape()

  // Load channels on mount
  useEffect(() => {
    loadChannels()
  }, [loadChannels])

  // Load all programmes after channels are loaded
  useEffect(() => {
    if (ersatzTVChannels.length > 0) {
      loadAllProgrammes(6)
    }
  }, [ersatzTVChannels.length, loadAllProgrammes])

  // Initialize TV store after channels are loaded
  useEffect(() => {
    if (ersatzTVChannels.length > 0) {
      initializeTVStore()
    }
  }, [ersatzTVChannels.length, liveChannel])

  // Load live EPG when live channel changes
  useEffect(() => {
    if (liveChannel) {
      loadLiveEPG()
    }
  }, [liveChannel, loadLiveEPG])

  // Auto-refresh programme data (silent to avoid flash)
  useEffect(() => {
    if (ersatzTVChannels.length === 0) return

    const interval = setInterval(() => {
      loadAllProgrammes(6, true) // silent refresh to avoid skeleton flash
      if (selectedChannel?.type === 'live') {
        loadLiveEPG()
      }
    }, REFRESH_INTERVAL)

    return () => clearInterval(interval)
  }, [ersatzTVChannels.length, loadAllProgrammes, loadLiveEPG, selectedChannel?.type])

  // Handle programme click from grid
  const handleProgrammeClick = useCallback(
    (programme: ErsatzTVProgramme, channel: UnifiedChannel) => {
      // Convert UnifiedChannel to ErsatzTVChannel for modal compatibility
      if (channel.type === 'ersatztv') {
        const ersatzChannel = ersatzTVChannels.find((c) => c.id === channel.id)
        if (ersatzChannel) {
          setSelectedProgramme(programme)
          setModalChannel(ersatzChannel)
          setModalOpen(true)
        }
      }
      // For live channel, just select the channel
      if (channel.type === 'live') {
        selectChannel(channel)
      }
    },
    [ersatzTVChannels, selectChannel]
  )

  // Handle watch from modal
  const handleWatch = useCallback(
    (channel: ErsatzTVChannel) => {
      // Find the unified channel and select it
      const unifiedChannels = getUnifiedChannels()
      const unified = unifiedChannels.find((c) => c.id === channel.id)
      if (unified) {
        selectChannel(unified)
      }
      setModalOpen(false)
    },
    [getUnifiedChannels, selectChannel]
  )

  // Handle channel selection from sidebar or EPG
  const handleChannelSelect = useCallback(
    (channel: UnifiedChannel) => {
      selectChannel(channel)
    },
    [selectChannel]
  )

  // Live EPG title for sidebar
  const liveEPGTitle = liveEPG?.currentProgram?.title ?? null

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Header - hidden in theater mode or mobile landscape */}
      {!isTheaterMode && !isMobileLandscape && (
        <header className="flex justify-between items-center px-4 py-2 bg-background border-b rounded-b-lg">
          <div className="flex items-center gap-4">
            {/* Connection status indicator */}
            <ConnectionStatus status={status} />
            {/* Current channel/programme info */}
            <span className="text-muted-foreground text-sm">
              {selectedChannel?.name && currentProgrammeTitle
                ? `${selectedChannel.name} - ${currentProgrammeTitle}`
                : selectedChannel?.name || 'Select a channel'}
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
            {/* Admin button */}
            {isAdmin && (
              <button
                onClick={() => setAdminModalOpen(true)}
                className="h-8 w-8 flex items-center justify-center bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                aria-label="Open admin panel"
              >
                <Settings className="h-4 w-4 shrink-0" />
              </button>
            )}
            {/* Refresh video button */}
            <button
              onClick={() => setVideoRefreshKey((k) => k + 1)}
              className="h-8 w-8 flex items-center justify-center bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              aria-label="Refresh video"
              title="Refresh video"
            >
              <RefreshCw className="h-4 w-4 shrink-0" />
            </button>
            {/* Theme picker */}
            <ThemePicker />
            {/* Notification toggle */}
            <NotificationToggle />
            {/* Logout button */}
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
          <TVChannelSidebar
            isCollapsed={isChannelSidebarCollapsed}
            onToggleCollapse={toggleChannelSidebar}
            liveEPGTitle={liveEPGTitle}
          />
        )}

        {/* Content area */}
        <main className="flex flex-1 flex-col min-h-0 overflow-hidden">
          {/* Video player - fixed full viewport in theater mode or mobile landscape */}
          <div
            className={cn(
              'relative w-full min-h-0 overflow-hidden bg-black',
              (isTheaterMode || isMobileLandscape) && 'fixed inset-0 z-50',
              !isTheaterMode && !isMobileLandscape && 'rounded-lg'
            )}
            style={
              !isTheaterMode && !isMobileLandscape && isEPGVisible && !isMobile
                ? { flex: `1 1 ${100 - epgHeightPercent}%` }
                : !isTheaterMode && !isMobileLandscape
                ? { flex: '1 1 100%' }
                : undefined
            }
          >
            <div key={videoRefreshKey} className="h-full w-full">
              <DualModeVideoPlayer
                channel={selectedChannel}
                isTheaterMode={isTheaterMode}
                isMobile={isMobile}
                onTheaterModeToggle={toggleTheaterMode}
              />
            </div>
          </div>

          {/* Resize handle - only on desktop when EPG visible, hidden in theater/landscape */}
          {!isMobile && isEPGVisible && !isTheaterMode && !isMobileLandscape && (
            <ResizeDragHandle onMouseDown={handleMouseDown} isDragging={isDragging} />
          )}

          {/* EPG section - hidden in theater mode or mobile landscape */}
          {!isTheaterMode && !isMobileLandscape && (isMobile || isEPGVisible) && (
            <div
              className="epg-scroll min-h-0 overflow-y-auto rounded-t-lg"
              style={
                !isMobile && isEPGVisible
                  ? { flex: `0 0 ${epgHeightPercent}%` }
                  : { flex: '1 1 auto' }
              }
            >
              {isMobile ? (
                <MobileChannelList
                  onChannelSelect={handleChannelSelect}
                  liveEPGTitle={liveEPGTitle}
                />
              ) : (
                <TVEPGGrid
                  hours={6}
                  programmesByChannel={programmesByChannel}
                  loading={programmesLoading}
                  liveEPG={liveEPG}
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

      {/* Admin Modal */}
      {isAdmin && (
        <AdminModal open={adminModalOpen} onOpenChange={setAdminModalOpen} />
      )}

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
  onChannelSelect: (channel: UnifiedChannel) => void
  liveEPGTitle?: string | null
}

function MobileChannelList({ onChannelSelect, liveEPGTitle }: MobileChannelListProps) {
  const { getUnifiedChannels, isLiveChannelActive, selectedChannel } = useTVStore()
  const { programmesByChannel } = useErsatztvStore()

  const unifiedChannels = getUnifiedChannels()
  const hasLiveChannel = isLiveChannelActive()

  // Helper to get current programme for a channel
  const getCurrentProgramme = (channel: UnifiedChannel): string | undefined => {
    if (channel.type === 'live') {
      return liveEPGTitle ?? (hasLiveChannel ? 'Broadcasting...' : 'Awaiting broadcast...')
    }
    const programmes = programmesByChannel[channel.id]
    if (!programmes) return undefined
    const now = new Date()
    const current = programmes.find(
      (p) => new Date(p.start) <= now && new Date(p.stop) > now
    )
    return current?.title
  }

  return (
    <div className="space-y-2 p-4">
      <h2 className="text-lg font-semibold">Channels</h2>
      <div className="grid grid-cols-1 gap-2">
        {unifiedChannels.map((channel) => {
          const isLive = channel.type === 'live'
          const currentProgramme = getCurrentProgramme(channel)

          return (
            <button
              key={channel.id}
              onClick={() => onChannelSelect(channel)}
              className={`
                flex items-center gap-3 rounded-lg border p-3 text-left
                transition-colors hover:bg-accent
                ${selectedChannel?.id === channel.id ? 'border-primary bg-primary/10' : ''}
                ${isLive ? 'bg-destructive/5' : ''}
              `}
            >
              <div
                className={`h-12 w-12 flex-shrink-0 overflow-hidden rounded flex items-center justify-center ${
                  isLive ? 'bg-destructive/20' : 'bg-muted'
                }`}
              >
                {isLive ? (
                  <span className="text-xs font-bold text-destructive">
                    {hasLiveChannel ? 'LIVE' : '0'}
                  </span>
                ) : (
                  <span className="text-sm font-medium">{channel.number}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium">
                    {isLive ? (hasLiveChannel ? channel.name : 'Live') : channel.name}
                  </p>
                  {isLive && hasLiveChannel && (
                    <span className="rounded bg-destructive px-1.5 py-0.5 text-[10px] font-bold uppercase text-destructive-foreground">
                      Live
                    </span>
                  )}
                </div>
                <p className="truncate text-sm text-muted-foreground">
                  {currentProgramme || channel.group}
                </p>
              </div>
              {selectedChannel?.id === channel.id && (
                <span
                  className={`h-3 w-3 animate-pulse rounded-full ${
                    isLive ? 'bg-destructive' : 'bg-primary'
                  }`}
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
