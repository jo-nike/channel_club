import { useState, useEffect, useRef, useCallback, useMemo, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import mpegts from 'mpegts.js'
import Hls from 'hls.js'
import { Loader2 } from 'lucide-react'
import {
  MediaPlayer,
  MediaProvider,
  isHLSProvider,
  type MediaAutoPlayFailEventDetail,
  type MediaPlayerInstance,
  type MediaProviderAdapter,
  type MediaVolumeChange,
} from '@vidstack/react'
import '@vidstack/react/player/styles/default/theme.css'
import { useAutoHide } from '@/hooks/useAutoHide'
import { useTVMode } from '@/hooks/useTVMode'
import { useVideoKeyboardShortcuts } from '@/hooks/useVideoKeyboardShortcuts'
import { PLAYER_SHELL_ATTRIBUTE, useFullscreenState } from '@/hooks/useFullscreenState'
import { useStreamRecovery } from '@/hooks/useStreamRecovery'
import { useChatEnabled } from '@/hooks/useChatEnabled'
import { useNhlEnabled } from '@/hooks/useNhlEnabled'
import { useClipThat } from '@/hooks/useClipThat'
import { useMobileLandscape } from '@/hooks/useMobileLandscape'
import { useSwipeZap } from '@/hooks/useSwipeZap'
import { useCastSdk } from '@/hooks/useChromecast'
import { ProjectorBeamLoader } from '@/components/ProjectorBeamLoader'
import { Button } from '@/components/ui/button'
import { AutoplayNotice } from '@/components/player/AutoplayNotice'
import { ChatOverlay } from '@/components/player/ChatOverlay'
import { useChatOverlayMode } from '@/components/player/useChatOverlayMode'
import { CastErrorBanner, CastingCard } from '@/components/player/CastingCard'
import {
  PlayerShellContext,
  usePlayerShell,
  useShellAutoplayNotice,
  useShellLiveEdge,
  useShellLivePaused,
  useShellPlayback,
  type BehindLive,
} from '@/components/player/PlayerShellContext'
import { FilterLayer } from '@/components/player/FilterLayer'
import { PlayerChrome } from '@/components/player/PlayerChrome'
import { PlayerInfoOverlay } from '@/components/player/PlayerInfoOverlay'
import { StreamStatusCard } from '@/components/player/StreamStatusCard'
import { ShortcutSheet } from '@/components/player/ShortcutSheet'
import { useLiveAdapter, useVidstackAdapter } from '@/components/player/mediaAdapters'
import { usePlayerAudio } from '@/components/player/usePlayerAudio'
import { HighlightModal } from '@/components/HighlightModal'
import { ArrivalCard } from '@/components/tv/ArrivalCard'
import { useAudioStore, unmutedVolume } from '@/stores/audioStore'
import { useCastStore } from '@/stores/castStore'
import { useChannelStore } from '@/stores/channelStore'
import { useClipStore } from '@/stores/clipStore'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { createErsatzTVStreamSession } from '@/services/ersatztvApi'
import type { ChannelZap } from '@/hooks/useChannelZap'
import type { UnifiedChannel } from '@/types'

interface DualModeVideoPlayerProps {
  channel: UnifiedChannel | null
  isTheaterMode: boolean
  isMobile?: boolean
  onTheaterModeToggle: () => void
  // Opens the Live TV switcher; only for people allowed to change live TV
  onPickLive?: () => void
  // Bumped by the page's Refresh: re-initialises the engine, keeps the shell
  reloadKey?: number
  // The page's channel zapping: the channel keys drive it and the info rail
  // shows where it is heading
  zap?: ChannelZap
  // Focuses the channel search ('/'); only where the page shows one
  onFocusSearch?: () => void
  // Shrunk to a strip above the phone's chat composer: the chrome compacts
  isStrip?: boolean
  // Where the page wants the arrival card under the player (a phone in
  // portrait) rather than over the picture; absent or null keeps it over
  arrivalHost?: HTMLElement | null
}

// Main component - switches between live (mpegts) and ersatztv (HLS) players.
// The shell div stays mounted across channel changes and is the fullscreen
// element, so only the keyed engine inside it re-initialises (on a channel
// change or a reload) and a viewer in fullscreen stays there. (Removing the
// fullscreen element exits fullscreen; Vidstack's own exit on unmount is a
// no-op unless MediaPlayer itself is the fullscreen element.) The clip
// editor lives in the shell too, so a channel change or a stream retry
// leaves it, its capture and any export alone.
export function DualModeVideoPlayer({
  channel,
  isTheaterMode,
  isMobile = false,
  onTheaterModeToggle,
  onPickLive,
  reloadKey: pageReloadKey = 0,
  zap,
  onFocusSearch,
  isStrip = false,
  arrivalHost = null,
}: DualModeVideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // The shell element again, as state: the clip editor portals into it
  // (so it shows in fullscreen) and render can't read the ref
  const [shellElement, setShellElement] = useState<HTMLDivElement | null>(null)
  const attachShell = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node
    setShellElement(node)
  }, [])
  const isFullscreen = useFullscreenState(containerRef)

  const clipSession = useClipStore((s) => s.session)
  const closeClip = useClipStore((s) => s.close)
  // The editor belongs to this player: it closes when the player goes away
  useEffect(() => closeClip, [closeClip])

  // The same test as the button's state: exit only when the shell itself is
  // fullscreen. Another element in fullscreen means the shell should enter.
  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    if (isFullscreen) {
      document.exitFullscreen().catch(() => {})
    } else {
      container.requestFullscreen().catch(() => {})
    }
  }, [isFullscreen])

  // One auto-hide for every engine: the engine reports whether it plays, the
  // control bar whether the pointer is over it
  const [isEnginePlaying, setEnginePlaying] = useState(false)
  const [isHoveringControls, setHoveringControls] = useState(false)
  // The 10-foot TV layout: its remote can't reach the control bar, so only a
  // pointer (a Magic Remote) brings it up, and it has its own remote keys,
  // which the sheet lists there
  const isTVMode = useTVMode()
  const { isVisible: controlsVisible } = useAutoHide({
    isPlaying: isEnginePlaying,
    containerRef,
    isHoveringControls,
    pointerOnly: isTVMode,
  })

  // The info rail reports whether it is up; the sound-off pill moves under it
  const [isInfoRailVisible, setInfoRailVisible] = useState(false)

  // The engine reports when it is behind its live edge; the info rail says so
  const [behindLive, setBehindLive] = useState<BehindLive | null>(null)
  // The live engine reports a pause; the info rail hints what it costs
  const [isLivePaused, setLivePaused] = useState(false)
  // The engine reports its autoplay notice; the arrival card waits for it
  const [isAutoplayNoticeShown, setAutoplayNoticeShown] = useState(false)

  // Both counters only grow, so their sum changes on every reload
  const [shellReloads, setShellReloads] = useState(0)
  const reloadKey = pageReloadKey + shellReloads
  const reload = useCallback(() => setShellReloads((n) => n + 1), [])

  const stepChannel = zap?.step

  // What this viewer's player shows now, for the clip editor's notice and
  // Clip that: null while live TV is stopped, nothing before a channel is
  // selected
  const playingChannel = !channel
    ? undefined
    : channel.type === 'live' && !channel.streamUrl
      ? null
      : { id: channel.backendId || channel.id, name: channel.name }
  // One press posts the last 20s of it to chat
  const clipThat = useClipThat(playingChannel)

  const shell = useMemo(
    () => ({
      containerRef,
      isFullscreen,
      toggleFullscreen,
      isTheaterMode,
      toggleTheaterMode: onTheaterModeToggle,
      isStrip,
      controlsVisible,
      setPlaying: setEnginePlaying,
      setHoveringControls,
      isInfoRailVisible,
      setInfoRailVisible,
      behindLive,
      setBehindLive,
      isLivePaused,
      setLivePaused,
      isAutoplayNoticeShown,
      setAutoplayNoticeShown,
      stepChannel,
      reload,
      reloadKey,
      clipThat,
    }),
    [
      isFullscreen,
      toggleFullscreen,
      isTheaterMode,
      onTheaterModeToggle,
      isStrip,
      controlsVisible,
      isInfoRailVisible,
      behindLive,
      isLivePaused,
      isAutoplayNoticeShown,
      stepChannel,
      reload,
      reloadKey,
      clipThat,
    ]
  )

  // While casting, the card takes the picture's place (see the engines for
  // what the local playback does meanwhile). The shell holds the Cast SDK:
  // the cast button comes and goes with the engine, and the card must still
  // hear the cast end on the empty live slot.
  useCastSdk()
  const isCasting = useCastStore((s) => s.isCasting)

  // The keyboard map ('?'), in the shell so it shows in fullscreen
  const [isShortcutSheetOpen, setShortcutSheetOpen] = useState(false)
  const openShortcutSheet = useCallback(() => setShortcutSheetOpen(true), [])
  const chatEnabled = useChatEnabled()
  const toggleChat = useChatStore((s) => s.toggleOpen)
  // In theater and fullscreen, where the chat over the video can take a
  // reply, C opens its composer instead of the panel. Each press is a new
  // request, so C also brings focus back to a composer already open. It
  // closes when the overlay can no longer reply (the panel opened, theater
  // ended). (Adjusted while rendering, React's pattern for state that
  // follows a prop.)
  const { canReply } = useChatOverlayMode(isTheaterMode, isFullscreen)
  const [composerRequest, setComposerRequest] = useState<number | null>(null)
  if (!canReply && composerRequest !== null) setComposerRequest(null)
  const openComposer = useCallback(() => setComposerRequest((n) => (n ?? 0) + 1), [])
  const closeComposer = useCallback(() => setComposerRequest(null), [])
  const toggleNHLOverlay = useUIStore((s) => s.toggleNHLOverlay)
  const nhlEnabled = useNhlEnabled()

  // In fullscreen the page's search is hidden behind the shell
  const focusSearch = isFullscreen ? undefined : onFocusSearch

  // Channel keys (PageUp/PageDown, ]/[, L, digits, Enter, /), the panel
  // keys (?, C, N) and Clip that (X) belong to the shell, not the engine: they
  // must work on the empty live slot too, which has no engine. The shell
  // stays mounted across the tune, so fullscreen survives it.
  useVideoKeyboardShortcuts({
    containerRef,
    onChannelStep: zap?.step,
    onLastChannel: zap?.tuneLast,
    onDigit: zap?.digit,
    onDigitCommit: zap?.commitDigits,
    onShortcutSheet: openShortcutSheet,
    // Not on the TV layout, which has no chat to show: C would open the panel
    // unseen, to spring open once the layout is turned off
    onChatToggle: chatEnabled && !isTVMode ? (canReply ? openComposer : toggleChat) : undefined,
    // Not on the TV layout either: the strip is desktop-sized and outside the
    // title-safe area there, as clip capture is off on TVs
    onNHLToggle: isTVMode || !nhlEnabled ? undefined : toggleNHLOverlay,
    onClipThat: clipThat,
    onFocusSearch: focusSearch,
  })

  // A phone held sideways has no guide or channel list: a vertical swipe on
  // the picture zaps instead. The shell takes every touch gesture itself
  // (touch-action: none), or the browser would scroll and cancel the swipe;
  // taps still reach the auto-hide.
  const isMobileLandscape = useMobileLandscape()
  const isSwipeZap = isMobileLandscape && zap !== undefined
  useSwipeZap({ containerRef, enabled: isSwipeZap, onStep: zap?.step })

  let engine: ReactNode
  if (!channel) {
    // No channel selected
    engine = <NoChannelPlaceholder />
  } else if (channel.type === 'live' && !channel.streamUrl) {
    // Live channel (Channel 0) with no stream (admin hasn't selected)
    engine = <NoLiveChannelPlaceholder onPickLive={onPickLive} />
  } else if (channel.type === 'live') {
    // Live channel - use mpegts.js player
    // Use backendId for highlight recording (real Dispatcharr ID), fallback to id
    engine = (
      <LiveVideoPlayer
        key={`live-${channel.streamUrl}-${reloadKey}`}
        channelId={channel.backendId || channel.id}
        streamUrl={channel.streamUrl}
        channelName={channel.name}
        isMobile={isMobile}
      />
    )
  } else {
    // ErsatzTV channel - use HLS Vidstack player on a proxied stream session
    engine = (
      <HLSVideoPlayerWrapper
        key={`hls-${channel.id}-${reloadKey}`}
        channelId={channel.id}
        title={channel.name}
        isMobile={isMobile}
      />
    )
  }

  // The notch and status bar only reach the player when it starts at the top
  // of the viewport (theater, fullscreen). env() is viewport-wide, so inline
  // under the page header (which takes the inset itself) it would still push
  // the rail, and what sits under it, down into the picture.
  const insetTop = {
    '--player-inset-top': isTheaterMode || isFullscreen ? 'env(safe-area-inset-top, 0px)' : '0px',
  } as CSSProperties

  return (
    <PlayerShellContext value={shell}>
      {/* Marked, so the page can portal chat and toasts into it in fullscreen */}
      <div
        ref={attachShell}
        {...{ [PLAYER_SHELL_ATTRIBUTE]: '' }}
        className={`video-player-container relative h-full w-full bg-black${isSwipeZap ? ' touch-none' : ''}`}
        style={insetTop}
      >
        {/* Before the engine, so its control bar paints above the filters */}
        <FilterLayer />
        {/* Over the picture and the filters, under the engine's control bar
            and the info rail (both come later at z-10 and above), so the
            controls and the zap feedback stay usable while casting */}
        {isCasting && <CastingCard />}
        {/* The pointer hides with the controls over a playing picture, the
            same for every engine. Around the engine, not on the shell: the
            clip editor and the shortcut sheet portal into the shell and keep
            their pointer. Unpositioned, so the paint order stays the same. */}
        <div className={`h-full w-full${!controlsVisible && isEnginePlaying ? ' cursor-none' : ''}`}>
          {engine}
        </div>
        {/* The info rail and NHL ticker: in the shell, so they show in
            fullscreen and stay put while the engine is swapped */}
        <PlayerInfoOverlay
          channel={channel}
          pending={zap?.pending ?? null}
          entry={zap?.entry ?? null}
          missing={zap?.missing ?? null}
        />
        {/* The arrival card: in the shell too, so a channel change leaves it up.
            On a phone in portrait it is portalled under the player, where it
            covers neither the picture nor the rail; in React it stays here,
            so it still reads the shell. Not in fullscreen, where only the
            shell is drawn. */}
        {arrivalHost && !isFullscreen
          ? createPortal(<ArrivalCard channel={channel} placement="inline" />, arrivalHost)
          : <ArrivalCard channel={channel} />}
        {/* The latest chat over the video in theater and fullscreen, above
            the control bar */}
        <ChatOverlay composerRequest={composerRequest} onComposerClose={closeComposer} />
        <CastErrorBanner />
      </div>
      {/* One editor for every engine, keyed by the capture's channel, not the one playing */}
      <HighlightModal
        isOpen={clipSession !== null}
        onClose={closeClip}
        channelId={clipSession?.channelId ?? ''}
        channelName={clipSession?.channelName}
        capture={clipSession?.capture}
        playingChannel={playingChannel}
        container={shellElement}
      />
      <ShortcutSheet
        open={isShortcutSheetOpen}
        onOpenChange={setShortcutSheetOpen}
        container={shellElement}
        canSearch={focusSearch !== undefined}
        canClip={clipThat !== undefined}
        canReply={canReply}
        tvMode={isTVMode}
      />
    </PlayerShellContext>
  )
}

