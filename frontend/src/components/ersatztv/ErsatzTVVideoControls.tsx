import { useState, useCallback, useEffect, type RefObject } from 'react'
import { useMediaState, useMediaRemote } from '@vidstack/react'
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Expand, Shrink } from 'lucide-react'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useHighlightFeature } from '@/hooks/useHighlightFeature'
import { useHighlightStatus } from '@/hooks/useHighlightStatus'
import { useCanSetVolume } from '@/hooks/useCanSetVolume'
import { useFullscreenState } from '@/hooks/useFullscreenState'
import { HighlightButton } from '@/components/HighlightButton'
import { HighlightModal } from '@/components/HighlightModal'
import { CastButton } from '@/components/CastButton'
import { FilterMenu } from '@/components/FilterMenu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAudioStore } from '@/stores/audioStore'

export interface ErsatzTVVideoControlsProps {
  /** Container ref for portal rendering (needed for fullscreen popover support) */
  containerRef?: RefObject<HTMLElement | null>
  isTheaterMode: boolean
  isVisible: boolean
  isMobile?: boolean
  isTVMode?: boolean
  channelId?: string
  /** Stream URL for casting (HLS URL from ErsatzTV) */
  streamUrl?: string
  /** Channel name for Chromecast display */
  channelName?: string
  onTheaterModeToggle: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

export function ErsatzTVVideoControls({
  containerRef,
  isTheaterMode,
  isVisible,
  isMobile: isMobileProp = false,
  isTVMode = false,
  channelId,
  streamUrl,
  channelName,
  onTheaterModeToggle,
  onMouseEnter,
  onMouseLeave,
}: ErsatzTVVideoControlsProps) {
  // Use local media query for reliable mobile/touch detection
  // Check for touch device (pointer: coarse) to hide theater button on all phones/tablets
  const isTouchDevice = useMediaQuery('(pointer: coarse)')
  const isMobileQuery = useMediaQuery('(max-width: 768px)')
  const isMobile = isMobileProp || isMobileQuery || isTouchDevice
  const canSetVolume = useCanSetVolume()

  // Check if highlight feature is enabled (server-side feature flag)
  const { isEnabled: highlightEnabled } = useHighlightFeature()

  // Show highlight capture on pointer/touch players when feature is enabled
  const showHighlightButton = highlightEnabled && !isTVMode && channelId

  // Always-on highlight status polling (independent of control visibility)
  const highlightStatus = useHighlightStatus(showHighlightButton ? channelId : undefined)

  // Get media state from Vidstack context
  const paused = useMediaState('paused')
  const isElementMuted = useMediaState('muted')
  const isPlayerFullscreen = useMediaState('fullscreen')
  const remote = useMediaRemote()

  // The fullscreen button fullscreens the container, which Vidstack's state
  // never reports (it tracks only its own MediaPlayer element). Its state is
  // only right for the no-container fallback that fullscreens MediaPlayer.
  const isContainerFullscreen = useFullscreenState(containerRef)
  const fullscreen = containerRef ? isContainerFullscreen : isPlayerFullscreen

  const isPlaying = !paused

  // Volume and mute come from the audio store, never Vidstack's state, which
  // reads 100% until the stream can play. MediaPlayer follows the store.
  const volume = useAudioStore((s) => s.volume)
  const isStoreMuted = useAudioStore((s) => s.muted)
  const setStoredVolume = useAudioStore((s) => s.setVolume)
  const setStoredMuted = useAudioStore((s) => s.setMuted)
  // The element can also be muted without the viewer asking (clip preview duck)
  const muted = isStoreMuted || isElementMuted

  const handlePlayPause = () => {
    remote.togglePaused()
  }

  const handleVolumeChange = (newVolume: number) => {
    // A level the browser ignores would only save a meaningless value
    if (!canSetVolume) return
    setStoredVolume(newVolume)
    // Choosing an audible level also clears a mute that only the element had
    if (!useAudioStore.getState().muted) remote.unmute()
  }

  const handleMuteToggle = () => {
    const next = !muted
    setStoredMuted(next)
    // An element-only mute leaves the muted prop unchanged, so ask Vidstack too
    if (!next) remote.unmute()
  }

  const handleFullscreenToggle = useCallback(() => {
    // Use container ref for fullscreen to ensure portals render correctly
    // (Vidstack's remote.toggleFullscreen() fullscreens the MediaPlayer element,
    // which breaks portal rendering for FilterMenu)
    const container = containerRef?.current
    if (container) {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {})
      } else {
        container.requestFullscreen().catch(() => {})
      }
    } else {
      // Fallback to Vidstack's fullscreen if no container ref
      remote.toggleFullscreen()
    }
  }, [containerRef, remote])

  const [capture, setCapture] = useState<{ channel: string; container: HTMLElement | null } | null>(null)
  useEffect(() => () => setCapture(null), [channelId])
  const handleOpenHighlightModal = useCallback(() => {
    if (channelId) setCapture({ channel: channelId, container: containerRef?.current ?? null })
  }, [channelId, containerRef])
  const handleCloseHighlightModal = useCallback(() => setCapture(null), [])
  const acquirePreviewAudio = useCallback(() => {
    remote.mute()
    // Restore the viewer's saved choice, which may have changed during the preview
    return () => { if (!useAudioStore.getState().muted) remote.unmute() }
  }, [remote])

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
          </TooltipTrigger>
          <TooltipContent>
            <p>{muted ? 'Unmute' : 'Mute'}</p>
          </TooltipContent>
        </Tooltip>
        {/* No slider where the browser ignores script volume (iOS/iPadOS); Mute still works */}
        {canSetVolume && (
          <input
            type="range"
            tabIndex={isVisible ? 0 : -1}
            min="0"
            max="1"
            step="0.05"
            value={isStoreMuted ? 0 : volume}
            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
            aria-label="Volume"
            className="hidden h-2 w-24 cursor-pointer sm:block appearance-none rounded-full bg-white/30 accent-white"
          />
        )}
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

      {/* Cast Button - for Chromecast streaming (HLS direct, no transcoding needed) */}
      {channelId && (
        <CastButton
          channelId={channelId}
          streamType="hls"
          streamUrl={streamUrl}
          channelName={channelName}
          isVisible={isVisible}
        />
      )}

      {/* Filter Menu */}
      <FilterMenu isVisible={isVisible} containerRef={containerRef} />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Theater Mode Button - hidden on touch/small screens and in fullscreen. TV browsers
          always get it: webOS pointer mode can report pointer:coarse. */}
      {(isTVMode || !isMobile) && !fullscreen && (
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

      {/* Fullscreen Button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            tabIndex={isVisible ? 0 : -1}
            onClick={handleFullscreenToggle}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            className="control-button flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/80"
          >
            {fullscreen ? (
              <Minimize className="h-6 w-6 text-white" />
            ) : (
              <Maximize className="h-6 w-6 text-white" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
