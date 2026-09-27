import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react'
import mpegts from 'mpegts.js'
import { Loader2 } from 'lucide-react'
import {
  MediaPlayer,
  MediaProvider,
  type MediaAutoPlayFailEventDetail,
  type MediaPlayerInstance,
  type MediaVolumeChange,
} from '@vidstack/react'
import '@vidstack/react/player/styles/default/theme.css'
import { useAutoHide } from '@/hooks/useAutoHide'
import { useTVMode } from '@/hooks/useTVMode'
import { useVideoKeyboardShortcuts } from '@/hooks/useVideoKeyboardShortcuts'
import { useFullscreenState } from '@/hooks/useFullscreenState'
import { useHLSRetry } from '@/hooks/useHLSRetry'
import { ProjectorBeamLoader } from '@/components/ProjectorBeamLoader'
import { Button } from '@/components/ui/button'
import { AutoplayNotice } from '@/components/player/AutoplayNotice'
import { PlayerShellContext, usePlayerShell, useShellPlayback } from '@/components/player/PlayerShellContext'
import { FilterLayer } from '@/components/player/FilterLayer'
import { PlayerChrome } from '@/components/player/PlayerChrome'
import { useLiveAdapter, useVidstackAdapter } from '@/components/player/mediaAdapters'
import { usePlayerAudio } from '@/components/player/usePlayerAudio'
import { NHLScoresOverlay } from '@/components/NHLScoresOverlay'
import { HighlightModal } from '@/components/HighlightModal'
import { useAudioStore, unmutedVolume } from '@/stores/audioStore'
import { useChannelStore } from '@/stores/channelStore'
import { useClipStore } from '@/stores/clipStore'
import { useUIStore } from '@/stores/uiStore'
import { getErsatzTVStreamUrl } from '@/services/ersatztvApi'
import type { UnifiedChannel } from '@/types'

interface DualModeVideoPlayerProps {
  channel: UnifiedChannel | null
  isTheaterMode: boolean
  isMobile?: boolean
  onTheaterModeToggle: () => void
  // Opens the live channel picker; only for people allowed to change live TV
  onPickLive?: () => void
  // Bumped by the page's Refresh: re-initialises the engine, keeps the shell
  reloadKey?: number
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
  const isNHLOverlayVisible = useUIStore((s) => s.isNHLOverlayVisible)

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
  const { isVisible: controlsVisible } = useAutoHide({
    isPlaying: isEnginePlaying,
    containerRef,
    isHoveringControls,
  })

  // Both counters only grow, so their sum changes on every reload
  const [shellReloads, setShellReloads] = useState(0)
  const reloadKey = pageReloadKey + shellReloads
  const reload = useCallback(() => setShellReloads((n) => n + 1), [])

  const shell = useMemo(
    () => ({
      containerRef,
      isFullscreen,
      toggleFullscreen,
      isTheaterMode,
      toggleTheaterMode: onTheaterModeToggle,
      controlsVisible,
      setPlaying: setEnginePlaying,
      setHoveringControls,
      reload,
      reloadKey,
    }),
    [isFullscreen, toggleFullscreen, isTheaterMode, onTheaterModeToggle, controlsVisible, reload, reloadKey]
  )

  // What this viewer's player shows now, for the clip editor's notice: null
  // while live TV is stopped, nothing before a channel is selected
  const playingChannel = !channel
    ? undefined
    : channel.type === 'live' && !channel.streamUrl
      ? null
      : { id: channel.backendId || channel.id, name: channel.name }

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
        channelNumber={channel.number}
        isMobile={isMobile}
      />
    )
  } else {
    // ErsatzTV channel - use HLS Vidstack player with proxied stream URL
    engine = (
      <HLSVideoPlayerWrapper
        key={`hls-${channel.id}-${reloadKey}`}
        channelId={channel.id}
        channelNumber={channel.number}
        streamUrl={getErsatzTVStreamUrl(channel.id)}
        title={channel.name}
        isMobile={isMobile}
      />
    )
  }

  return (
    <PlayerShellContext value={shell}>
      <div ref={attachShell} className="video-player-container relative h-full w-full bg-black">
        {/* Before the engine, so its control bar paints above the filters */}
        <FilterLayer />
        {engine}
        {/* In the shell, so the ticker shows in fullscreen too */}
        <NHLScoresOverlay isVisible={isNHLOverlayVisible} />
      </div>
      {/* One editor for every engine, keyed by the capture's channel, not the one playing */}
      <HighlightModal
        isOpen={clipSession !== null}
        onClose={closeClip}
        channelId={clipSession?.channelId ?? ''}
        channelName={clipSession?.channelName}
        playingChannel={playingChannel}
        container={shellElement}
      />
    </PlayerShellContext>
  )
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
    <div className="flex h-full w-full items-center justify-center bg-black">
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
  channelNumber: number
  isMobile: boolean
}