// The live stall watchdog: how often it looks, and how long the picture may
// stand still while playing before the stream counts as failed
const STALL_CHECK_MS = 1000
const STALL_TIMEOUT_MS = 8000

// Gentle catch-up on the live stream: once the picture is more than 5s behind
// the end of what it has buffered, it plays at 1.1x until it is 3s behind.
// Small drifts (a stall, a slow buffer) close without a visible jump. Tune on
// real streams: the thresholds are the finding's conservative starting point.
const LIVE_SYNC_CONFIG: mpegts.Config = {
  liveSync: true,
  liveSyncMaxLatency: 5,
  liveSyncTargetLatency: 3,
  liveSyncPlaybackRate: 1.1,
}

// Vidstack's HLS provider otherwise injects hls.js from cdn.jsdelivr.net at
// runtime, with a floating version and no integrity check; hand it ours
function setBundledHls(provider: MediaProviderAdapter | null) {
  if (isHLSProvider(provider)) provider.library = Hls
}

// Browsers refuse unmuted playback that no user gesture started, but always
// allow it muted
function isAutoplayPolicyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'NotAllowedError'
}

/**
 * Whether to say the sound is off because this page load started from a saved
 * mute: once playback has started, until the viewer makes any audio choice.
 * Shown once per page load, so a channel switch drops it for good.
 */
