import { useState, useEffect, useRef, useCallback } from 'react'
import mpegts from 'mpegts.js'
import { useChannelStore } from '@/stores/channelStore'
import { useUIStore } from '@/stores/uiStore'
import { VideoControls } from '@/components/VideoControls'
import { useAutoHide } from '@/hooks/useAutoHide'
import { useVideoKeyboardShortcuts } from '@/hooks/useVideoKeyboardShortcuts'
import { useOrientationFullscreen } from '@/hooks/useOrientationFullscreen'
import { ChannelSwitchOverlay } from '@/components/ChannelSwitchOverlay'

// Constants
const VOLUME_STORAGE_KEY = 'iptv-volume'
const DEFAULT_VOLUME = 1

export function VideoPlayer() {
  const currentChannel = useChannelStore((s) => s.currentChannel)

  // No channel selected - show placeholder
  if (!currentChannel) {
    return <VideoPlayerPlaceholder />
  }

  // Using key prop to reset state when channel changes
  return (
    <VideoPlayerInner
      key={currentChannel.id}
      streamUrl={currentChannel.streamUrl}
      channelName={currentChannel.name}
    />
  )
}

interface VideoPlayerInnerProps {
  streamUrl: string
  channelName: string
}

function VideoPlayerInner({ streamUrl, channelName }: VideoPlayerInnerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<mpegts.Player | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isBuffering, setIsBuffering] = useState(false)
  const [isChangingChannel, setIsChangingChannel] = useState(true)

  // Video state
  const [isPlaying, setIsPlaying] = useState(false)
  const [volume, setVolume] = useState(() => {
    const stored = localStorage.getItem(VOLUME_STORAGE_KEY)
    return stored ? parseFloat(stored) : DEFAULT_VOLUME
  })
  const [isMuted, setIsMuted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Hover state for controls - prevents auto-hide when hovering over controls
  const [isHoveringControls, setIsHoveringControls] = useState(false)

  // Theater mode from UI store
  const isTheaterMode = useUIStore((s) => s.isTheaterMode)
  const toggleTheaterMode = useUIStore((s) => s.toggleTheaterMode)

  // Auto-hide controls with hover override
  const { isVisible, toggleControls } = useAutoHide({
    isPlaying,
    containerRef,
    isHoveringControls,
  })

  // Detect touch device
  const isTouchDevice = useCallback(() => {
    return window.matchMedia('(pointer: coarse)').matches
  }, [])

  // Handle video area tap/click for touch devices
  const handleVideoAreaClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Only handle clicks directly on the video container or video element
    // Ignore clicks on controls or other interactive elements
    const target = e.target as HTMLElement
    if (target.closest('.video-controls')) {
      return
    }

    // On touch devices, toggle controls visibility
    if (isTouchDevice()) {
      toggleControls()
    }
  }, [isTouchDevice, toggleControls])

  // Play/Pause toggle
  const handlePlayPause = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    if (video.paused) {
      video.play().catch(() => {
        // Autoplay blocked
      })
    } else {
      video.pause()
    }
  }, [])

  // Volume change
  const handleVolumeChange = useCallback((newVolume: number) => {
    const video = videoRef.current
    if (!video) return

    const clampedVolume = Math.max(0, Math.min(1, newVolume))
    video.volume = clampedVolume
    setVolume(clampedVolume)
    localStorage.setItem(VOLUME_STORAGE_KEY, clampedVolume.toString())

    // Unmute if volume is changed while muted
    if (video.muted && clampedVolume > 0) {
      video.muted = false
      setIsMuted(false)
    }
  }, [])

  // Mute toggle
  const handleMuteToggle = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    video.muted = !video.muted
    setIsMuted(video.muted)
  }, [])

  // Fullscreen toggle
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
    onTheaterModeToggle: toggleTheaterMode,
    onVolumeChange: handleVolumeChange,
    volume,
  })

  // Auto-fullscreen on mobile landscape rotation
  useOrientationFullscreen({
    containerRef,
    enabled: true,
  })

  // Track fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  // Check mpegts.js support (at component level, not in effect)
  const isMpegtsSupported = mpegts.isSupported()

  // mpegts.js player setup
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // Set initial volume
    video.volume = volume
    video.muted = isMuted

    // Early return if mpegts not supported (error shown below in render)
    if (!isMpegtsSupported) {
      return
    }

    // Create mpegts.js player
    const player = mpegts.createPlayer({
      type: 'mpegts',
      isLive: true,
      url: streamUrl,
    })

    player.attachMediaElement(video)
    player.load()

    // Handle player events
    player.on(mpegts.Events.ERROR, () => {
      setError('Stream unavailable')
    })

    player.on(mpegts.Events.LOADING_COMPLETE, () => {
      setIsBuffering(false)
    })

    // Try to play
    video.play().catch(() => {
      // Autoplay blocked - user will need to click
    })

    playerRef.current = player

    // Handle video element events
    const handleWaiting = () => setIsBuffering(true)
    const handlePlaying = () => {
      setIsBuffering(false)
      setIsChangingChannel(false)
      setError(null)
      setIsPlaying(true)
    }
    const handlePause = () => setIsPlaying(false)
    const handlePlay = () => setIsPlaying(true)
    const handleError = () => setError('Stream unavailable')
    const handleVolumeChangeEvent = () => {
      setVolume(video.volume)
      setIsMuted(video.muted)
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
        isTheaterMode ? 'h-full w-full' : 'aspect-video w-full'
      } ${!isVisible && isPlaying ? 'cursor-none' : ''}`}
    >
      <video
        ref={videoRef}
        autoPlay
        className="h-full w-full object-contain"
      />

      {/* Custom video controls */}
      <VideoControls
        videoRef={videoRef}
        isPlaying={isPlaying}
        volume={volume}
        isMuted={isMuted}
        isTheaterMode={isTheaterMode}
        isFullscreen={isFullscreen}
        isVisible={isVisible}
        onPlayPause={handlePlayPause}
        onVolumeChange={handleVolumeChange}
        onMuteToggle={handleMuteToggle}
        onFullscreenToggle={handleFullscreenToggle}
        onTheaterModeToggle={toggleTheaterMode}
        onMouseEnter={() => setIsHoveringControls(true)}
        onMouseLeave={() => setIsHoveringControls(false)}
      />

      {/* Channel switch overlay - during initial load */}
      <ChannelSwitchOverlay
        channelName={channelName}
        isVisible={isChangingChannel}
      />

      {/* Buffering overlay - during playback (only show when not changing channel) */}
      <BufferingOverlay isVisible={isBuffering && !isChangingChannel} />

      {/* Error overlay on top of player */}
      {!isMpegtsSupported && <ErrorOverlay message="MPEG-TS playback not supported in this browser" />}
      {error && isMpegtsSupported && <ErrorOverlay message={error} />}
    </div>
  )
}

export function BufferingOverlay({ isVisible }: { isVisible: boolean }) {
  if (!isVisible) return null

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-white border-t-transparent" />
    </div>
  )
}

export function ErrorOverlay({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80">
      <div className="rounded-lg bg-destructive/20 p-6 text-center">
        <p className="text-xl font-semibold text-destructive-foreground">
          {message}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Select another channel from the list
        </p>
      </div>
    </div>
  )
}

function VideoPlayerPlaceholder() {
  return (
    <div className="flex aspect-video w-full items-center justify-center bg-black">
      <p className="text-lg text-muted-foreground">No channel selected</p>
    </div>
  )
}
