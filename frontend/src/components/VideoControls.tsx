import type { RefObject } from 'react'
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Expand, Shrink } from 'lucide-react'

export interface VideoControlsProps {
  videoRef: RefObject<HTMLVideoElement | null>
  isPlaying: boolean
  volume: number
  isMuted: boolean
  isTheaterMode: boolean
  isFullscreen: boolean
  isVisible: boolean
  isMobile?: boolean
  onPlayPause: () => void
  onVolumeChange: (volume: number) => void
  onMuteToggle: () => void
  onFullscreenToggle: () => void
  onTheaterModeToggle: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

export function VideoControls({
  isPlaying,
  volume,
  isMuted,
  isTheaterMode,
  isFullscreen,
  isVisible,
  isMobile = false,
  onPlayPause,
  onVolumeChange,
  onMuteToggle,
  onFullscreenToggle,
  onTheaterModeToggle,
  onMouseEnter,
  onMouseLeave,
}: VideoControlsProps) {
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
        onClick={onPlayPause}
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
          onClick={onMuteToggle}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
          className="control-button flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/80"
        >
          {isMuted ? (
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
          value={isMuted ? 0 : volume}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
          aria-label="Volume"
          className="h-2 w-24 cursor-pointer appearance-none rounded-full bg-white/30 accent-white"
        />
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Fullscreen Button */}
      <button
        type="button"
        tabIndex={isVisible ? 0 : -1}
        onClick={onFullscreenToggle}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Toggle fullscreen'}
        className="control-button flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/80"
      >
        {isFullscreen ? (
          <Minimize className="h-6 w-6 text-white" />
        ) : (
          <Maximize className="h-6 w-6 text-white" />
        )}
      </button>

      {/* Theater Mode Button - hidden on mobile */}
      {!isMobile && (
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
