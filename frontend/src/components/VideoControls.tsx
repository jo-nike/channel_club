import { useState, useCallback, type RefObject } from 'react'
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Expand, Shrink } from 'lucide-react'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useHighlightFeature } from '@/hooks/useHighlightFeature'
import { useHighlightStatus } from '@/hooks/useHighlightStatus'
import { HighlightButton } from './HighlightButton'
import { HighlightModal } from './HighlightModal'
import { ChatToggleButton } from './ChatToggleButton'
import { CastButton } from './CastButton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export interface VideoControlsProps {
  videoRef: RefObject<HTMLVideoElement | null>
  isPlaying: boolean
  volume: number
  isMuted: boolean
  isTheaterMode: boolean
  isFullscreen: boolean
  isVisible: boolean
  isMobile?: boolean
  isTVMode?: boolean
  channelId?: string
  /** Stream URL for casting (optional - resolved by backend if not provided) */
  streamUrl?: string
  /** Channel name for Chromecast display */
  channelName?: string
  onPlayPause: () => void
  onVolumeChange: (volume: number) => void
  onMuteToggle: () => void
  onFullscreenToggle: () => void
  onTheaterModeToggle: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

export function VideoControls({
  videoRef,
  isPlaying,
  volume,
  isMuted,
  isTheaterMode,
  isFullscreen,
  isVisible,
  isMobile: isMobileProp = false,
  isTVMode = false,
  channelId,
  streamUrl,
  channelName,
  onPlayPause,
  onVolumeChange,
  onMuteToggle,
  onFullscreenToggle,
  onTheaterModeToggle,
  onMouseEnter,
  onMouseLeave,
}: VideoControlsProps) {
  // Use local media query for reliable mobile/touch detection
  // Check for touch device (pointer: coarse) to hide theater button on all phones/tablets
  const isTouchDevice = useMediaQuery('(pointer: coarse)')
  const isMobileQuery = useMediaQuery('(max-width: 768px)')
  const isMobile = isMobileProp || isMobileQuery || isTouchDevice

  // Check if highlight feature is enabled (server-side feature flag)
  const { isEnabled: highlightEnabled } = useHighlightFeature()

  // Show highlight button on desktop only when feature is enabled
  const showHighlightButton = highlightEnabled && !isMobile && !isTVMode && channelId

  // Always-on highlight status polling (independent of control visibility)
  const highlightStatus = useHighlightStatus(showHighlightButton ? channelId : undefined)

  // Highlight modal state
  const [isHighlightModalOpen, setIsHighlightModalOpen] = useState(false)
  const [previousVolume, setPreviousVolume] = useState(volume)

  const handleOpenHighlightModal = useCallback(() => {
    // Store current volume before ducking
    setPreviousVolume(volume)
    setIsHighlightModalOpen(true)
  }, [volume])

  const handleCloseHighlightModal = useCallback(() => {
    setIsHighlightModalOpen(false)
  }, [])

  const handleHighlightVolumeChange = useCallback(
    (newVolume: number) => {
      if (videoRef.current) {
        videoRef.current.volume = newVolume
      }
      onVolumeChange(newVolume)
    },
    [videoRef, onVolumeChange]
  )

  return (
    <div
      role="toolbar"
      aria-label="Video controls"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`video-controls absolute bottom-4 left-4 right-4 z-10 flex items-center gap-4 rounded-lg bg-black/70 p-4 transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
    >
      {/* Play/Pause Button */}
      <Tooltip>
        <TooltipTrigger asChild>
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
        </TooltipTrigger>
        <TooltipContent>
          <p>{isPlaying ? 'Pause' : 'Play'}</p>
        </TooltipContent>
      </Tooltip>

      {/* Volume Controls */}
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
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
          </TooltipTrigger>
          <TooltipContent>
            <p>{isMuted ? 'Unmute' : 'Mute'}</p>
          </TooltipContent>
        </Tooltip>
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

      {/* Highlight Button - desktop only when feature enabled */}
      {showHighlightButton && (
        <>
          <HighlightButton
            channelId={channelId}
            isVisible={isVisible}
            highlightStatus={highlightStatus}
            onOpenModal={handleOpenHighlightModal}
          />
          <HighlightModal
            isOpen={isHighlightModalOpen}
            onClose={handleCloseHighlightModal}
            channelId={channelId}
            onVolumeChange={handleHighlightVolumeChange}
            previousVolume={previousVolume}
          />
        </>
      )}

      {/* Chat Toggle Button */}
      <ChatToggleButton isVisible={isVisible} />

      {/* Cast Button - for Chromecast streaming */}
      {channelId && (
        <CastButton
          channelId={channelId}
          streamType="mpegts"
          streamUrl={streamUrl}
          channelName={channelName}
          isVisible={isVisible}
        />
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Theater Mode Button - hidden on mobile, TV, and fullscreen */}
      {!isMobile && !isTVMode && !isFullscreen && (
        <Tooltip>
          <TooltipTrigger asChild>
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
          </TooltipTrigger>
          <TooltipContent>
            <p>{isTheaterMode ? 'Exit theater mode' : 'Theater mode'}</p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Fullscreen Button - hidden on TV (TV has native fullscreen) */}
      {!isTVMode && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              tabIndex={isVisible ? 0 : -1}
              onClick={onFullscreenToggle}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              className="control-button flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/80"
            >
              {isFullscreen ? (
                <Minimize className="h-6 w-6 text-white" />
              ) : (
                <Maximize className="h-6 w-6 text-white" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