function LiveVideoPlayer({
  channelId,
  streamUrl,
  channelName,
  isMobile,
}: LiveVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { containerRef, toggleFullscreen, toggleTheaterMode, controlsVisible } = usePlayerShell()
  const playerRef = useRef<mpegts.Player | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isBuffering, setIsBuffering] = useState(false)
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
  const isSystemMuted = isSystemMutedState && !isStoreMuted
  const isSavedMuteNotice = useSavedMuteNotice(hasStarted, isStoreMuted)

  // The shell's auto-hide follows this engine; a tap on the picture toggles it
  useShellPlayback(isPlaying)

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
    video.play().catch(() => setIsPlayBlocked(true))
  }, [])

  // Keyboard shortcuts
  useVideoKeyboardShortcuts({
    containerRef,
    onPlayPause: adapter.togglePaused,
    onMuteToggle: toggleMute,
    onFullscreenToggle: toggleFullscreen,
    onTheaterModeToggle: toggleTheaterMode,
    onVolumeChange: changeVolume,
    onUnmute: unmute,
    volume,
    isMuted,
    ignoreVerticalArrows: isTVMode,
  })

  // Check mpegts.js support
  const isMpegtsSupported = mpegts.isSupported()

  // Apply the saved volume and mute, and any preview hold, to the element.
  // Declared before the mpegts effect so a new stream starts at the viewer's
  // level, and silent under an open clip editor.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    video.volume = volume
    video.muted = isStoreMuted || isPreviewHeld
  }, [volume, isStoreMuted, isPreviewHeld])

  // Setup mpegts.js player
  useEffect(() => {
    const video = videoRef.current
    if (!video || !isMpegtsSupported) return

    const player = mpegts.createPlayer({
      type: 'mpegts',
      isLive: true,
      url: streamUrl,
    })

    player.attachMediaElement(video)
    player.load()

    player.on(mpegts.Events.ERROR, () => setError('Stream unavailable'))
    player.on(mpegts.Events.LOADING_COMPLETE, () => setIsBuffering(false))

    // A policy refusal retries muted (element only, the saved mute is
    // untouched) with a 'Sound is off' notice; anything else, or a refusal
    // while already muted, gets a centre Play button
    video.play().catch((error: unknown) => {
      setIsBuffering(false)
      if (!isAutoplayPolicyError(error) || video.muted) {
        setIsPlayBlocked(true)
        return
      }
      video.muted = true
      setIsSystemMuted(true)
      video.play().catch(() => setIsPlayBlocked(true))
    })
    playerRef.current = player

    // Video element events
    const handleWaiting = () => setIsBuffering(true)
    const handlePlaying = () => {
      setIsBuffering(false)
      setError(null)
      setHasStarted(true)
      setIsPlayBlocked(false)
    }
    const handleError = () => setError('Stream unavailable')
    // Never saved: element-only mutes (the clip preview hold) must not stick
    const handleVolumeChangeEvent = () => {
      // Read the hold now, not when the unmute was asked for: an unmute
      // during a preview (the slider, another window) is undone
      if (!video.muted && useAudioStore.getState().previewHolds > 0) {
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
      video.removeEventListener('waiting', handleWaiting)
      video.removeEventListener('playing', handlePlaying)
      video.removeEventListener('error', handleError)
      video.removeEventListener('volumechange', handleVolumeChangeEvent)

      if (playerRef.current) {
        playerRef.current.destroy()
        playerRef.current = null
      }
    }
  }, [streamUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`relative h-full w-full ${!controlsVisible && isPlaying ? 'cursor-none' : ''}`}>
      <video ref={videoRef} autoPlay className="h-full w-full object-contain" />

      <PlayerChrome
        adapter={adapter}
        channelId={channelId}
        streamUrl={streamUrl}
        channelName={channelName}
        isMobile={isMobile}
      />

      {isBuffering && <ProjectorBeamLoader />}

      {(isPlayBlocked || isSystemMuted || isSavedMuteNotice) && (
        <AutoplayNotice
          mode={isPlayBlocked ? 'tap-to-play' : 'sound-off'}
          volume={isSystemMuted ? volume : unmutedVolume(volume)}
          onUnmute={isSystemMuted ? handleSoundOn : unmute}
          onPlay={handleStartPlayback}
        />
      )}

      {!isMpegtsSupported && <ErrorOverlay message="MPEG-TS playback not supported" />}
      {error && isMpegtsSupported && <ErrorOverlay message={error} />}
    </div>
  )
}

// ============================================================================
// HLS Video Player (Vidstack)
// ============================================================================