function useSavedMuteNotice(hasStarted: boolean, isStoreMuted: boolean): boolean {
  const savedMuteNotice = useAudioStore((s) => s.savedMuteNotice)
  const dismissSavedMuteNotice = useAudioStore((s) => s.dismissSavedMuteNotice)
  const isShown = hasStarted && isStoreMuted && savedMuteNotice

  useEffect(() => {
    if (!isShown) return
    return dismissSavedMuteNotice
  }, [isShown, dismissSavedMuteNotice])

  return isShown
}

// ============================================================================
// Placeholders
// ============================================================================

// The live slot always exists, so there is no channel only until the TV
// store initialises: this is startup, not a prompt to pick one
function NoChannelPlaceholder() {
  return (
    <div role="status" className="flex h-full w-full items-center justify-center gap-3 bg-black">
      <Loader2 className="h-6 w-6 text-muted-foreground motion-safe:animate-spin" aria-hidden="true" />
      <p className="text-lg text-muted-foreground">Tuning in...</p>
    </div>
  )
}

function NoLiveChannelPlaceholder({ onPickLive }: { onPickLive?: () => void }) {
  // Say who stopped live TV, so it doesn't look like the app broke
  const stoppedBy = useChannelStore((s) =>
    s.lastChange && s.lastChange.channelName === null ? s.lastChange.by : null
  )

  return (
    // live-slot-idle: the couch sizes it for the TV (index.css)
    <div className="live-slot-idle flex h-full w-full items-center justify-center bg-black">
      <div className="text-center">
        <p className="text-lg text-muted-foreground">No live broadcast</p>
        {stoppedBy && (
          <p className="mt-1 text-sm text-muted-foreground">{stoppedBy} stopped live TV</p>
        )}
        {onPickLive ? (
          <Button size="lg" className="mt-4" onClick={onPickLive}>
            Pick a channel for everyone
          </Button>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground/70">
            Waiting for someone to put something on
          </p>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Live Video Player (mpegts.js)
// ============================================================================

interface LiveVideoPlayerProps {
  channelId: string
  streamUrl: string
  channelName: string
  isMobile: boolean
}

function LiveVideoPlayer({
  channelId,
  streamUrl,
  channelName,
  isMobile,
}: LiveVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { containerRef, toggleFullscreen, toggleTheaterMode, isInfoRailVisible, reload } = usePlayerShell()
  const playerRef = useRef<mpegts.Player | null>(null)
  const [isBuffering, setIsBuffering] = useState(false)
  // Errors, the upstream closing and stalls reconnect with backoff, then stop
  const { status, attempt, maxRetries, retryKey, fail, succeed, retryNow } = useStreamRecovery()
  const isStopped = status === 'failed'
  // Playing and the element's own mute, for the chrome and the auto-hide
  const adapter = useLiveAdapter(videoRef)
  const { isPlaying, unmuteElement } = adapter
  const [hasStarted, setHasStarted] = useState(false)
  // Autoplay fallbacks: the browser only allowed muted playback, or none
  const [isSystemMutedState, setIsSystemMuted] = useState(false)
  const [isPlayBlocked, setIsPlayBlocked] = useState(false)

  // Detect TV mode
  const isTVMode = useTVMode()

  // Saved volume and mute (shared by every player); only user actions write
  // them, through the same handlers as the control bar
  const { volume, isStoreMuted, isMuted, changeVolume, toggleMute, unmute } = usePlayerAudio(adapter)
  // The clip editor is previewing: keep the element silent, the saved mute as it is
  const isPreviewHeld = useAudioStore((s) => s.previewHolds > 0)
  // Casting: the picture here pauses and the element is silent, the saved
  // volume and mute as they are
  const isCasting = useCastStore((s) => s.isCasting)
  const isSystemMuted = isSystemMutedState && !isStoreMuted
  const isSavedMuteNotice = useSavedMuteNotice(hasStarted, isStoreMuted)

  // The shell's auto-hide follows this engine; a tap on the picture toggles it
  useShellPlayback(isPlaying)

  // Behind its own live edge: only once playback has started (before that the
  // autoplay notice speaks), and not under the casting card, which pauses it
  useShellLiveEdge(hasStarted && adapter.isBehindLive && !isCasting, adapter.jumpToLive)
  // Paused after it started: not the casting hold, and not once the stream
  // has failed (the status card speaks then)
  useShellLivePaused(hasStarted && !isPlaying && !isCasting && !isStopped)
  // The notices are about the local picture: not over the casting card
  const isNoticeShown = !isCasting && (isPlayBlocked || isSystemMuted || isSavedMuteNotice)
  useShellAutoplayNotice(isNoticeShown)

  // The tap is a user gesture, so the browser lets the element unmute
  const handleSoundOn = useCallback(() => {
    unmuteElement()
    setIsSystemMuted(false)
  }, [unmuteElement])

  const handleStartPlayback = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (!useAudioStore.getState().muted) video.muted = false
    setIsPlayBlocked(false)
    // A reconnect or the stop destroying this player interrupts the play()
    // (AbortError): that is not a refusal, so it asks for no tap
    const player = playerRef.current
    video.play().catch(() => {
      if (playerRef.current === player) setIsPlayBlocked(true)
    })
  }, [])

  // Keyboard shortcuts
  useVideoKeyboardShortcuts({
    containerRef,
    onPlayPause: adapter.togglePaused,
    onMuteToggle: toggleMute,
    onFullscreenToggle: toggleFullscreen,
    onTheaterModeToggle: toggleTheaterMode,
    onRetry: reload,
    onVolumeChange: changeVolume,
    onUnmute: unmute,
    volume,
    isMuted,
    ignoreVerticalArrows: isTVMode,
    remotePlayPause: isTVMode,
  })

  // Check mpegts.js support
  const isMpegtsSupported = mpegts.isSupported()

  // Apply the saved volume and mute, and any preview hold or cast, to the
  // element. Declared before the mpegts effect so a new stream starts at the
  // viewer's level, and silent under an open clip editor or while casting.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    video.volume = volume
    video.muted = isStoreMuted || isPreviewHeld || isCasting
  }, [volume, isStoreMuted, isPreviewHeld, isCasting])

  // While casting the element stays paused: autoplay, a reconnect's play()
  // and Space are all undone
  useEffect(() => {
    const video = videoRef.current
    if (!video || !isCasting) return

    const hold = () => video.pause()
    hold()
    video.addEventListener('play', hold)
    return () => video.removeEventListener('play', hold)
  }, [isCasting])

  // When casting stops, start again at the live edge rather than resume the
  // buffer paused minutes ago: a new engine, the shell (and fullscreen) kept
  useEffect(
    () =>
      useCastStore.subscribe((state, prev) => {
        if (prev.isCasting && !state.isCasting) reload()
      }),
    [reload]
  )

  // Setup mpegts.js player: again on every reconnect, and not at all once
  // the reconnects have stopped (which also lets go of the upstream)
  useEffect(() => {
    const video = videoRef.current
    if (!video || !isMpegtsSupported || isStopped) return

    const player = mpegts.createPlayer(
      {
        type: 'mpegts',
        isLive: true,
        url: streamUrl,
      },
      // Not on a TV: playbackRate catch-up is untested on TV browsers
      isTVMode ? undefined : LIVE_SYNC_CONFIG
    )

    player.attachMediaElement(video)
    player.load()

    player.on(mpegts.Events.ERROR, fail)
    // A live source has no end: the load completing means the upstream closed
    // the connection. Only a paused player may have let it go on purpose.
    player.on(mpegts.Events.LOADING_COMPLETE, () => {
      setIsBuffering(false)
      if (!video.paused) fail()
    })

    // A policy refusal retries muted (element only, the saved mute is
    // untouched) with a 'Sound is off' notice; anything else, or a refusal
    // while already muted, gets a centre Play button. Destroying this player
    // on a reconnect or the stop rejects a pending play() with AbortError:
    // that attempt is over, so its rejections change nothing.
    // The cast hold pausing it rejects play() too: that asks for no tap either.
    let active = true
    video.play().catch((error: unknown) => {
      if (!active || useCastStore.getState().isCasting) return
      setIsBuffering(false)
      if (!isAutoplayPolicyError(error) || video.muted) {
        setIsPlayBlocked(true)
        return
      }
      video.muted = true
      setIsSystemMuted(true)
      video.play().catch(() => {
        if (active && !useCastStore.getState().isCasting) setIsPlayBlocked(true)
      })
    })
    playerRef.current = player

    // Video element events
    const handleWaiting = () => setIsBuffering(true)
    const handlePlaying = () => {
      setIsBuffering(false)
      setHasStarted(true)
      setIsPlayBlocked(false)
      succeed()
    }
    const handleError = fail
    // Never saved: element-only mutes (the clip preview hold) must not stick
    const handleVolumeChangeEvent = () => {
      // Read the hold now, not when the unmute was asked for: an unmute
      // during a preview (the slider, another window) or a cast is undone
      if (!video.muted && (useAudioStore.getState().previewHolds > 0 || useCastStore.getState().isCasting)) {
        video.muted = true
        return
      }
      // Any unmute (the notice, Mute button, M key, slider) ends the system mute
      if (!video.muted) setIsSystemMuted(false)
    }

    video.addEventListener('waiting', handleWaiting)
    video.addEventListener('playing', handlePlaying)
    video.addEventListener('error', handleError)
    video.addEventListener('volumechange', handleVolumeChangeEvent)

    return () => {
      active = false
      video.removeEventListener('waiting', handleWaiting)
      video.removeEventListener('playing', handlePlaying)
      video.removeEventListener('error', handleError)
      video.removeEventListener('volumechange', handleVolumeChangeEvent)

      if (playerRef.current) {
        playerRef.current.destroy()
        playerRef.current = null
      }
    }
  }, [streamUrl, retryKey, isStopped]) // eslint-disable-line react-hooks/exhaustive-deps

  // Stall watchdog: an upstream that stops sending without an error leaves
  // the picture frozen under a loader. The picture standing still for 8s
  // while the element plays counts as a failure. Not while paused, and not in
  // a hidden tab, where browsers throttle playback and timers.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !isMpegtsSupported || isStopped) return

    let lastTime = video.currentTime
    let frozenMs = 0
    const timer = window.setInterval(() => {
      const time = video.currentTime
      if (video.paused || document.visibilityState !== 'visible' || time !== lastTime) {
        lastTime = time
        frozenMs = 0
        return
      }
      frozenMs += STALL_CHECK_MS
      if (frozenMs >= STALL_TIMEOUT_MS) {
        frozenMs = 0
        fail()
      }
    }, STALL_CHECK_MS)
    return () => window.clearInterval(timer)
  }, [retryKey, isStopped, isMpegtsSupported, fail])

  return (
    <div className="relative h-full w-full">
      <video ref={videoRef} autoPlay className="h-full w-full object-contain" />

      <PlayerChrome
        adapter={adapter}
        channelId={channelId}
        streamUrl={streamUrl}
        channelName={channelName}
        isMobile={isMobile}
      />

      {/* The status card speaks for the stream once it has failed */}
      {isBuffering && (status === 'loading' || status === 'ready') && <ProjectorBeamLoader />}

      {/* The notices and the status card are about the local picture: not
          over the casting card, which paints under them */}
      {isNoticeShown && (
        <AutoplayNotice
          mode={isPlayBlocked ? 'tap-to-play' : 'sound-off'}
          volume={isSystemMuted ? volume : unmutedVolume(volume)}
          onUnmute={isSystemMuted ? handleSoundOn : unmute}
          onPlay={handleStartPlayback}
          belowRail={isInfoRailVisible}
        />
      )}

      {!isCasting && (
        <StreamStatusCard
          status={isMpegtsSupported ? status : 'unsupported'}
          attempt={attempt}
          maxAttempts={maxRetries}
          isStarting={!hasStarted}
          onRetry={retryNow}
        />
      )}
    </div>
  )
}

