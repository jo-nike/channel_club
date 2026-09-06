import { useEffect, useState, useCallback, useRef } from 'react'
import { ShieldCheck, LayoutList, RefreshCw, Radio, Tv } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useAppSettings } from '@/hooks/useAppSettings'
import { useTheme } from '@/hooks/useTheme'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useProgrammeClock } from '@/hooks/useProgrammeClock'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useChannelStore } from '@/stores/channelStore'
import { useTVStore, initializeTVStore } from '@/stores/tvStore'
import { getErsatzTVLogoUrl } from '@/services/ersatztvApi'
import { useUIStore } from '@/stores/uiStore'
import { DualModeVideoPlayer } from '@/components/tv/DualModeVideoPlayer'
import { TVEPGGrid } from '@/components/tv/TVEPGGrid'
import { TVChannelSidebar } from '@/components/tv/TVChannelSidebar'
import { ProgrammeDetailsModal } from '@/components/ersatztv/ProgrammeDetailsModal'
import { ChatPanel } from '@/components/ChatPanel'
import { ResizeDragHandle } from '@/components/ui/ResizeDragHandle'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useResizable } from '@/hooks/useResizable'
import { useMobileLandscape } from '@/hooks/useMobileLandscape'
import { ChatToggleButton } from '@/components/ChatToggleButton'
import { UserSettingsMenu } from '@/components/UserSettingsMenu'
import { AdminModal } from '@/components/AdminModal'
import { LiveChannelPickerDialog } from '@/components/LiveChannelPickerDialog'
import { ConnectionStatus } from '@/components/ConnectionStatus'
import { NHLScoresOverlay } from '@/components/NHLScoresOverlay'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ErsatzTVProgramme, UnifiedChannel, ErsatzTVChannel } from '@/types'

// Refresh interval for programme data (120 minutes)
const REFRESH_INTERVAL = 120 * 60 * 1000

