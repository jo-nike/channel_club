import { useEffect, useState } from 'react'
import { ChannelLogo } from '@/components/ChannelLogo'
import { NHLScoresOverlay } from '@/components/NHLScoresOverlay'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useNowPlaying } from '@/hooks/useNowPlaying'
import { useTVMode } from '@/hooks/useTVMode'
import { withKey } from '@/lib/keyHints'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { useChannelStore, type LiveChannelChange } from '@/stores/channelStore'
import { describeLiveGuide, useTVStore } from '@/stores/tvStore'
import { useUIStore } from '@/stores/uiStore'
import type { UnifiedChannel } from '@/types'
import { usePlayerShell } from './PlayerShellContext'

/** How long the rail stays up after a tune */
const TUNE_BANNER_MS = 4000
/** How long a change to the shared live channel is announced */
const LIVE_CHANGE_BANNER_MS = 5000

const RAIL_CLASS = cn(
  'pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 bg-linear-to-b from-black/80 via-black/40 to-transparent pb-6 text-white transition-opacity duration-300',
  // Clear of the notch and status bar in landscape, theater and
  // fullscreen; the shell sets the top inset only when it is at the top
  'pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[calc(0.75rem+var(--player-inset-top,0px))]'
)
const RAIL_NUMBER_CLASS = 'font-display text-4xl font-black leading-none tabular-nums'

interface PlayerInfoOverlayProps {
  /** The channel the player is on; null before the TV store has one */
  channel: UnifiedChannel | null
  /** A channel stepped to, or typed, with the channel keys but not tuned yet */
  pending?: UnifiedChannel | null
  /** The digits of a channel number being typed */
  entry?: string | null
  /** A number just typed that no channel has */
  missing?: string | null
}

/**
 * The top of the player: an info rail saying which channel this is, what's
 * on and whether it's the club's shared live channel, with the NHL ticker
 * under it. Rendered in the player shell, so it shows in theater and
 * fullscreen (where the page header is gone) and survives engine swaps.
 *
 * The rail shows and hides with the control bar, and for 4s after every tune,
 * like a cable box's channel banner. When someone changes the shared live
 * channel under a viewer on channel 0, the rail says so for 5s and names who
 * did it (those viewers get this instead of the toast). It is the one top
 * rail: the ticker and the engine's sound-off pill move down while the rail is
 * up, so they never overlap it. TV theater has its own channel banner
 * (ZapBanner) in that corner, so the rail stays out of it there.
 *
 * While the viewer steps through channels, the rail shows the channel they
 * are heading for at once; the tune itself waits until they stop pressing.
 * A typed number shows the channel it matches, just the digits while it
 * matches none, and 'No channel 99' when it is entered and no channel has it.
 */
export function PlayerInfoOverlay({ channel, pending = null, entry = null, missing = null }: PlayerInfoOverlayProps) {
  const { controlsVisible, isTheaterMode, setInfoRailVisible } = usePlayerShell()
  const isTVMode = useTVMode()
  const isNHLOverlayVisible = useUIStore((s) => s.isNHLOverlayVisible)

  // Each tune shows the rail for 4s: a new channel id, not a reload or a
  // stream retry, which keep the id. (Adjusted while rendering, React's
  // pattern for state that follows a prop.)
  const channelId = channel?.id ?? null
  const [tunedId, setTunedId] = useState(channelId)
  const [isTuneBanner, setTuneBanner] = useState(channelId !== null)
  if (channelId !== tunedId) {
    setTunedId(channelId)
    setTuneBanner(channelId !== null)
  }

  // Keyed on the channel too, so a tune during the banner gets its full 4s
  useEffect(() => {
    if (!isTuneBanner) return
    const timer = setTimeout(() => setTuneBanner(false), TUNE_BANNER_MS)
    return () => clearTimeout(timer)
  }, [isTuneBanner, tunedId])

  // A change to the shared live channel while this viewer is on it. Only
  // changes that arrive while on channel 0 count, not the last one before;
  // your own change and live TV stopping (the player says so) aren't announced.
  const isLive = channel?.type === 'live'
  const [liveChange, setLiveChange] = useState<LiveChannelChange | null>(null)
  useEffect(() => {
    if (!isLive) return
    const unsubscribe = useChannelStore.subscribe((state, prev) => {
      const change = state.lastChange
      if (change === prev.lastChange) return
      const isOwn = change?.by != null && change.by === useAuthStore.getState().username
      setLiveChange(change?.channelName && !isOwn ? change : null)
    })
    return () => {
      unsubscribe()
      setLiveChange(null)
    }
  }, [isLive])

  // Keyed on the change, so a second change restarts the 5s
  useEffect(() => {
    if (!liveChange) return
    const timer = setTimeout(() => setLiveChange(null), LIVE_CHANGE_BANNER_MS)
    return () => clearTimeout(timer)
  }, [liveChange])

  const railChannel = pending ?? channel
  // Digits with no channel to show for them
  const railNumber = missing ?? (entry !== null && pending === null ? entry : null)
  const isPreview = pending !== null || railNumber !== null
  const hasRail = (railNumber !== null || railChannel !== null) && !(isTVMode && isTheaterMode)
  const isRailVisible = hasRail && (controlsVisible || isTuneBanner || liveChange !== null || isPreview)

  // The engine's sound-off pill moves under the rail while it is up
  useEffect(() => {
    setInfoRailVisible(isRailVisible)
  }, [isRailVisible, setInfoRailVisible])
  useEffect(() => () => setInfoRailVisible(false), [setInfoRailVisible])

  return (
    <>
      {/* A live change is about the channel playing, not one being previewed */}
      {hasRail && railNumber !== null ? (
        <NumberRail number={railNumber} isMissing={missing !== null} />
      ) : (
        hasRail && railChannel && (
          <InfoRail
            channel={railChannel}
            isVisible={isRailVisible}
            liveChange={pending ? null : liveChange}
          />
        )
      )}
      <NHLScoresOverlay isVisible={isNHLOverlayVisible} belowRail={isRailVisible} />
    </>
  )
}

