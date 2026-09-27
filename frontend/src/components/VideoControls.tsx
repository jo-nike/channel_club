import { useState, useCallback, useEffect, type RefObject } from 'react'
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Expand, Shrink } from 'lucide-react'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useHighlightFeature } from '@/hooks/useHighlightFeature'
import { useHighlightStatus } from '@/hooks/useHighlightStatus'
import { HighlightButton } from './HighlightButton'
import { HighlightModal } from './HighlightModal'
import { CastButton } from './CastButton'
import { FilterMenu } from './FilterMenu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAudioStore } from '@/stores/audioStore'

export interface VideoControlsProps {
  videoRef: RefObject<HTMLVideoElement | null>
  /** Container ref for portal rendering (needed for fullscreen popover support) */
  containerRef?: RefObject<HTMLElement | null>
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
  containerRef,
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

  // Show highlight capture on pointer/touch players when feature is enabled
  const showHighlightButton = highlightEnabled && !isTVMode && channelId

  // Always-on highlight status polling (independent of control visibility)
  const highlightStatus = useHighlightStatus(showHighlightButton ? channelId : undefined)

  const [capture, setCapture] = useState<{ channel: string; container: HTMLElement | null } | null>(null)
  useEffect(() => () => setCapture(null), [channelId])
  const handleOpenHighlightModal = useCallback(() => {
    if (channelId) setCapture({ channel: channelId, container: containerRef?.current ?? null })
  }, [channelId, containerRef])
  const handleCloseHighlightModal = useCallback(() => setCapture(null), [])
  const acquirePreviewAudio = useCallback(() => {
    const player = videoRef.current
    if (!player) return () => {}
    player.muted = true
    // Restore the viewer's saved choice, which may have changed during the preview
    return () => { player.muted = useAudioStore.getState().muted }
  }, [videoRef])

  return (
    <div
      role="toolbar"
      aria-label="Video controls"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`video-controls absolute bottom-4 left-4 right-4 z-10 flex items-center gap-2 rounded-lg bg-black/70 p-2 sm:gap-4 sm:p-4 transition-opacity duration-300 ${
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
          className="hidden h-2 w-24 cursor-pointer sm:block appearance-none rounded-full bg-white/30 accent-white"
        />
      </div>

      {/* Highlight capture */}
      {showHighlightButton && (
        <>
          <HighlightButton
            channelId={channelId}
            isVisible={isVisible}
            highlightStatus={highlightStatus}
            onOpenModal={handleOpenHighlightModal}
          />
          <HighlightModal
            isOpen={capture?.channel === channelId}
            onClose={handleCloseHighlightModal}
            channelId={channelId}
            acquirePreviewAudio={acquirePreviewAudio}
            container={capture?.container}
          />
        </>
      )}

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

      {/* Filter Menu */}
      <FilterMenu isVisible={isVisible} containerRef={containerRef} />

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
