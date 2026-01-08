import { useRef, useState, useCallback, useEffect } from 'react'
import {
  MediaPlayer,
  MediaProvider,
  useMediaState,
  useMediaRemote,
  type MediaPlayerInstance,
} from '@vidstack/react'
import '@vidstack/react/player/styles/default/theme.css'
import { ProjectorBeamLoader } from '@/components/ProjectorBeamLoader'
import { ErsatzTVVideoControls } from './ErsatzTVVideoControls'
import { useAutoHide } from '@/hooks/useAutoHide'
import { useOrientationFullscreen } from '@/hooks/useOrientationFullscreen'
import { useHLSRetry } from '@/hooks/useHLSRetry'

interface HLSVideoPlayerProps {
  streamUrl: string
  title?: string
  channelId?: string
  isTheaterMode: boolean
  isMobile?: boolean
  onTheaterModeToggle: () => void
  onError?: (error: Error) => void
  onReady?: () => void
}

// Inner controls component that has access to Vidstack context
function PlayerControlsWrapper({
  containerRef,
  isTheaterMode,
  isMobile,
  channelId,
  onTheaterModeToggle,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  isTheaterMode: boolean
  isMobile: boolean
  channelId?: string
  onTheaterModeToggle: () => void
}) {
  const paused = useMediaState('paused')
  const volume = useMediaState('volume')
  const remote = useMediaRemote()
  const [isHoveringControls, setIsHoveringControls] = useState(false)

  const isPlaying = !paused

  const { isVisible } = useAutoHide({
    isPlaying,
    containerRef,
    isHoveringControls,
  })

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement

      // Skip if focus is on an input, textarea, or other form element
      if (
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement instanceof HTMLSelectElement
      ) {
        return
      }

      // Check if event target is within video container or is the body
      const container = containerRef.current
      const isWithinContainer =
        container?.contains(activeElement) || activeElement === document.body

      if (!isWithinContainer) return

      switch (e.key) {
        case ' ': // Space - Play/Pause
          e.preventDefault()
          remote.togglePaused()
          break

        case 'm':
        case 'M': // M - Mute toggle
          remote.toggleMuted()
          break

        case 'f':
        case 'F': // F - Fullscreen toggle
          remote.toggleFullscreen()
          break

        case 't':
        case 'T': // T - Theater mode toggle
          onTheaterModeToggle()
          break

        case 'ArrowRight': // Arrow Right - Volume up
          e.preventDefault()
          remote.changeVolume(Math.min(1, volume + 0.1))
          break

        case 'ArrowLeft': // Arrow Left - Volume down
          e.preventDefault()
          remote.changeVolume(Math.max(0, volume - 0.1))
          break

        default:
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [containerRef, remote, volume, onTheaterModeToggle])

  return (
    <ErsatzTVVideoControls
      isTheaterMode={isTheaterMode}
      isVisible={isVisible}
      isMobile={isMobile}
      channelId={channelId}
      onTheaterModeToggle={onTheaterModeToggle}
      onMouseEnter={() => setIsHoveringControls(true)}
      onMouseLeave={() => setIsHoveringControls(false)}
    />
  )
}

// Inner component that manages player state - remounts when streamUrl changes
function HLSVideoPlayerInner({
  streamUrl,
  title,
  channelId,
  isTheaterMode,
  isMobile = false,
  onTheaterModeToggle,
  onError,
  onReady,
}: HLSVideoPlayerProps) {
  const playerRef = useRef<MediaPlayerInstance>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isBuffering, setIsBuffering] = useState(true)

  const { status, retryCount, retryKey, handleError, handlePlaying } = useHLSRetry({
    streamUrl,
    onReady,
    onFinalError: onError,
  })

  // Auto-fullscreen on mobile landscape rotation
  useOrientationFullscreen({
    containerRef,
    enabled: true,
  })

  const onPlaying = useCallback(() => {
    setIsBuffering(false)
    handlePlaying()
  }, [handlePlaying])

  const handleWaiting = useCallback(() => {
    setIsBuffering(true)
  }, [])


  if (status === 'failed') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black">
        <div className="rounded-lg bg-destructive/20 p-6 text-center">
          <p className="text-xl font-semibold text-destructive-foreground">Stream unavailable</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Select another channel from the list
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full bg-black flex items-center justify-center"
    >
      <MediaPlayer
        key={retryKey}
        ref={playerRef}
        src={streamUrl}
        title={title}
        autoPlay
        playsInline
        className="h-full w-full max-h-full max-w-full [&_video]:object-contain"
        onWaiting={handleWaiting}
        onPlaying={onPlaying}
        onError={handleError}
        data-testid="media-player"
      >
        <MediaProvider />
        <PlayerControlsWrapper
          containerRef={containerRef}
          isTheaterMode={isTheaterMode}
          isMobile={isMobile}
          channelId={channelId}
          onTheaterModeToggle={onTheaterModeToggle}
        />
      </MediaPlayer>

      {/* Buffering/Retry overlay */}
      {(isBuffering || status === 'retrying') && (
        <ProjectorBeamLoader
          text={status === 'retrying' ? `Stream starting... (${retryCount + 1}/5)` : undefined}
        />
      )}
    </div>
  )
}

// Wrapper component that remounts the player when streamUrl changes
// This ensures clean state reset without useEffect setState
export function HLSVideoPlayer(props: HLSVideoPlayerProps) {
  return <HLSVideoPlayerInner key={props.streamUrl} {...props} />
}