// ============================================================================
// HLS Video Player (Vidstack)
// ============================================================================

interface HLSVideoPlayerWrapperProps {
  channelId: string
  title?: string
  isMobile: boolean
}

function HLSVideoPlayerWrapper({
  channelId,
  title,
  isMobile,
}: HLSVideoPlayerWrapperProps) {
  const playerRef = useRef<MediaPlayerInstance>(null)
  const { isInfoRailVisible } = usePlayerShell()
  const [isBuffering, setIsBuffering] = useState(true)
  const [hasStarted, setHasStarted] = useState(false)

  // Saved volume and mute, passed as controlled props: Vidstack queues each
  // change until can-play, so channel switches, retry remounts and changes
  // made while the stream starts all land on the current values.
  const volume = useAudioStore((s) => s.volume)
  const muted = useAudioStore((s) => s.muted)
  const setStoredMuted = useAudioStore((s) => s.setMuted)
  // The clip editor is previewing: the element is muted, the saved mute kept
  const isPreviewHeld = useAudioStore((s) => s.previewHolds > 0)
  // Casting: paused and muted the same way, the saved mute kept
  const isCasting = useCastStore((s) => s.isCasting)
  const isSavedMuteNotice = useSavedMuteNotice(hasStarted, muted)

  const { status, attempt, maxRetries, retryKey, fail, succeed, retryNow } = useStreamRecovery()

  // Every attempt plays a fresh stream session, so one that has expired (a
  // 404 on a playlist reload) recovers through the retries. A session is
  // never released here: the Chromecast may be playing the same URL, and
  // idle expiry reclaims it.
  const [session, setSession] = useState<{ key: number; url: string } | null>(null)
  const streamUrl = session?.key === retryKey ? session.url : null
  useEffect(() => {
    let isCurrent = true
    createErsatzTVStreamSession(channelId).then(
      (url) => {
        if (isCurrent) setSession({ key: retryKey, url })
      },
      () => {
        if (isCurrent) fail()
      }
    )
    return () => {
      isCurrent = false
    }
  }, [channelId, retryKey, fail])

  // Autoplay fallbacks, recorded against the MediaPlayer mount (retryKey) they
  // happened on, so a retry remount starts clean. They mute the element only:
  // the muted prop keeps the saved preference.
  const [systemMutedKey, setSystemMutedKey] = useState<number | null>(null)
  const [playBlockedKey, setPlayBlockedKey] = useState<number | null>(null)
  const isSystemMuted = systemMutedKey === retryKey && !muted
  const isPlayBlocked = playBlockedKey === retryKey
  // The notices are about the local picture: not over the casting card
  const isNoticeShown = !isCasting && (isPlayBlocked || isSystemMuted || isSavedMuteNotice)
  useShellAutoplayNotice(isNoticeShown)

  const onPlaying = useCallback(() => {
    setIsBuffering(false)
    setHasStarted(true)
    setPlayBlockedKey(null)
    succeed()
  }, [succeed])

  const handleWaiting = useCallback(() => {
    setIsBuffering(true)
  }, [])

  // A refused play() leaves the player paused: never leave the loader over
  // it. Policy refusals retry muted with a 'Sound is off' notice; anything
  // else, or a refusal while already muted, gets a centre Play button.
  const handleRefusedPlay = useCallback(
    (error: unknown, wasMuted: boolean) => {
      setIsBuffering(false)
      if (!isAutoplayPolicyError(error) || wasMuted) {
        setPlayBlockedKey(retryKey)
        return
      }
      playerRef.current?.remoteControl.mute()
      setSystemMutedKey(retryKey)
      setTimeout(() => {
        playerRef.current?.play().catch(() => {
          setIsBuffering(false)
          setPlayBlockedKey(retryKey)
        })
      }, 0)
    },
    [retryKey]
  )

  const onPlainPlayFail = useCallback(
    (error: unknown) => {
      handleRefusedPlay(error, playerRef.current?.state.muted ?? false)
    },
    [handleRefusedPlay]
  )

  const onAutoPlayFail = useCallback(
    (detail: MediaAutoPlayFailEventDetail) => {
      // The cast pausing it is not a refusal: nothing to retry or ask
      if (useCastStore.getState().isCasting) return
      // Vidstack refuses every autoplay request under Reduce Motion. Picking a
      // channel is consent to play, and a plain play() is not an autoplay
      // request, but it has to wait a tick: autoPlaying is reset only after
      // this event has dispatched.
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setIsBuffering(false)
        setTimeout(() => {
          playerRef.current?.play().catch(onPlainPlayFail)
        }, 0)
        return
      }
      handleRefusedPlay(detail.error, detail.muted)
    },
    [handleRefusedPlay, onPlainPlayFail]
  )

  // While casting the picture stays paused, as on the live engine: the
  // control bar's Play, which stays in reach over the casting card, is undone
  const onPlay = useCallback(() => {
    if (useCastStore.getState().isCasting) playerRef.current?.pause()
  }, [])

  // Any unmute of the element (the notice, Mute button, M key, slider) ends
  // the system mute. Vidstack reports it asynchronously, so the preview hold
  // is read when the event arrives: an unmute during a preview is undone.
  const onVolumeChange = useCallback((detail: MediaVolumeChange) => {
    if (detail.muted) return
    if (useAudioStore.getState().previewHolds > 0 || useCastStore.getState().isCasting) {
      playerRef.current?.remoteControl.mute()
      return
    }
    setSystemMutedKey(null)
  }, [])

  // The tap is a user gesture, so the browser lets the element unmute
  const handleSoundOn = useCallback(() => {
    playerRef.current?.remoteControl.unmute()
    setSystemMutedKey(null)
  }, [])

  // Clears the saved mute; the store brings back the saved level. An
  // element-only mute leaves the muted prop unchanged, so ask Vidstack too.
  const handleRestoreSound = useCallback(() => {
    setStoredMuted(false)
    playerRef.current?.remoteControl.unmute()
  }, [setStoredMuted])

  const handleStartPlayback = useCallback(() => {
    const player = playerRef.current
    if (!player) return
    if (!useAudioStore.getState().muted) player.remoteControl.unmute()
    setPlayBlockedKey(null)
    player.play().catch(() => setPlayBlockedKey(retryKey))
  }, [retryKey])

  // Casting pauses the picture here; when it stops, playback resumes
  useEffect(
    () =>
      useCastStore.subscribe((state, prev) => {
        if (state.isCasting && !prev.isCasting) playerRef.current?.pause()
        else if (!state.isCasting && prev.isCasting) playerRef.current?.play().catch(onPlainPlayFail)
      }),
    [onPlainPlayFail]
  )

  return (
    <div className="relative h-full w-full bg-black flex items-center justify-center">
      {streamUrl && (
        <MediaPlayer
          key={retryKey}
          ref={playerRef}
          src={streamUrl}
          title={title}
          // Not while casting: a channel change then stays paused under the card
          autoPlay={!isCasting}
          playsInline
          volume={volume}
          muted={muted || isPreviewHeld || isCasting}
          // useVideoKeyboardShortcuts is the only keyboard map: Vidstack's own
          // keys seek, and change volume without saving it
          keyDisabled
          className="h-full w-full max-h-full max-w-full [&_video]:object-contain"
          onWaiting={handleWaiting}
          onPlaying={onPlaying}
          onAutoPlayFail={onAutoPlayFail}
          onPlay={onPlay}
          onVolumeChange={onVolumeChange}
          onError={fail}
          onProviderChange={setBundledHls}
        >
          <MediaProvider />
          <HLSControlsWrapper
            isMobile={isMobile}
            channelId={channelId}
            streamUrl={streamUrl}
            channelName={title}
          />
        </MediaPlayer>
      )}

      {/* Buffering overlay (and the session being opened); the status card
          speaks for the stream once it has failed */}
      {(isBuffering || !streamUrl) && (status === 'loading' || status === 'ready') && <ProjectorBeamLoader />}

      {/* The notices and the status card are about the local picture: not
          over the casting card, which paints under them */}
      {isNoticeShown && (
        <AutoplayNotice
          mode={isPlayBlocked ? 'tap-to-play' : 'sound-off'}
          volume={isSystemMuted ? volume : unmutedVolume(volume)}
          onUnmute={isSystemMuted ? handleSoundOn : handleRestoreSound}
          onPlay={handleStartPlayback}
          belowRail={isInfoRailVisible}
        />
      )}

      {/* Over the player, which stays mounted with its controls when the retries stop */}
      {!isCasting && (
        <StreamStatusCard
          status={status}
          attempt={attempt}
          maxAttempts={maxRetries}
          isStarting={!hasStarted}
          onRetry={retryNow}
        />
      )}
    </div>
  )
}

