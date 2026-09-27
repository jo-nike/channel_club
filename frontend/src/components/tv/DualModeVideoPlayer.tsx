import { useState, useEffect, useRef, useCallback } from 'react'
import mpegts from 'mpegts.js'
import {
  MediaPlayer,
  MediaProvider,
  useMediaState,
  useMediaRemote,
  type MediaPlayerInstance,
} from '@vidstack/react'
import '@vidstack/react/player/styles/default/theme.css'
import { VideoControls } from '@/components/VideoControls'
import { ErsatzTVVideoControls } from '@/components/ersatztv/ErsatzTVVideoControls'
import { useAutoHide } from '@/hooks/useAutoHide'
import { useTVMode } from '@/hooks/useTVMode'
import { useCanSetVolume } from '@/hooks/useCanSetVolume'
import { useVideoKeyboardShortcuts } from '@/hooks/useVideoKeyboardShortcuts'
import { useOrientationFullscreen } from '@/hooks/useOrientationFullscreen'
import { useFullscreenState } from '@/hooks/useFullscreenState'
import { useHLSRetry } from '@/hooks/useHLSRetry'
import { ProjectorBeamLoader } from '@/components/ProjectorBeamLoader'
import { RetroTVFilter } from '@/components/filters/RetroTVFilter'
import { FilmGrainFilter } from '@/components/filters/FilmGrainFilter'
import { NoirFilter } from '@/components/filters/NoirFilter'
import { GrindhouseFilter } from '@/components/filters/GrindhouseFilter'
import { SportsHDFilter } from '@/components/filters/SportsHDFilter'
import { useFilterStore } from '@/stores/filterStore'
import { useAudioStore } from '@/stores/audioStore'
import { getErsatzTVStreamUrl } from '@/services/ersatztvApi'
import type { UnifiedChannel } from '@/types'

interface DualModeVideoPlayerProps {
  channel: UnifiedChannel | null
  isTheaterMode: boolean
  isMobile?: boolean
  onTheaterModeToggle: () => void
}

// Main component - switches between live (mpegts) and ersatztv (HLS) players
export function DualModeVideoPlayer({
  channel,
  isTheaterMode,
  isMobile = false,
  onTheaterModeToggle,
}: DualModeVideoPlayerProps) {
  // No channel selected
  if (!channel) {
    return <NoChannelPlaceholder />
  }

  // Live channel (Channel 0) with no stream (admin hasn't selected)
  if (channel.type === 'live' && !channel.streamUrl) {
    return <NoLiveChannelPlaceholder />
  }

  // Live channel - use mpegts.js player
  // Use backendId for highlight recording (real Dispatcharr ID), fallback to id
  if (channel.type === 'live') {
    return (
      <LiveVideoPlayer
        key={`live-${channel.streamUrl}`}
        channelId={channel.backendId || channel.id}
        streamUrl={channel.streamUrl}
        channelName={channel.name}
        channelNumber={channel.number}
        isTheaterMode={isTheaterMode}
        isMobile={isMobile}
        onTheaterModeToggle={onTheaterModeToggle}
      />
    )
  }

  // ErsatzTV channel - use HLS Vidstack player with proxied stream URL
  return (
    <HLSVideoPlayerWrapper
      key={`hls-${channel.id}`}
      channelId={channel.id}
      channelNumber={channel.number}
      streamUrl={getErsatzTVStreamUrl(channel.id)}
      title={channel.name}
      isTheaterMode={isTheaterMode}
      isMobile={isMobile}
      onTheaterModeToggle={onTheaterModeToggle}
    />
  )
}

// ============================================================================
// Placeholders
// ============================================================================

function NoChannelPlaceholder() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-black">
      <p className="text-lg text-muted-foreground">Select a channel to start watching</p>
    </div>
  )
}

function NoLiveChannelPlaceholder() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-black">
      <div className="text-center">
        <p className="text-lg text-muted-foreground">No live broadcast</p>
        <p className="mt-2 text-sm text-muted-foreground/70">
          Waiting for admin to select a channel
        </p>
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
  isTheaterMode: boolean
  isMobile: boolean
  onTheaterModeToggle: () => void
}

