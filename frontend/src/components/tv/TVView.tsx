import { useEffect, useState, useCallback, useRef } from 'react'
import { ShieldCheck, LayoutList, RefreshCw, Radio, Tv, AudioLines } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useAppSettings } from '@/hooks/useAppSettings'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useTVMode } from '@/hooks/useTVMode'
import { useChannelZap } from '@/hooks/useChannelZap'
import { getRemoteAction, isKeyForFocusedControl } from '@/lib/remoteKeys'
import { useProgrammeClock } from '@/hooks/useProgrammeClock'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useChannelStore } from '@/stores/channelStore'
import { useTVStore, initializeTVStore, describeLiveGuide } from '@/stores/tvStore'
import { getErsatzTVLogoUrl } from '@/services/ersatztvApi'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { DualModeVideoPlayer } from '@/components/tv/DualModeVideoPlayer'
import { TVEPGGrid } from '@/components/tv/TVEPGGrid'
import { TVChannelSidebar } from '@/components/tv/TVChannelSidebar'
import { ZapBanner } from '@/components/tv/ZapBanner'
import { ProgrammeDetailsModal } from '@/components/ersatztv/ProgrammeDetailsModal'
import { ChatPanel } from '@/components/ChatPanel'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Button } from '@/components/ui/button'
import { ResizeDragHandle } from '@/components/ui/ResizeDragHandle'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useResizable } from '@/hooks/useResizable'
import { useMobileLandscape } from '@/hooks/useMobileLandscape'
import { ChatToggleButton } from '@/components/ChatToggleButton'
import { FeedbackButton } from '@/components/FeedbackButton'
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

  // TV browsers (webOS/Tizen) start in theater, the only layout that fills the
  // screen from a remote. Runs once, so leaving theater sticks.
  const isTVMode = useTVMode()
  useEffect(() => {
    if (isTVMode) setTheaterMode(true)
  }, [isTVMode, setTheaterMode])

  // CH+/CH- and Up/Down zap in TV theater. Tuning waits for the presses to stop.
  const { pending: zapPending, step: zapStep } = useChannelZap({
    getChannels: getUnifiedChannels,
    selected: selectedChannel,
    onTune: selectChannel,
  })
  const isTVTheater = isTVMode && isTheaterMode

  useEffect(() => {
    if (!isTVTheater) return
    // Capture phase, so the zap runs before (and instead of) the player's and
    // the page's own arrow-key handlers
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isKeyForFocusedControl(e)) return
      const action = getRemoteAction(e)
      if (action !== 'channelUp' && action !== 'channelDown') return
      e.preventDefault()
      e.stopPropagation()
      zapStep(action === 'channelUp' ? 1 : -1)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isTVTheater, zapStep])

  // TV remotes: Back leaves theater (the header comes back) and OK returns to
  // it. A 5-way remote can't move focus in the desktop layout, so without OK
  // a viewer who pressed Back would be stuck there. Back outside theater is
  // left to the browser.
  useEffect(() => {
    if (!isTVMode) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isKeyForFocusedControl(e)) return
      const action = getRemoteAction(e)
      if (isTheaterMode) {
        // Escape already goes through useEscapeKey
        if (action !== 'back' || e.key === 'Escape') return
        // Stops webOS Back (461) and Backspace from navigating history
        e.preventDefault()
        handleEscape()
      } else if (action === 'ok' && (!document.activeElement || document.activeElement === document.body)) {
        setTheaterMode(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isTVMode, isTheaterMode, handleEscape, setTheaterMode])

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
      // Live slot carries a synthetic id; backendId is the real Dispatcharr channel id
      const channelId = selectedChannel?.backendId ?? selectedChannel?.id ?? null
      sendChannelUpdate(selectedChannel?.name ?? null, currentProgrammeTitle, viewType, channelId)
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

  // Live channel picker: admins, and everyone else when the admin has enabled it
  const canControl = isAdmin || userChannelSelection
  const [channelPickerOpen, setChannelPickerOpen] = useState(false)
  const openLivePicker = useCallback(() => setChannelPickerOpen(true), [])
  const onPickLive = canControl ? openLivePicker : undefined

  // Video refresh key
  const [videoRefreshKey, setVideoRefreshKey] = useState(0)

  // Resets the chat error boundary when chat is closed or reopened
  const isChatOpen = useChatStore((s) => s.isOpen)

  // Responsive
  const isMobile = useMediaQuery('(max-width: 768px)')
  const isMobileLandscape = useMobileLandscape()
  const isPhonePortrait = isMobile && !isTheaterMode && !isMobileLandscape

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
    // 100vh where dvh is unsupported (older webOS/Tizen), the dynamic viewport
    // elsewhere, so Safari's toolbar doesn't hide the bottom of the list
    <div className="flex h-screen supports-[height:100dvh]:h-dvh flex-col overflow-hidden bg-background">
      {/* Header - hidden in theater mode or mobile landscape */}
      {!isTheaterMode && !isMobileLandscape && (
        <header className="flex justify-between items-center px-4 pt-header-safe pb-2 bg-background border-b rounded-b-lg">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            {/* Connection status indicator */}
            <ConnectionStatus status={status} onReconnect={reconnect} />
            {/* Current channel/programme info: one line, so a long title can't push the video down */}
            <span className="truncate text-muted-foreground text-sm">
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
            {/* Feedback (hidden unless the server is configured for it) */}
            <FeedbackButton />
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
            onPickLive={onPickLive}
          />
        )}

        {/* Content area */}
        <main className="flex flex-1 flex-col min-h-0 overflow-hidden">
          {/* Video player - fixed full viewport in theater mode or mobile landscape,
              a full-width 16:9 box in phone portrait */}
          <div
            className={cn(
              'relative w-full min-h-0 overflow-hidden bg-black',
              (isTheaterMode || isMobileLandscape) && 'fixed inset-0 z-50',
              isPhonePortrait && 'aspect-video flex-none',
              !isTheaterMode && !isMobileLandscape && !isMobile && 'rounded-lg'
            )}
            style={
              !isTheaterMode && !isMobileLandscape && isEPGVisible && !isMobile
                ? { flex: `1 1 ${100 - epgHeightPercent}%` }
                : !isTheaterMode && !isMobileLandscape && !isMobile
                ? { flex: '1 1 100%' }
                : undefined
            }
          >
            <div key={videoRefreshKey} className="h-full w-full">
              <ErrorBoundary
                name="Player"
                // The live slot keeps one id across channel changes, so the
                // stream URL is part of the key too
                resetKey={selectedChannel ? `${selectedChannel.id} ${selectedChannel.streamUrl}` : null}
                fallback={() => (
                  <div role="alert" className="flex h-full w-full flex-col items-center justify-center gap-3 text-white">
                    <p>The player hit an error</p>
                    <Button variant="secondary" onClick={() => setVideoRefreshKey((k) => k + 1)}>
                      Reload player
                    </Button>
                  </div>
                )}
              >
                <DualModeVideoPlayer
                  channel={selectedChannel}
                  isTheaterMode={isTheaterMode}
                  isMobile={isMobile}
                  onTheaterModeToggle={toggleTheaterMode}
                  onPickLive={onPickLive}
                />
              </ErrorBoundary>
            </div>
            {/* NHL Scores Overlay - positioned over video */}
            <NHLScoresOverlay isVisible={isNHLOverlayVisible} />
            {/* Channel banner while zapping in TV theater */}
            {isTVTheater && <ZapBanner channel={zapPending ?? selectedChannel} />}
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
                  // Phone: a zero basis, so the list takes what the 16:9 video
                  // leaves and scrolls, however many channels there are
                  : { flex: '1 1 0%' }
              }
            >
              {isMobile ? (
                <MobileChannelList
                  onChannelSelect={handleChannelSelect}
                  liveEPGTitle={liveEPGTitle}
                  onPickLive={onPickLive}
                />
              ) : (
                <TVEPGGrid
                  hours={48}
                  programmesByChannel={programmesByChannel}
                  loading={programmesLoading}
                  liveEPG={liveEPG}
                  onProgrammeClick={handleProgrammeClick}
                  onChannelClick={handleChannelSelect}
                  onPickLive={onPickLive}
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

      {/* Live channel picker (admins also get Stop live TV in it) */}
      {canControl && (
        <LiveChannelPickerDialog
          open={channelPickerOpen}
          onOpenChange={setChannelPickerOpen}
        />
      )}

      {/* Error toast */}
      {error && (
        <div className="fixed bottom-4 right-4 rounded-lg bg-destructive px-4 py-2 text-destructive-foreground dark:bg-destructive/60">
          {error}
        </div>
      )}

      {/* Chat Panel */}
      <ErrorBoundary
        name="Chat"
        resetKey={isChatOpen}
        fallback={() => (
          <div role="alert" className="fixed top-4 right-4 z-50 flex items-center gap-3 rounded-lg border bg-card p-4 text-card-foreground shadow-lg">
            <p className="text-sm">Chat hit an error</p>
            <Button size="sm" variant="outline" onClick={() => useChatStore.getState().setOpen(false)}>
              Close
            </Button>
          </div>
        )}
      >
        <ChatPanel
          onSendMessage={sendChatMessage}
          onSetNickname={sendSetNickname}
          status={status}
          onReconnect={reconnect}
        />
      </ErrorBoundary>
    </div>
  )
}