export function TVView() {
  const { logout, isAdmin } = useAuth()

  // Admin-controlled: lets non-admins change the live channel for everyone
  const { userChannelSelection } = useAppSettings()

  // WebSocket for presence tracking and chat
  const { status, reconnect, sendChannelUpdate, sendChatMessage, sendSetNickname } = useWebSocket({ view: 'tv' })

  // Initialize theme
  useTheme()

  // ErsatzTV store - for loading channels and programmes
  const {
    channels: ersatzTVChannels,
    channelsLoading,
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
  const isNHLOverlayVisible = useUIStore((s) => s.isNHLOverlayVisible)
  const toggleNHLOverlay = useUIStore((s) => s.toggleNHLOverlay)

  // Handle Escape key
  const handleEscape = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else if (isTheaterMode) {
      setTheaterMode(false)
    }
  }, [isTheaterMode, setTheaterMode])

  useEscapeKey({ onEscape: handleEscape })

  const programmeTime = useProgrammeClock()

  // Get currently playing programme for presence tracking
  const currentProgrammeTitle = (() => {
    if (!selectedChannel) return null

    if (selectedChannel.type === 'live') {
      return liveEPG?.currentProgram?.title ?? null
    }

    const programmes = programmesByChannel[selectedChannel.id]
    if (!programmes) return null
    const now = new Date(programmeTime)
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

  // Channel picker state (non-admin users, when the admin has enabled it)
  const [channelPickerOpen, setChannelPickerOpen] = useState(false)

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
      loadAllProgrammes(48)
    }
  }, [ersatzTVChannels.length, loadAllProgrammes])

  // Initialize TV store after channels are loaded
  useEffect(() => {
    if (!channelsLoading && !useErsatztvStore.getState().channelsLoading) {
      initializeTVStore()
    }
  }, [ersatzTVChannels.length, channelsLoading])

  // Load live EPG when live channel changes
  useEffect(() => {
    if (liveChannel) {
      loadLiveEPG()
    }
  }, [liveChannel, loadLiveEPG])

  // Refresh live metadata at its boundary, with a one-minute fallback even
  // when the optional catalogue is unavailable or the upstream EPG fails.
  useEffect(() => {
    if (!liveChannel?.guideId) return
    const end = liveEPG?.currentProgram?.endTime
    const untilEnd = end ? new Date(end).getTime() - Date.now() : 60_000
    const delay = untilEnd > 0 ? Math.min(untilEnd, 60_000) : 30_000
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      await loadLiveEPG()
      if (active) timer = setTimeout(refresh, 60_000)
    }
    timer = setTimeout(refresh, delay)
    return () => { active = false; clearTimeout(timer) }
  }, [liveChannel?.guideId, liveEPG, loadLiveEPG])

  // Auto-refresh programme data (silent to avoid flash)
  useEffect(() => {
    if (ersatzTVChannels.length === 0) return

    const interval = setInterval(() => {
      loadAllProgrammes(48, true) // silent refresh to avoid skeleton flash
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
            <ConnectionStatus status={status} onReconnect={reconnect} />
            {/* Current channel/programme info */}
            <span className="text-muted-foreground text-sm">
              {selectedChannel?.name && currentProgrammeTitle
                ? `${selectedChannel.name} - ${currentProgrammeTitle}`
                : selectedChannel?.name || 'Select a channel'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Guide toggle button - desktop only */}
            {!isMobile && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={toggleEPG}
                    className={`
                      h-8 w-8 flex items-center justify-center rounded-md
                      focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
                      ${isEPGVisible ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80' : 'bg-muted text-muted-foreground hover:bg-muted/80'}
                    `}
                    aria-pressed={isEPGVisible}
                    aria-label={isEPGVisible ? 'Hide guide' : 'Show guide'}
                  >
                    <LayoutList className="h-4 w-4 shrink-0" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{isEPGVisible ? 'Hide guide' : 'Show guide'}</p>
                </TooltipContent>
              </Tooltip>
            )}
            {/* NHL Scores button - desktop only */}
            {!isMobile && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={toggleNHLOverlay}
                    className={`
                      h-8 w-8 flex items-center justify-center rounded-md
                      focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
                      ${isNHLOverlayVisible ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80' : 'bg-muted text-muted-foreground hover:bg-muted/80'}
                    `}
                    aria-pressed={isNHLOverlayVisible}
                    aria-label={isNHLOverlayVisible ? 'Hide NHL Scores' : 'NHL Scores'}
                  >
                    <svg
                      viewBox="0 0 105 150"
                      className="h-4 w-4"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M52.5 0C23.5 0 0 10 0 10v90c0 30 52.5 50 52.5 50S105 130 105 100V10S81.5 0 52.5 0z" />
                      <text x="52.5" y="85" textAnchor="middle" fontSize="36" fontWeight="bold" fontFamily="Arial" fill="var(--background, #fff)">NHL</text>
                    </svg>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{isNHLOverlayVisible ? 'Hide NHL Scores' : 'NHL Scores'}</p>
                </TooltipContent>
              </Tooltip>
            )}
            {/* Channel picker - non-admins, only when the admin has enabled it */}
            {!isAdmin && userChannelSelection && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setChannelPickerOpen(true)}
                    className="h-8 w-8 flex items-center justify-center bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    aria-label="Change live channel"
                  >
                    <Tv className="h-4 w-4 shrink-0" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Change live channel</p>
                </TooltipContent>
              </Tooltip>
            )}
            {/* Admin button */}
            {isAdmin && (
              <button
                onClick={() => setAdminModalOpen(true)}
                className="h-8 w-8 flex items-center justify-center bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                aria-label="Open admin panel"
              >
                <ShieldCheck className="h-4 w-4 shrink-0" />
              </button>
            )}
            {/* Refresh video button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setVideoRefreshKey((k) => k + 1)}
                  className="h-8 w-8 flex items-center justify-center bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  aria-label="Refresh video"
                >
                  <RefreshCw className="h-4 w-4 shrink-0" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Refresh video</p>
              </TooltipContent>
            </Tooltip>
            {/* Chat toggle */}
            <ChatToggleButton />
            {/* User settings (theme + notifications + logout) */}
            <UserSettingsMenu onLogout={logout} />
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
            {/* NHL Scores Overlay - positioned over video */}
            <NHLScoresOverlay isVisible={isNHLOverlayVisible} />
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
                  hours={48}
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

      {/* Channel picker for non-admin users */}
      {!isAdmin && userChannelSelection && (
        <LiveChannelPickerDialog
          open={channelPickerOpen}
          onOpenChange={setChannelPickerOpen}
        />
      )}

      {/* Error toast */}
      {error && (
        <div className="fixed bottom-4 right-4 rounded-lg bg-destructive px-4 py-2 text-destructive-foreground">
          {error}
        </div>
      )}

      {/* Chat Panel */}
      <ChatPanel
        onSendMessage={sendChatMessage}
        onSetNickname={sendSetNickname}
      />
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
  const [currentTime, setCurrentTime] = useState(() => Date.now())

  const unifiedChannels = getUnifiedChannels()
  const hasLiveChannel = isLiveChannelActive()

  // Update current time every 30 seconds for time remaining calculations
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(Date.now()), 30 * 1000)
    return () => clearInterval(interval)
  }, [])

  // Helper to get current programme for a channel
  const getCurrentProgramme = (channel: UnifiedChannel): ErsatzTVProgramme | undefined => {
    if (channel.type === 'live') return undefined
    const programmes = programmesByChannel[channel.id]
    if (!programmes) return undefined
    const now = new Date()
    return programmes.find(
      (p) => new Date(p.start) <= now && new Date(p.stop) > now
    )
  }

  // Helper to get live programme title
  const getLiveProgrammeTitle = (): string => {
    return liveEPGTitle ?? (hasLiveChannel ? 'Broadcasting...' : 'Awaiting broadcast...')
  }

  // Calculate progress and time remaining
  const formatTimeRemaining = (programme: ErsatzTVProgramme): string => {
    const stopTime = new Date(programme.stop).getTime()
    const remainingMs = stopTime - currentTime
    if (remainingMs <= 0) return 'Ending...'
    const remainingMinutes = Math.ceil(remainingMs / (1000 * 60))
    if (remainingMinutes < 60) return `${remainingMinutes}m left`
    const hours = Math.floor(remainingMinutes / 60)
    const minutes = remainingMinutes % 60
    return minutes === 0 ? `${hours}h left` : `${hours}h ${minutes}m left`
  }

  const calculateProgress = (programme: ErsatzTVProgramme): number => {
    const startTime = new Date(programme.start).getTime()
    const stopTime = new Date(programme.stop).getTime()
    const totalDuration = stopTime - startTime
    const elapsed = currentTime - startTime
    if (totalDuration <= 0) return 0
    return Math.min(100, Math.max(0, (elapsed / totalDuration) * 100))
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
                  hasLiveChannel ? (
                    <Radio className="h-6 w-6 text-destructive" />
                  ) : (
                    <span className="text-xs font-bold text-destructive">0</span>
                  )
                ) : channel.logoUrl ? (
                  <img
                    src={getErsatzTVLogoUrl(channel.id)}
                    alt=""
                    className="h-full w-full object-contain"
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
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
                  {isLive ? getLiveProgrammeTitle() : currentProgramme?.title || channel.group}
                </p>
                {/* Progress bar and time remaining for ErsatzTV channels */}
                {!isLive && currentProgramme && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary/60 transition-all duration-300"
                        style={{ width: `${calculateProgress(currentProgramme)}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {formatTimeRemaining(currentProgramme)}
                    </span>
                  </div>
                )}
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