function LiveVideoPlayer({
  channelId,
  streamUrl,
  channelName,
  isTheaterMode,
  isMobile,
  onTheaterModeToggle,
}: LiveVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<mpegts.Player | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isBuffering, setIsBuffering] = useState(false)
  // Video state
  const [isPlaying, setIsPlaying] = useState(false)
  // Muted by something other than the viewer (e.g. the clip preview duck); display only
  const [isElementMuted, setIsElementMuted] = useState(false)
  const [isHoveringControls, setIsHoveringControls] = useState(false)

  // Detect TV mode
  const isTVMode = useTVMode()

  // Saved volume and mute (shared by every player); only user actions write them
  const volume = useAudioStore((s) => s.volume)
  const isStoreMuted = useAudioStore((s) => s.muted)
  const setStoredVolume = useAudioStore((s) => s.setVolume)
  const setStoredMuted = useAudioStore((s) => s.setMuted)
  const isMuted = isStoreMuted || isElementMuted
  const canSetVolume = useCanSetVolume()

  // Video filter state
  const isRetroTVActive = useFilterStore((s) => s.isFilterActive('retro-tv'))
  const isFilmGrainActive = useFilterStore((s) => s.isFilterActive('film-grain'))
  const isNoirActive = useFilterStore((s) => s.isFilterActive('noir'))
  const isGrindhouseActive = useFilterStore((s) => s.isFilterActive('grindhouse'))
  const isSportsHDActive = useFilterStore((s) => s.isFilterActive('sports-hd'))

  // Auto-hide controls
  const { isVisible, toggleControls } = useAutoHide({
    isPlaying,
    containerRef,
    isHoveringControls,
  })

  // Detect touch device
  const isTouchDevice = useCallback(() => {
    return window.matchMedia('(pointer: coarse)').matches
  }, [])

  // Handle video area click for touch devices
  const handleVideoAreaClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement
      if (target.closest('.video-controls')) return

      if (isTouchDevice()) {
        toggleControls()
      }
    },
    [isTouchDevice, toggleControls]
  )

  // Control handlers
  const handlePlayPause = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    if (video.paused) {
      video.play().catch(() => {})
    } else {
      video.pause()
    }
  }, [])

  const handleVolumeChange = useCallback((newVolume: number) => {
    // A level the browser ignores (iOS/iPadOS) would only save a meaningless value
    if (!canSetVolume) return
    setStoredVolume(newVolume)

    // Choosing an audible level also clears a mute that only the element had
    const video = videoRef.current
    if (video && !useAudioStore.getState().muted) video.muted = false
  }, [canSetVolume, setStoredVolume])

  const handleMuteToggle = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    const next = !(useAudioStore.getState().muted || video.muted)
    setStoredMuted(next)
    if (!next) video.muted = false
  }, [setStoredMuted])

  const handleFullscreenToggle = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      container.requestFullscreen().catch(() => {})
    }
  }, [])

  // Keyboard shortcuts
  useVideoKeyboardShortcuts({
    containerRef,
    onPlayPause: handlePlayPause,
    onMuteToggle: handleMuteToggle,
    onFullscreenToggle: handleFullscreenToggle,
    onTheaterModeToggle,
    onVolumeChange: handleVolumeChange,
    volume: isMuted ? 0 : volume,
    ignoreVerticalArrows: isTVMode,
  })

  // Auto-fullscreen on mobile landscape
  useOrientationFullscreen({
    containerRef,
    enabled: true,
  })

  // Fullscreen only when this player's container is the fullscreen element
  const isFullscreen = useFullscreenState(containerRef)

  // Check mpegts.js support
  const isMpegtsSupported = mpegts.isSupported()

  // Apply the saved volume and mute to the element. Declared before the
  // mpegts effect so a new stream starts at the viewer's level.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    video.volume = volume
    video.muted = isStoreMuted
  }, [volume, isStoreMuted])

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

    video.play().catch(() => {})
    playerRef.current = player

    // Video element events
    const handleWaiting = () => setIsBuffering(true)
    const handlePlaying = () => {
      setIsBuffering(false)
      setError(null)
      setIsPlaying(true)
    }
    const handlePause = () => setIsPlaying(false)
    const handlePlay = () => setIsPlaying(true)
    const handleError = () => setError('Stream unavailable')
    // Never saved: element-only mutes (the clip preview duck) must not stick
    const handleVolumeChangeEvent = () => {
      setIsElementMuted(video.muted)
    }

    video.addEventListener('waiting', handleWaiting)
    video.addEventListener('playing', handlePlaying)
    video.addEventListener('pause', handlePause)
    video.addEventListener('play', handlePlay)
    video.addEventListener('error', handleError)
    video.addEventListener('volumechange', handleVolumeChangeEvent)

    return () => {
      video.removeEventListener('waiting', handleWaiting)
      video.removeEventListener('playing', handlePlaying)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('error', handleError)
      video.removeEventListener('volumechange', handleVolumeChangeEvent)

      if (playerRef.current) {
        playerRef.current.destroy()
        playerRef.current = null
      }
    }
  }, [streamUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={containerRef}
      onClick={handleVideoAreaClick}
      className={`video-player-container relative bg-black ${
        isTheaterMode ? 'h-full w-full' : 'h-full w-full max-w-full'
      } ${!isVisible && isPlaying ? 'cursor-none' : ''}`}
    >
      <video ref={videoRef} autoPlay className="h-full w-full object-contain" />

      {/* Video filter overlays */}
      <RetroTVFilter isActive={isRetroTVActive} />
      <FilmGrainFilter isActive={isFilmGrainActive} />
      <NoirFilter isActive={isNoirActive} />
      <GrindhouseFilter isActive={isGrindhouseActive} />
      <SportsHDFilter isActive={isSportsHDActive} />

      <VideoControls
        videoRef={videoRef}
        containerRef={containerRef}
        isPlaying={isPlaying}
        volume={volume}
        isMuted={isMuted}
        isTheaterMode={isTheaterMode}
        isFullscreen={isFullscreen}
        isVisible={isVisible}
        isMobile={isMobile}
        isTVMode={isTVMode}
        channelId={channelId}
        streamUrl={streamUrl}
        channelName={channelName}
        onPlayPause={handlePlayPause}
        onVolumeChange={handleVolumeChange}
        onMuteToggle={handleMuteToggle}
        onFullscreenToggle={handleFullscreenToggle}
        onTheaterModeToggle={onTheaterModeToggle}
        onMouseEnter={() => setIsHoveringControls(true)}
        onMouseLeave={() => setIsHoveringControls(false)}
      />

      {isBuffering && <ProjectorBeamLoader />}

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
  isTheaterMode: boolean
  isMobile: boolean
  onTheaterModeToggle: () => void
}

