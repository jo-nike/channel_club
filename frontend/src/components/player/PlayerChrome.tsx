import { useCallback } from 'react'
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Expand, Shrink, RotateCw } from 'lucide-react'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useHighlightFeature } from '@/hooks/useHighlightFeature'
import { useHighlightStatus } from '@/hooks/useHighlightStatus'
import { useTVMode } from '@/hooks/useTVMode'
import { HighlightButton } from '@/components/HighlightButton'
import { CastButton } from '@/components/CastButton'
import { FilterMenu } from '@/components/FilterMenu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { unmutedVolume } from '@/stores/audioStore'
import { useClipStore } from '@/stores/clipStore'
import { usePlayerShell } from './PlayerShellContext'
import { usePlayerAudio } from './usePlayerAudio'
import type { PlayerMediaAdapter } from './mediaAdapters'

export interface PlayerChromeProps {
  /** The engine playing in the shell */
  adapter: PlayerMediaAdapter
  channelId?: string
  /** Stream URL for casting (optional - resolved by backend if not provided) */
  streamUrl?: string
  /** Channel name for Chromecast display and the clip editor */
  channelName?: string
  isMobile?: boolean
}

const CONTROL_BUTTON =
  'control-button flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-ring-media'

/**
 * The player's control bar, the same for every engine: playback through the
 * engine's adapter, volume and mute through the audio store, fullscreen,
 * theater and its auto-hide visibility through the player shell.
 */
export function PlayerChrome({
  adapter,
  channelId,
  streamUrl,
  channelName,
  isMobile: isMobileProp = false,
}: PlayerChromeProps) {
  const {
    containerRef,
    isFullscreen,
    toggleFullscreen,
    isTheaterMode,
    toggleTheaterMode,
    controlsVisible: isVisible,
    setHoveringControls,
    reload,
  } = usePlayerShell()
  const { volume, isStoreMuted, isMuted, canSetVolume, changeVolume, toggleMute } = usePlayerAudio(adapter)
  const isTVMode = useTVMode()

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
  const { status: highlightStatus, loaded: highlightLoaded } = useHighlightStatus(
    showHighlightButton ? channelId : undefined,
  )

  // The editor lives in the player shell, so it outlives this control bar
  const openClip = useClipStore((s) => s.open)
  const handleOpenHighlightModal = useCallback(() => {
    if (channelId) openClip(channelId, channelName ?? channelId)
  }, [channelId, channelName, openClip])

  const playLabel = adapter.isPlaying ? 'Pause' : 'Play'
  const muteLabel = isMuted ? unmuteLabel(volume, canSetVolume) : 'Mute'
  const theaterLabel = isTheaterMode ? 'Exit theater mode' : 'Theater mode'
  const fullscreenLabel = isFullscreen ? 'Exit fullscreen' : 'Fullscreen'
  const tabIndex = isVisible ? 0 : -1

  // A full-width strip on a gradient scrim rather than a boxed card: it
  // covers less of the picture (a broadcaster's score bug sits in the lower
  // corners), and the top of the scrim fades out instead of ending in an edge.
  // index.css keeps its padding clear of the notch and home indicator.
  return (
    <div
      role="toolbar"
      aria-label="Video controls"
      onMouseEnter={() => setHoveringControls(true)}
      onMouseLeave={() => setHoveringControls(false)}
      className={`video-controls absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 bg-gradient-to-t from-black/80 via-black/50 to-transparent px-3 pb-2 pt-8 sm:gap-4 transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
    >
      {/* Play/Pause Button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            tabIndex={tabIndex}
            onClick={adapter.togglePaused}
            aria-label={playLabel}
            className={CONTROL_BUTTON}
          >
            {adapter.isPlaying ? (
              <Pause className="h-6 w-6 text-white" />
            ) : (
              <Play className="h-6 w-6 text-white" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{playLabel}</p>
        </TooltipContent>
      </Tooltip>

      {/* Volume Controls */}
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              tabIndex={tabIndex}
              onClick={toggleMute}
              aria-label={muteLabel}
              className={CONTROL_BUTTON}
            >
              {isMuted ? (
                <VolumeX className="h-6 w-6 text-white" />
              ) : (
                <Volume2 className="h-6 w-6 text-white" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{muteLabel}</p>
          </TooltipContent>
        </Tooltip>
        {/* No slider where the browser ignores script volume (iOS/iPadOS); Mute
            still works. While muted it keeps the saved level, dimmed: the level
            unmuting brings back, not a 0 that looks like a lost setting. */}
        {canSetVolume && (
          <input
            type="range"
            tabIndex={tabIndex}
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(e) => changeVolume(parseFloat(e.target.value))}
            aria-label="Volume"
            className={`hidden h-2 w-24 cursor-pointer sm:block appearance-none rounded-full bg-white/30 accent-white ${
              isStoreMuted ? 'opacity-50' : ''
            }`}
          />
        )}
      </div>

      {/* Highlight capture */}
      {showHighlightButton && (
        <HighlightButton
          channelId={channelId}
          isVisible={isVisible}
          highlightStatus={highlightStatus}
          loaded={highlightLoaded}
          onOpenModal={handleOpenHighlightModal}
        />
      )}

      {/* Cast Button - for Chromecast streaming */}
      {channelId && (
        <CastButton
          channelId={channelId}
          streamType={adapter.streamType}
          streamUrl={streamUrl}
          channelName={channelName}
          isVisible={isVisible}
        />
      )}

      {/* Filter Menu, portalled into the shell so it shows in fullscreen */}
      <FilterMenu isVisible={isVisible} containerRef={containerRef} />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Reload: starts the stream again and keeps the shell, so it works in
          theater and fullscreen, where the page header is gone. Left out on
          the narrowest phones, where the bar has no room for it; the account
          menu and the failure card's Retry still reload there. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            tabIndex={tabIndex}
            onClick={reload}
            aria-label="Reload stream"
            className={`${CONTROL_BUTTON} max-[399px]:hidden`}
          >
            <RotateCw className="h-6 w-6 text-white" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Reload stream (R)</p>
        </TooltipContent>
      </Tooltip>

      {/* Theater Mode Button - hidden on touch/small screens and in fullscreen. TV browsers
          always get it: webOS pointer mode can report pointer:coarse. */}
      {(isTVMode || !isMobile) && !isFullscreen && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              tabIndex={tabIndex}
              onClick={toggleTheaterMode}
              aria-label={theaterLabel}
              className={CONTROL_BUTTON}
            >
              {isTheaterMode ? (
                <Shrink className="h-6 w-6 text-white" />
              ) : (
                <Expand className="h-6 w-6 text-white" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{theaterLabel}</p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Fullscreen Button, on every device including TVs */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            tabIndex={tabIndex}
            onClick={toggleFullscreen}
            aria-label={fullscreenLabel}
            className={CONTROL_BUTTON}
          >
            {isFullscreen ? (
              <Minimize className="h-6 w-6 text-white" />
            ) : (
              <Maximize className="h-6 w-6 text-white" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{fullscreenLabel}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

// Name the level unmuting brings back, as the Sound is off notice does, but
// only where the browser honours script volume (iOS/iPadOS ignore it)
function unmuteLabel(volume: number, canSetVolume: boolean): string {
  return canSetVolume ? `Unmute (${Math.round(unmutedVolume(volume) * 100)}%)` : 'Unmute'
}