// The control bar and keyboard shortcuts, inside MediaPlayer so the adapter
// can read Vidstack's state
function HLSControlsWrapper({
  isMobile,
  channelId,
  streamUrl,
  channelName,
}: {
  isMobile: boolean
  channelId: string
  streamUrl: string
  channelName?: string
}) {
  // Playing and the element's own mute, from the MediaPlayer around this
  const adapter = useVidstackAdapter()
  const { containerRef, toggleFullscreen, toggleTheaterMode, reload } = usePlayerShell()

  // Detect TV mode
  const isTVMode = useTVMode()

  // Keyboard volume and mute write the audio store; MediaPlayer follows it
  const { volume, isMuted, changeVolume, toggleMute, unmute } = usePlayerAudio(adapter)
  // Space would play the picture the casting card stands in for
  const isCasting = useCastStore((s) => s.isCasting)

  // The shell's auto-hide follows this engine; a tap on the picture toggles it
  useShellPlayback(adapter.isPlaying)

  // Behind its own live edge; not under the casting card, which pauses it
  useShellLiveEdge(adapter.isBehindLive && !isCasting, adapter.jumpToLive)

  useVideoKeyboardShortcuts({
    containerRef,
    onPlayPause: isCasting ? undefined : adapter.togglePaused,
    onMuteToggle: toggleMute,
    onFullscreenToggle: toggleFullscreen,
    onTheaterModeToggle: toggleTheaterMode,
    onRetry: reload,
    onVolumeChange: changeVolume,
    onUnmute: unmute,
    volume,
    isMuted,
    ignoreVerticalArrows: isTVMode,
    remotePlayPause: isTVMode,
  })

  return (
    <PlayerChrome
      adapter={adapter}
      channelId={channelId}
      streamUrl={streamUrl}
      channelName={channelName}
      isMobile={isMobile}
    />
  )
}