function HLSVideoPlayerWrapper({
  channelId,
  streamUrl,
  title,
  isTheaterMode,
  isMobile,
  onTheaterModeToggle,
}: HLSVideoPlayerWrapperProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<MediaPlayerInstance>(null)
  const [isBuffering, setIsBuffering] = useState(true)

  // Saved volume and mute, passed as controlled props: Vidstack queues each
  // change until can-play, so channel switches, retry remounts and changes
  // made while the stream starts all land on the current values.
  const volume = useAudioStore((s) => s.volume)
  const muted = useAudioStore((s) => s.muted)

  const { status, retryCount, retryKey, handleError, handlePlaying } = useHLSRetry({
    streamUrl,
  })

  // Video filter state
  const isRetroTVActive = useFilterStore((s) => s.isFilterActive('retro-tv'))
  const isFilmGrainActive = useFilterStore((s) => s.isFilterActive('film-grain'))
  const isNoirActive = useFilterStore((s) => s.isFilterActive('noir'))
  const isGrindhouseActive = useFilterStore((s) => s.isFilterActive('grindhouse'))
  const isSportsHDActive = useFilterStore((s) => s.isFilterActive('sports-hd'))

  useOrientationFullscreen({ containerRef, enabled: true })

  const onPlaying = useCallback(() => {
    setIsBuffering(false)
    handlePlaying()
  }, [handlePlaying])

  const handleWaiting = useCallback(() => {
    setIsBuffering(true)
  }, [])

  // A refused play() leaves the player paused: never leave the loader over it
  const onPlainPlayFail = useCallback(() => {
    setIsBuffering(false)
  }, [])

  const onAutoPlayFail = useCallback(
    () => {
      setIsBuffering(false)
      // Vidstack refuses every autoplay request under Reduce Motion. Picking a
      // channel is consent to play, and a plain play() is not an autoplay
      // request, but it has to wait a tick: autoPlaying is reset only after
      // this event has dispatched.
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setTimeout(() => {
          playerRef.current?.play().catch(onPlainPlayFail)
        }, 0)
      }
    },
    [onPlainPlayFail]
  )

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
    <div ref={containerRef} className="relative h-full w-full bg-black flex items-center justify-center">
      {/* Video filter overlays. Before MediaPlayer: it creates no stacking
          context, so the z-10 control bar inside it paints above these z-10
          filters only if it comes later in the DOM. */}
      <RetroTVFilter isActive={isRetroTVActive} />
      <FilmGrainFilter isActive={isFilmGrainActive} />
      <NoirFilter isActive={isNoirActive} />
      <GrindhouseFilter isActive={isGrindhouseActive} />
      <SportsHDFilter isActive={isSportsHDActive} />

      <MediaPlayer
        key={retryKey}
        ref={playerRef}
        src={streamUrl}
        title={title}
        autoPlay
        playsInline
        volume={volume}
        muted={muted}
        // useVideoKeyboardShortcuts is the only keyboard map: Vidstack's own
        // keys seek, and change volume without saving it
        keyDisabled
        className="h-full w-full max-h-full max-w-full [&_video]:object-contain"
        onWaiting={handleWaiting}
        onPlaying={onPlaying}
        onAutoPlayFail={onAutoPlayFail}
        onError={handleError}
      >
        <MediaProvider />
        <HLSControlsWrapper
          containerRef={containerRef}
          isTheaterMode={isTheaterMode}
          isMobile={isMobile}
          channelId={channelId}
          streamUrl={streamUrl}
          channelName={title}
          onTheaterModeToggle={onTheaterModeToggle}
        />
      </MediaPlayer>

      {/* Buffering overlay */}
      {(isBuffering || status === 'retrying') && (
        <ProjectorBeamLoader
          text={status === 'retrying' ? `Stream starting... (${retryCount + 1}/5)` : undefined}
        />
      )}
    </div>
  )
}

