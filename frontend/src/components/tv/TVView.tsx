import { useEffect, useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
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
import { useUIStore, EPG_HEIGHT_MIN, EPG_HEIGHT_MAX } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { DualModeVideoPlayer } from '@/components/tv/DualModeVideoPlayer'
import { TVEPGGrid } from '@/components/tv/TVEPGGrid'
import { TVChannelSidebar } from '@/components/tv/TVChannelSidebar'
import { ZapBanner } from '@/components/tv/ZapBanner'
import { MobileChannelList } from '@/components/tv/MobileChannelList'
import { TVHeader } from '@/components/tv/TVHeader'
import { ProgrammeDetailsModal, type ProgrammeDetailsChannel } from '@/components/ersatztv/ProgrammeDetailsModal'
import { ChatPanel, type ChatPanelVariant } from '@/components/ChatPanel'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Button } from '@/components/ui/button'
import { ResizeDragHandle } from '@/components/ui/ResizeDragHandle'
import { useLayoutMode } from '@/hooks/useLayoutMode'
import { useResizable } from '@/hooks/useResizable'
import { useMobileLandscape } from '@/hooks/useMobileLandscape'
import { AdminModal } from '@/components/AdminModal'
import { LiveChannelPickerDialog } from '@/components/LiveChannelPickerDialog'
import { getProgrammeState } from '@/lib/programmes'
import { cn } from '@/lib/utils'
import type { ErsatzTVProgramme, UnifiedChannel } from '@/types'

// Refresh interval for programme data (120 minutes)
const REFRESH_INTERVAL = 120 * 60 * 1000

// Refresh interval for the live channel's schedule (30 minutes)
const LIVE_SCHEDULE_REFRESH_INTERVAL = 30 * 60 * 1000

// One fixed id, so repeated ErsatzTV failures replace the toast instead of stacking
const ERSATZ_ERROR_TOAST_ID = 'ersatz-error'