// Mobile card layout
interface MobileChannelListProps {
  onChannelSelect: (channel: UnifiedChannel) => void
  liveEPGTitle?: string | null
  // Opens the live channel picker; only for people allowed to change live TV
  onPickLive?: () => void
}

function MobileChannelList({ onChannelSelect, liveEPGTitle, onPickLive }: MobileChannelListProps) {
  const { getUnifiedChannels, isLiveChannelActive, selectedChannel, liveEPGStatus } = useTVStore()
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
    if (liveEPGTitle) return liveEPGTitle
    if (hasLiveChannel) return describeLiveGuide(liveEPGStatus)
    return onPickLive ? 'Nothing on yet' : 'Waiting for someone to put something on'
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
          const cardClassName = `
            rounded-lg border
            ${selectedChannel?.id === channel.id ? 'border-primary bg-primary/10' : ''}
            ${isLive ? 'bg-destructive/5' : ''}
          `
          // The empty live slot offers the picker next to the tune button
          // (a sibling, since buttons can't nest)
          const showPickLive = isLive && !hasLiveChannel && !!onPickLive

          const tuneButton = (
            <button
              key={channel.id}
              onClick={() => onChannelSelect(channel)}
              className={`
                flex items-center gap-3 p-3 text-left
                transition-colors hover:bg-accent
                ${showPickLive ? 'min-w-0 flex-1 rounded-lg' : cardClassName}
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
                    <span className="rounded bg-live px-1.5 py-0.5 text-[10px] font-bold uppercase text-live-foreground">
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
              {/* Static, so nothing blinks beside the video */}
              {selectedChannel?.id === channel.id && (
                <AudioLines
                  className={`h-4 w-4 shrink-0 ${isLive ? 'text-live' : 'text-primary'}`}
                  aria-hidden="true"
                  data-testid="now-playing-indicator"
                />
              )}
            </button>
          )

          if (!showPickLive) return tuneButton

          return (
            <div key={channel.id} className={`flex items-center pr-3 ${cardClassName}`}>
              {tuneButton}
              <Button size="sm" onClick={onPickLive}>
                Pick a channel
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