interface HLSVideoPlayerWrapperProps {
  channelId: string
  channelNumber: number
  streamUrl: string
  title?: string
  isMobile: boolean
}

function HLSVideoPlayerWrapper({
  channelId,
  streamUrl,
  title,
  isMobile,
}: HLSVideoPlayerWrapperProps) {
  const playerRef = useRef<MediaPlayerInstance>(null)
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
  const isSavedMuteNotice = useSavedMuteNotice(hasStarted, muted)

  const { status, retryCount, retryKey, handleError, handlePlaying } = useHLSRetry({
    streamUrl,
  })

  // Autoplay fallbacks, recorded against the MediaPlayer mount (retryKey) they
  // happened on, so a retry remount starts clean. They mute the element only:
  // the muted prop keeps the saved preference.
  const [systemMutedKey, setSystemMutedKey] = useState<number | null>(null)
  const [playBlockedKey, setPlayBlockedKey] = useState<number | null>(null)
  const isSystemMuted = systemMutedKey === retryKey && !muted
  const isPlayBlocked = playBlockedKey === retryKey

  const onPlaying = useCallback(() => {
    setIsBuffering(false)
    setHasStarted(true)
    setPlayBlockedKey(null)
    handlePlaying()
  }, [handlePlaying])

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

  // Any unmute of the element (the notice, Mute button, M key, slider) ends
  // the system mute. Vidstack reports it asynchronously, so the preview hold
  // is read when the event arrives: an unmute during a preview is undone.
  const onVolumeChange = useCallback((detail: MediaVolumeChange) => {
    if (detail.muted) return
    if (useAudioStore.getState().previewHolds > 0) {
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

  if (status === 'failed') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black">
        <div className="rounded-lg bg-destructive/20 p-6 text-center">
          <p className="text-xl font-semibold text-destructive-foreground">Stream unavailable</p>
          <p className="mt-2 text-sm text-muted-foreground">Select another channel</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full bg-black flex items-center justify-center">
      <MediaPlayer
        key={retryKey}
        ref={playerRef}
        src={streamUrl}
        title={title}
        autoPlay
        playsInline
        volume={volume}
        muted={muted || isPreviewHeld}
        // useVideoKeyboardShortcuts is the only keyboard map: Vidstack's own
        // keys seek, and change volume without saving it
        keyDisabled
        className="h-full w-full max-h-full max-w-full [&_video]:object-contain"
        onWaiting={handleWaiting}
        onPlaying={onPlaying}
        onAutoPlayFail={onAutoPlayFail}
        onVolumeChange={onVolumeChange}
        onError={handleError}
      >
        <MediaProvider />
        <HLSControlsWrapper
          isMobile={isMobile}
          channelId={channelId}
          streamUrl={streamUrl}
          channelName={title}
        />
      </MediaPlayer>

      {/* Buffering overlay */}
      {(isBuffering || status === 'retrying') && (
        <ProjectorBeamLoader
          text={status === 'retrying' ? `Stream starting... (${retryCount + 1}/5)` : undefined}
        />
      )}

      {(isPlayBlocked || isSystemMuted || isSavedMuteNotice) && (
        <AutoplayNotice
          mode={isPlayBlocked ? 'tap-to-play' : 'sound-off'}
          volume={isSystemMuted ? volume : unmutedVolume(volume)}
          onUnmute={isSystemMuted ? handleSoundOn : handleRestoreSound}
          onPlay={handleStartPlayback}
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
  const { containerRef, toggleFullscreen, toggleTheaterMode } = usePlayerShell()

  // Detect TV mode
  const isTVMode = useTVMode()

  // Keyboard volume and mute write the audio store; MediaPlayer follows it
  const { volume, isMuted, changeVolume, toggleMute, unmute } = usePlayerAudio(adapter)

  // The shell's auto-hide follows this engine; a tap on the picture toggles it
  useShellPlayback(adapter.isPlaying)

  useVideoKeyboardShortcuts({
    containerRef,
    onPlayPause: adapter.togglePaused,
    onMuteToggle: toggleMute,
    onFullscreenToggle: toggleFullscreen,
    onTheaterModeToggle: toggleTheaterMode,
    onVolumeChange: changeVolume,
    onUnmute: unmute,
    volume,
    isMuted,
    ignoreVerticalArrows: isTVMode,
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

// ============================================================================
// Shared Components
// ============================================================================

function ErrorOverlay({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80">
      <div className="rounded-lg bg-destructive/20 p-6 text-center">
        <p className="text-xl font-semibold text-destructive-foreground">{message}</p>
        <p className="mt-2 text-sm text-muted-foreground">Select another channel</p>
      </div>
    </div>
  )
}