export function TVView() {
  const { isAdmin } = useAuth()

  // Admin-controlled: lets non-admins change the live channel for everyone
  const { userChannelSelection } = useAppSettings()

  // WebSocket for presence tracking and chat
  const { status, reconnect, sendChannelUpdate, sendChatMessage, sendSetNickname } = useWebSocket({ view: 'tv' })

  // ErsatzTV store - for loading channels and programmes. Field selectors,
  // so unrelated store updates don't re-render the whole view
  const ersatzTVChannels = useErsatztvStore((s) => s.channels)
  const channelsLoading = useErsatztvStore((s) => s.channelsLoading)
  const programmesLoading = useErsatztvStore((s) => s.programmesLoading)
  const programmesByChannel = useErsatztvStore((s) => s.programmesByChannel)
  const error = useErsatztvStore((s) => s.error)
  const loadChannels = useErsatztvStore((s) => s.loadChannels)
  const loadAllProgrammes = useErsatztvStore((s) => s.loadAllProgrammes)

  // Live channel from channel store
  const liveChannel = useChannelStore((s) => s.currentChannel)

  // TV store - unified channel management
  const selectedChannel = useTVStore((s) => s.selectedChannel)
  const selectChannel = useTVStore((s) => s.selectChannel)
  const liveEPG = useTVStore((s) => s.liveEPG)
  const loadLiveEPG = useTVStore((s) => s.loadLiveEPG)
  const loadLiveProgrammes = useTVStore((s) => s.loadLiveProgrammes)
  const getUnifiedChannels = useTVStore((s) => s.getUnifiedChannels)

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
  const { heightPercent, isDragging, handlePointerDown, handleKeyDown: handleResizeKeyDown } = useResizable({
    initialHeightPercent: epgHeightPercent,
    minHeightPercent: EPG_HEIGHT_MIN,
    maxHeightPercent: EPG_HEIGHT_MAX,
    containerRef,
    onHeightChange: setEPGHeightPercent,
  })

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedProgramme, setSelectedProgramme] = useState<ErsatzTVProgramme | null>(null)
  const [modalChannel, setModalChannel] = useState<ProgrammeDetailsChannel | null>(null)

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
  const layoutMode = useLayoutMode()
  const isMobile = layoutMode === 'phone'
  const isMobileLandscape = useMobileLandscape()
  const isPhonePortrait = isMobile && !isTheaterMode && !isMobileLandscape
  // Chat takes the whole screen on a phone and slides over the side anywhere else
  const chatVariant: ChatPanelVariant = isMobile ? 'takeover' : 'overlay'

  // Load channels on mount
  useEffect(() => {
    loadChannels()
  }, [loadChannels])

  // ErsatzTV errors show once, as a toast with Retry. The error stays in the
  // store (no clearError), so the sidebar keeps its inline Retry; the toast
  // goes when the error clears.
  useEffect(() => {
    if (!error) {
      toast.dismiss(ERSATZ_ERROR_TOAST_ID)
      return
    }
    toast.error(error, {
      id: ERSATZ_ERROR_TOAST_ID,
      action: {
        label: 'Retry',
        onClick: () => {
          loadChannels()
          loadAllProgrammes(48)
        },
      },
    })
  }, [error, loadChannels, loadAllProgrammes])

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

  // The live channel's schedule for the guide: now, then every 30 minutes.
  // The store reloads it itself when live TV switches, and a lookup with
  // nothing on live TV fetches nothing.
  useEffect(() => {
    loadLiveProgrammes()
    const interval = setInterval(loadLiveProgrammes, LIVE_SCHEDULE_REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [loadLiveProgrammes])

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
      // An ErsatzTV programme opens its details, if its channel is still listed
      if (channel.type === 'ersatztv') {
        const ersatzChannel = ersatzTVChannels.find((c) => c.id === channel.id)
        if (ersatzChannel) {
          setSelectedProgramme(programme)
          setModalChannel(ersatzChannel)
          setModalOpen(true)
        }
      }
      // Live row: the programme on now tunes to the live slot; any other
      // opens its details, like an ErsatzTV programme
      if (channel.type === 'live') {
        if (getProgrammeState(programme, Date.now()) === 'now') {
          selectChannel(channel)
        } else {
          setSelectedProgramme(programme)
          setModalChannel({ id: channel.id, name: channel.name })
          setModalOpen(true)
        }
      }
    },
    [ersatzTVChannels, selectChannel]
  )

  // Handle watch from modal
  const handleWatch = useCallback(
    (channel: ProgrammeDetailsChannel) => {
      // Find the unified channel (the live slot too) and select it
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
        {/* Desktop: Collapsible Sidebar - hidden in theater mode/landscape, and
            while the guide is open, whose channel column is then the one
            channel list. Its collapsed state stays in the store for when the
            guide closes. */}
        {!isMobile && !isTheaterMode && !isMobileLandscape && !isEPGVisible && (
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
            <ErrorBoundary
              name="Player"
              // The live slot keeps one id across channel changes, so the
              // stream URL is part of the key too. A reload also clears it.
              resetKey={`${selectedChannel ? `${selectedChannel.id} ${selectedChannel.streamUrl}` : ''} ${videoRefreshKey}`}
              fallback={() => (
                <div role="alert" className="flex h-full w-full flex-col items-center justify-center gap-3 text-white">
                  <p>The player hit an error</p>
                  <Button variant="secondary" onClick={reloadVideo}>
                    Reload player
                  </Button>
                </div>
              )}
            >
              {/* Refresh re-initialises only the video engine: the player
                  shell stays mounted, so fullscreen survives it */}
              <DualModeVideoPlayer
                channel={selectedChannel}
                isTheaterMode={isTheaterMode}
                isMobile={isMobile}
                onTheaterModeToggle={toggleTheaterMode}
                onPickLive={onPickLive}
                reloadKey={videoRefreshKey}
              />
            </ErrorBoundary>
            {/* Channel banner while zapping in TV theater */}
            {isTVTheater && <ZapBanner channel={zapPending ?? selectedChannel} />}
          </div>

          {/* Resize handle - only on desktop when EPG visible, hidden in theater/landscape */}
          {!isMobile && isEPGVisible && !isTheaterMode && !isMobileLandscape && (
            <ResizeDragHandle
              onPointerDown={handlePointerDown}
              onKeyDown={handleResizeKeyDown}
              isDragging={isDragging}
              valueNow={heightPercent}
              valueMin={EPG_HEIGHT_MIN}
              valueMax={EPG_HEIGHT_MAX}
            />
          )}

          {/* EPG section - hidden in theater mode or mobile landscape */}
          {!isTheaterMode && !isMobileLandscape && (isMobile || isEPGVisible) && (
            <div
              className={cn(
                'min-h-0 rounded-t-lg',
                // Desktop: the guide grid scrolls itself (both ways), so its
                // time header can stick. Phone: this box scrolls the list.
                isMobile ? 'epg-scroll overflow-y-auto' : 'overflow-hidden'
              )}
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

      {/* Live channel picker (Stop live TV is on the admin panel's On-air card) */}
      {canControl && (
        <LiveChannelPickerDialog
          open={channelPickerOpen}
          onOpenChange={setChannelPickerOpen}
        />
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
          variant={chatVariant}
        />
      </ErrorBoundary>
    </div>
  )
}