// HLS Controls with Vidstack context
function HLSControlsWrapper({
  containerRef,
  isTheaterMode,
  isMobile,
  channelId,
  streamUrl,
  channelName,
  onTheaterModeToggle,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  isTheaterMode: boolean
  isMobile: boolean
  channelId: string
  streamUrl: string
  channelName?: string
  onTheaterModeToggle: () => void
}) {
  const paused = useMediaState('paused')
  const isElementMuted = useMediaState('muted')
  const remote = useMediaRemote()
  const [isHoveringControls, setIsHoveringControls] = useState(false)

  // Detect TV mode
  const isTVMode = useTVMode()

  // Keyboard volume and mute write the audio store; MediaPlayer follows it
  const volume = useAudioStore((s) => s.volume)
  const isStoreMuted = useAudioStore((s) => s.muted)
  const setStoredVolume = useAudioStore((s) => s.setVolume)
  const setStoredMuted = useAudioStore((s) => s.setMuted)
  const isMuted = isStoreMuted || isElementMuted
  const canSetVolume = useCanSetVolume()

  const handleVolumeChange = useCallback(
    (newVolume: number) => {
      // A level the browser ignores (iOS/iPadOS) would only save a meaningless value
      if (!canSetVolume) return
      setStoredVolume(newVolume)
      // Choosing an audible level also clears a mute that only the element had
      if (!useAudioStore.getState().muted) remote.unmute()
    },
    [canSetVolume, remote, setStoredVolume]
  )

  const handleMuteToggle = useCallback(() => {
    const next = !isMuted
    setStoredMuted(next)
    // An element-only mute leaves the muted prop unchanged, so ask Vidstack too
    if (!next) remote.unmute()
  }, [isMuted, remote, setStoredMuted])

  const isPlaying = !paused

  const { isVisible, toggleControls } = useAutoHide({
    isPlaying,
    containerRef,
    isHoveringControls,
  })

  // Detect touch device
  const isTouchDevice = useCallback(() => {
    return window.matchMedia('(pointer: coarse)').matches
  }, [])

  // Handle video area click for touch devices - toggle controls visibility
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // Don't toggle if clicking on controls
      if (target.closest('.video-controls')) return

      if (isTouchDevice()) {
        toggleControls()
      }
    }

    container.addEventListener('click', handleClick)
    return () => container.removeEventListener('click', handleClick)
  }, [containerRef, isTouchDevice, toggleControls])

  useVideoKeyboardShortcuts({
    containerRef,
    onPlayPause: () => remote.togglePaused(),
    onMuteToggle: handleMuteToggle,
    onFullscreenToggle: () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
      else containerRef.current?.requestFullscreen().catch(() => {})
    },
    onTheaterModeToggle,
    onVolumeChange: handleVolumeChange,
    volume: isMuted ? 0 : volume,
    ignoreVerticalArrows: isTVMode,
  })

  return (
    <ErsatzTVVideoControls
      containerRef={containerRef}
      isTheaterMode={isTheaterMode}
      isVisible={isVisible}
      isMobile={isMobile}
      isTVMode={isTVMode}
      channelId={channelId}
      streamUrl={streamUrl}
      channelName={channelName}
      onTheaterModeToggle={onTheaterModeToggle}
      onMouseEnter={() => setIsHoveringControls(true)}
      onMouseLeave={() => setIsHoveringControls(false)}
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