interface InfoRailProps {
  channel: UnifiedChannel
  isVisible: boolean
  /** A live-channel change to announce, while on channel 0 */
  liveChange: LiveChannelChange | null
}

function InfoRail({ channel, isVisible, liveChange }: InfoRailProps) {
  const { setHoveringControls } = usePlayerShell()
  const { title, timeLeft, isLive, hasLiveChannel } = useNowPlaying(channel)
  // The live slot's logo is the live channel's, which the slot doesn't carry
  const liveChannel = useChannelStore((s) => s.currentChannel)
  const liveEPGStatus = useTVStore((s) => s.liveEPGStatus)
  const isNHLOverlayVisible = useUIStore((s) => s.isNHLOverlayVisible)
  const toggleNHLOverlay = useUIStore((s) => s.toggleNHLOverlay)

  const isClubChannel = isLive && hasLiveChannel
  const logoChannel = isLive ? liveChannel : channel
  // The live slot often has no guide data: say why, in the header's and the
  // guide's words (unavailable, loading or nothing on now), rather than leave
  // the line empty or pretend something is 'broadcasting'
  const details = title
    ? [title, timeLeft].filter(Boolean).join(' · ')
    : isClubChannel
      ? describeLiveGuide(liveEPGStatus)
      : isLive
        ? 'Nothing on yet'
        : 'No guide info'
  const nhlLabel = isNHLOverlayVisible ? 'Hide NHL Scores' : 'NHL Scores'

  return (
    <div
      data-testid="player-info-rail"
      className={cn(RAIL_CLASS, isVisible ? 'opacity-100' : 'opacity-0')}
    >
      <div className="flex min-h-12 min-w-0 items-center gap-3">
        <span className={RAIL_NUMBER_CLASS}>{channel.number}</span>
        {logoChannel && <ChannelLogo channel={logoChannel} />}
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-2 text-base font-bold leading-tight">
            <span className="truncate">{channel.name}</span>
            {isClubChannel && (
              <span className="shrink-0 rounded bg-live px-1.5 py-px text-[11px] font-bold uppercase leading-none text-live-foreground">
                Live
              </span>
            )}
          </p>
          {!liveChange && <p className="mt-0.5 truncate text-sm leading-tight text-white/80">{details}</p>}
          {/* Always there on channel 0, so screen readers hear the change.
              Empty between announcements, which takes no height; never
              display:none, which would take it out of the accessibility tree
              and make each change a new region that screen readers skip */}
          {isLive && (
            <p role="status" className="mt-0.5 truncate text-sm font-semibold leading-tight empty:mt-0">
              {liveChange && describeLiveChange(liveChange)}
            </p>
          )}
        </div>
      </div>

      {/* The header's NHL toggle is gone in theater, fullscreen and on phones.
          video-controls: a tap here uses a control rather than hiding them. */}
      <div
        className={cn('video-controls flex shrink-0 items-center', isVisible && 'pointer-events-auto')}
        onMouseEnter={() => setHoveringControls(true)}
        onMouseLeave={() => setHoveringControls(false)}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              tabIndex={isVisible ? 0 : -1}
              onClick={toggleNHLOverlay}
              aria-label={nhlLabel}
              aria-keyshortcuts="N"
              aria-pressed={isNHLOverlayVisible}
              className={cn(
                'control-button flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-ring-media',
                isNHLOverlayVisible && 'bg-white/15'
              )}
            >
              {/* The glyph is the word itself, as in the header */}
              <span aria-hidden="true" className="font-display text-sm font-extrabold leading-none tracking-tight">
                NHL
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{withKey(nhlLabel, 'N')}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

/** The rail while a typed number matches no channel: the digits, then 'No channel 99' once entered */
function NumberRail({ number, isMissing }: { number: string; isMissing: boolean }) {
  return (
    <div data-testid="player-info-rail" className={cn(RAIL_CLASS, 'opacity-100')}>
      <div className="flex min-h-12 min-w-0 items-center gap-3">
        <span className={RAIL_NUMBER_CLASS}>{number}</span>
        <p role="status" className="truncate text-base font-bold leading-tight">
          {isMissing && `No channel ${number}`}
        </p>
      </div>
    </div>
  )
}

// 'Live changed to TSN 5 by Jon', or without the name for a system change
function describeLiveChange({ channelName, by }: LiveChannelChange): string {
  return by ? `Live changed to ${channelName} by ${by}` : `Live changed to ${channelName}`
}
