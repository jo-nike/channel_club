import { useEffect, useState, useCallback, useRef } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useAppSettings } from '@/hooks/useAppSettings'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useTVMode } from '@/hooks/useTVMode'
import { useChannelZap } from '@/hooks/useChannelZap'
import { getRemoteAction, isKeyForFocusedControl } from '@/lib/remoteKeys'
import { useNowPlaying } from '@/hooks/useNowPlaying'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useChannelStore } from '@/stores/channelStore'
import { useTVStore, initializeTVStore } from '@/stores/tvStore'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { DualModeVideoPlayer } from '@/components/tv/DualModeVideoPlayer'
import { TVEPGGrid } from '@/components/tv/TVEPGGrid'
import { TVChannelSidebar } from '@/components/tv/TVChannelSidebar'
import { ZapBanner } from '@/components/tv/ZapBanner'
import { MobileChannelList } from '@/components/tv/MobileChannelList'
import { TVHeader } from '@/components/tv/TVHeader'
import { ProgrammeDetailsModal } from '@/components/ersatztv/ProgrammeDetailsModal'
import { ChatPanel } from '@/components/ChatPanel'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Button } from '@/components/ui/button'
import { ResizeDragHandle } from '@/components/ui/ResizeDragHandle'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useResizable } from '@/hooks/useResizable'
import { useMobileLandscape } from '@/hooks/useMobileLandscape'
import { AdminModal } from '@/components/AdminModal'
import { LiveChannelPickerDialog } from '@/components/LiveChannelPickerDialog'
import { NHLScoresOverlay } from '@/components/NHLScoresOverlay'
import { cn } from '@/lib/utils'
import type { ErsatzTVProgramme, UnifiedChannel, ErsatzTVChannel } from '@/types'

// Refresh interval for programme data (120 minutes)
const REFRESH_INTERVAL = 120 * 60 * 1000

export function TVView() {
  const { isAdmin } = useAuth()

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
  const epgHeightPercent = useUIStore((s) => s.epgHeightPercent)
  const setEPGHeightPercent = useUIStore((s) => s.setEPGHeightPercent)
  const isChannelSidebarCollapsed = useUIStore((s) => s.isChannelSidebarCollapsed)
  const toggleChannelSidebar = useUIStore((s) => s.toggleChannelSidebar)
  const isTheaterMode = useUIStore((s) => s.isTheaterMode)
  const setTheaterMode = useUIStore((s) => s.setTheaterMode)
  const toggleTheaterMode = useUIStore((s) => s.toggleTheaterMode)
  const isNHLOverlayVisible = useUIStore((s) => s.isNHLOverlayVisible)

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

  // Get currently playing programme for presence tracking
  const { title: currentProgrammeTitle } = useNowPlaying(selectedChannel)

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
  const openAdmin = useCallback(() => setAdminModalOpen(true), [])

  // Live channel picker: admins, and everyone else when the admin has enabled it
  const canControl = isAdmin || userChannelSelection
  const [channelPickerOpen, setChannelPickerOpen] = useState(false)
  const openLivePicker = useCallback(() => setChannelPickerOpen(true), [])
  const onPickLive = canControl ? openLivePicker : undefined

  // Video refresh key
  const [videoRefreshKey, setVideoRefreshKey] = useState(0)
  const reloadVideo = useCallback(() => setVideoRefreshKey((k) => k + 1), [])

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
        <TVHeader
          status={status}
          onReconnect={reconnect}
          onOpenAdmin={openAdmin}
          onOpenChannelPicker={openLivePicker}
          onReload={reloadVideo}
          isMobile={isMobile}
        />
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
