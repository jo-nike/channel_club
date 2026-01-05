import { useMediaState, useMediaRemote } from '@vidstack/react'
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Expand, Shrink } from 'lucide-react'
import { useMediaQuery } from '@/hooks/useMediaQuery'

export interface ErsatzTVVideoControlsProps {
  isTheaterMode: boolean
  isVisible: boolean
  isMobile?: boolean
  isTVMode?: boolean
  onTheaterModeToggle: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

export function ErsatzTVVideoControls({
  isTheaterMode,
  isVisible,
  isMobile: isMobileProp = false,
  isTVMode = false,
  onTheaterModeToggle,
  onMouseEnter,
  onMouseLeave,
}: ErsatzTVVideoControlsProps) {
  // Use local media query for reliable mobile/touch detection
  // Check for touch device (pointer: coarse) to hide theater button on all phones/tablets
  const isTouchDevice = useMediaQuery('(pointer: coarse)')
  const isMobileQuery = useMediaQuery('(max-width: 768px)')
  const isMobile = isMobileProp || isMobileQuery || isTouchDevice

  // Get media state from Vidstack context
  const paused = useMediaState('paused')
  const volume = useMediaState('volume')
  const muted = useMediaState('muted')
  const fullscreen = useMediaState('fullscreen')
  const remote = useMediaRemote()

  const isPlaying = !paused

  const handlePlayPause = () => {
    remote.togglePaused()
  }

  const handleVolumeChange = (newVolume: number) => {
    remote.changeVolume(newVolume)
  }

  const handleMuteToggle = () => {
    remote.toggleMuted()
  }

  const handleFullscreenToggle = () => {
    remote.toggleFullscreen()
  }

  return (
    <div
      role="toolbar"
      aria-label="Video controls"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`video-controls absolute left-4 right-4 z-10 flex items-center gap-4 rounded-lg bg-black/70 p-4 transition-opacity duration-300 ${
        isTheaterMode ? 'bottom-24' : 'bottom-12'
      } ${isVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
    >
      {/* Play/Pause Button */}
      <button
        type="button"
        tabIndex={isVisible ? 0 : -1}
        onClick={handlePlayPause}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        className="control-button flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/80"
      >
        {isPlaying ? (
          <Pause className="h-6 w-6 text-white" />
        ) : (
          <Play className="h-6 w-6 text-white" />
        )}
      </button>

      {/* Volume Controls */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          tabIndex={isVisible ? 0 : -1}
          onClick={handleMuteToggle}
          aria-label={muted ? 'Unmute' : 'Mute'}
          className="control-button flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/80"
        >
          {muted ? (
            <VolumeX className="h-6 w-6 text-white" />
          ) : (
            <Volume2 className="h-6 w-6 text-white" />
          )}
        </button>
        <input
          type="range"
          tabIndex={isVisible ? 0 : -1}
          min="0"
          max="1"
          step="0.05"
          value={muted ? 0 : volume}
          onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
          aria-label="Volume"
          className="h-2 w-24 cursor-pointer appearance-none rounded-full bg-white/30 accent-white"
        />
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Fullscreen Button - hidden on TV (TV has native fullscreen) */}
      {!isTVMode && (
        <button
          type="button"
          tabIndex={isVisible ? 0 : -1}
          onClick={handleFullscreenToggle}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Toggle fullscreen'}
          className="control-button flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/80"
        >
          {fullscreen ? (
            <Minimize className="h-6 w-6 text-white" />
          ) : (
            <Maximize className="h-6 w-6 text-white" />
          )}
        </button>
      )}

      {/* Theater Mode Button - hidden on mobile and TV */}
      {!isMobile && !isTVMode && (
        <button
          type="button"
          tabIndex={isVisible ? 0 : -1}
          onClick={onTheaterModeToggle}
          aria-label={isTheaterMode ? 'Exit theater mode' : 'Theater mode'}
          className="control-button flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/80"
        >
          {isTheaterMode ? (
            <Shrink className="h-6 w-6 text-white" />
          ) : (
            <Expand className="h-6 w-6 text-white" />
          )}
        </button>
      )}
    </div>
  )
}
