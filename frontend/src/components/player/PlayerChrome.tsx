import { useCallback } from 'react'
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Expand, Shrink, RotateCw, MessageCircle } from 'lucide-react'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useMobileLandscape } from '@/hooks/useMobileLandscape'
import { useChatEnabled } from '@/hooks/useChatEnabled'
import { useHighlightFeature } from '@/hooks/useHighlightFeature'
import { useHighlightStatus } from '@/hooks/useHighlightStatus'
import { useTVMode } from '@/hooks/useTVMode'
import { HighlightButton } from '@/components/HighlightButton'
import { CastButton } from '@/components/CastButton'
import { FilterMenu } from '@/components/FilterMenu'
import { UnreadBadge } from '@/components/UnreadBadge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { withKey } from '@/lib/keyHints'
import { unmutedVolume } from '@/stores/audioStore'
import { useClipStore } from '@/stores/clipStore'
import { useChatStore } from '@/stores/chatStore'
import { ChannelRocker } from './ChannelRocker'
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
// The phone-landscape bar: 44px targets, the smallest a finger reliably hits
const COMPACT_CONTROL_BUTTON =
  'control-button flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-ring-media'
// The narrowest bar the channel rocker fits in, by how many of Theater, Chat
// and Clip that are on it besides the rest (see rockerFitClass)
const ROCKER_FIT_CLASSES = [
  '@max-[44rem]:hidden',
  '@max-[48rem]:hidden',
  '@max-[52rem]:hidden',
  '@max-[56rem]:hidden',
] as const

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
    stepChannel,
    reload,
    clipThat,
  } = usePlayerShell()
  const { volume, isStoreMuted, isMuted, canSetVolume, changeVolume, toggleMute } = usePlayerAudio(adapter)
  const isTVMode = useTVMode()

  // Use local media query for reliable mobile/touch detection
  const isTouchDevice = useMediaQuery('(pointer: coarse)')
  const isMobileQuery = useMediaQuery('(max-width: 768px)')
  const isMobile = isMobileProp || isMobileQuery || isTouchDevice
  const isMobileLandscape = useMobileLandscape()

  // Theater is left out only on phones: upright they have the stacked layout,
  // and sideways the player already fills the screen. A touch tablet gets it,
  // since a tap brings the bar and its Exit theater button back. Once theater
  // is on the button stays, whatever the layout: an iPad turned upright in
  // theater becomes a 'phone', and this button is its only way out. Never
  // on a TV, whose couch layout always fills the screen.
  const isPhone = isMobileProp || isMobileQuery || isMobileLandscape
  const showTheaterButton = !isTVMode && (!isPhone || isTheaterMode) && !isFullscreen

  // Chat, where the page header and its chat button are gone: theater, a
  // phone held sideways, and fullscreen. In fullscreen only where isMobile is
  // false (a fine pointer and a window wider than 768px): isMobile is also
  // true for any coarse pointer, tablets included, and there the button is
  // left out. Not on a TV until couch mode gives chat a remote-friendly home.
  const chatEnabled = useChatEnabled()
  // Sideways, a 390px-tall picture can't spare a 48px bar with room around
  // it: the bar tightens to 44px targets and a thin scrim
  const isCompact = isMobileLandscape
  const buttonClass = isCompact ? COMPACT_CONTROL_BUTTON : CONTROL_BUTTON
  const isChatOpen = useChatStore((s) => s.isOpen)
  const unreadCount = useChatStore((s) => s.unreadCount)
  const toggleChat = useChatStore((s) => s.toggleOpen)
  const showChatButton =
    chatEnabled && !isTVMode && (isTheaterMode || isMobileLandscape || (isFullscreen && !isMobile))

  // The bar is already full at 640-768px: the channel rocker comes in at
  // 1024px, or in theater and fullscreen, where the sidebar and guide are gone.
  // Never below 768px, even there: the bar doesn't wrap or shrink, so on a
  // phone the rocker would push Exit fullscreen off the screen.
  const isWide = useMediaQuery('(min-width: 1024px)')
  const hasRoomForRocker = useMediaQuery('(min-width: 768px)')
  const showChannelRocker = stepChannel && (isWide || (hasRoomForRocker && (isTheaterMode || isFullscreen)))
  // The viewport isn't the bar, though: on a desktop the player sits beside
  // the sidebar and the docked chat, so at 1024px with chat open it is only
  // 640px wide. The bar is a size container, and the rocker also stays out
  // while the bar is narrower than every control plus the rocker needs. With
  // Cast and clip on that is about 742px inside the padding, or 678px without
  // the Theater button (measured in Chrome); the thresholds leave some slack
  // for the CH label's fallback fonts. The Chat button takes another 64px
  // (48px and the gap), so with it each threshold moves up by 4rem, and so
  // does Clip that beside the clip control (rockerFitClass, below).

  // Check if highlight feature is enabled (server-side feature flag)
  const { isEnabled: highlightEnabled } = useHighlightFeature()

  // Show highlight capture on pointer/touch players when feature is enabled
  const showHighlightButton = highlightEnabled && !isTVMode && channelId
  const showClipThat = Boolean(showHighlightButton && clipThat)
  const rockerFitClass = ROCKER_FIT_CLASSES[
    (showTheaterButton ? 1 : 0) + (showChatButton ? 1 : 0) + (showClipThat ? 1 : 0)
  ]

  // Always-on highlight status polling (independent of control visibility)
  const { status: highlightStatus, loaded: highlightLoaded } = useHighlightStatus(
    showHighlightButton ? channelId : undefined,
  )

  // The editor lives in the player shell, so it outlives this control bar
  const openClip = useClipStore((s) => s.open)
  const isClipping = useClipStore((s) => s.clipping)
  const isEditingClip = useClipStore((s) => s.session !== null)
  const handleOpenHighlightModal = useCallback(() => {
    if (channelId) openClip(channelId, channelName ?? channelId)
  }, [channelId, channelName, openClip])

  // In fullscreen the page portals the panel into the shell on a fine
  // pointer, so it opens there and fullscreen stays. A touch screen keeps
  // chat outside fullscreen (see TVView's chatHost), where it would open
  // hidden behind it: there opening chat leaves fullscreen first.
  const handleChatToggle = useCallback(() => {
    if (isFullscreen && isTouchDevice && !isChatOpen) toggleFullscreen()
    toggleChat()
  }, [isFullscreen, isTouchDevice, isChatOpen, toggleFullscreen, toggleChat])

  const playLabel = adapter.isPlaying ? 'Pause' : 'Play'
  const muteLabel = isMuted ? unmuteLabel(volume, canSetVolume) : 'Mute'
  const theaterLabel = isTheaterMode ? 'Exit theater mode' : 'Theater mode'
  const fullscreenLabel = isFullscreen ? 'Exit fullscreen' : 'Fullscreen'
  // Named like the header's chat button: a disclosure (aria-expanded) whose
  // name stays 'Chat' open or closed, so it reads "Chat, expanded"
  const chatLabel = unreadCount > 0 ? `Chat, ${unreadCount} new` : 'Chat'
  const tabIndex = isVisible ? 0 : -1

  // A full-width strip on a gradient scrim rather than a boxed card: it
  // covers less of the picture (a broadcaster's score bug sits in the lower
  // corners), and the top of the scrim fades out instead of ending in an edge.
  // index.css keeps its padding clear of the notch and home indicator. The
  // compact bar also brings the Cast and filter buttons, drawn elsewhere, down
  // to 44px.
  const layoutClass = isCompact
    ? 'gap-2 p-1.5 [&_.control-button]:min-h-[44px] [&_.control-button]:min-w-[44px]'
    : 'gap-2 px-3 pb-2 pt-8 sm:gap-4'
  return (
    <div
      role="toolbar"
      aria-label="Video controls"
      onMouseEnter={() => setHoveringControls(true)}
      onMouseLeave={() => setHoveringControls(false)}
      className={`video-controls @container absolute inset-x-0 bottom-0 z-10 flex items-center bg-gradient-to-t from-black/80 via-black/50 to-transparent ${layoutClass} transition-opacity duration-300 ${
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
            aria-keyshortcuts="Space"
            className={buttonClass}
          >
            {adapter.isPlaying ? (
              <Pause className="h-6 w-6 text-white" />
            ) : (
              <Play className="h-6 w-6 text-white" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{withKey(playLabel, 'Space')}</p>
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
              aria-keyshortcuts="M"
              className={buttonClass}
            >
              {isMuted ? (
                <VolumeX className="h-6 w-6 text-white" />
              ) : (
                <Volume2 className="h-6 w-6 text-white" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{withKey(muteLabel, 'M')}</p>
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
            className={`hidden h-2 w-24 cursor-pointer sm:block appearance-none rounded-full bg-white/30 accent-white focus-ring-media ${
              isStoreMuted ? 'opacity-50' : ''
            }`}
          />
        )}
      </div>

      {/* Channel down/up, through the page's zap like PageDown/PageUp */}
      {showChannelRocker && (
        <ChannelRocker
          onStep={stepChannel}
          tabIndex={tabIndex}
          buttonClassName={buttonClass}
          className={rockerFitClass}
        />
      )}

      {/* Highlight capture */}
      {showHighlightButton && (
        <HighlightButton
          isVisible={isVisible}
          highlightStatus={highlightStatus}
          loaded={highlightLoaded}
          onOpenModal={handleOpenHighlightModal}
          compact={isCompact}
          onClipThat={showClipThat ? clipThat : undefined}
          clipping={isClipping}
          editing={isEditingClip}
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

      {/* Chat, with the unread count the hidden header would show */}
      {showChatButton && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              tabIndex={tabIndex}
              onClick={handleChatToggle}
              aria-label={chatLabel}
              aria-expanded={isChatOpen}
              aria-controls="chat-panel"
              aria-keyshortcuts="C"
              className={`${buttonClass} relative`}
            >
              <MessageCircle className="h-6 w-6 text-white" />
              <UnreadBadge count={unreadCount} className="absolute top-1 right-1" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{withKey(chatLabel, 'C')}</p>
          </TooltipContent>
        </Tooltip>
      )}

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
            aria-keyshortcuts="R"
            className={`${buttonClass} max-[399px]:hidden`}
          >
            <RotateCw className="h-6 w-6 text-white" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{withKey('Reload stream', 'R')}</p>
        </TooltipContent>
      </Tooltip>

      {/* Theater Mode Button - hidden on phones, on TVs and in fullscreen
          (see showTheaterButton) */}
      {showTheaterButton && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              tabIndex={tabIndex}
              onClick={toggleTheaterMode}
              aria-label={theaterLabel}
              aria-keyshortcuts="T"
              className={buttonClass}
            >
              {isTheaterMode ? (
                <Shrink className="h-6 w-6 text-white" />
              ) : (
                <Expand className="h-6 w-6 text-white" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{withKey(theaterLabel, 'T')}</p>
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
            aria-keyshortcuts="F"
            className={buttonClass}
          >
            {isFullscreen ? (
              <Minimize className="h-6 w-6 text-white" />
            ) : (
              <Maximize className="h-6 w-6 text-white" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{withKey(fullscreenLabel, 'F')}</p>
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
