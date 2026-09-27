import { useEffect, useState } from 'react'
import { ChannelLogo } from '@/components/ChannelLogo'
import { LivePill } from '@/components/LivePill'
import { NHLScoresOverlay } from '@/components/NHLScoresOverlay'
import { PresenceStack } from '@/components/PresenceStack'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLiveChangeAnnouncement } from '@/hooks/useLiveChangeAnnouncement'
import { useNowPlaying } from '@/hooks/useNowPlaying'
import { presenceNames, usePresenceByChannel } from '@/hooks/usePresenceByChannel'
import { useTVMode } from '@/hooks/useTVMode'
import { withKey } from '@/lib/keyHints'
import { cn } from '@/lib/utils'
import { describeLiveChange, useChannelStore, type LiveChannelChange } from '@/stores/channelStore'
import { describeLiveGuide, useTVStore } from '@/stores/tvStore'
import { useUIStore } from '@/stores/uiStore'
import type { UnifiedChannel } from '@/types'
import { usePlayerShell, type BehindLive } from './PlayerShellContext'

/** How long the rail stays up after a tune */
const TUNE_BANNER_MS = 4000

const RAIL_CLASS = cn(
  'pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 bg-linear-to-b from-black/80 via-black/40 to-transparent pb-6 text-white transition-opacity duration-300',
  // Clear of the notch and status bar in landscape, theater and
  // fullscreen; the shell sets the top inset only when it is at the top
  'pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[calc(0.75rem+var(--player-inset-top,0px))]'
)
const RAIL_NUMBER_CLASS = 'font-display text-4xl font-black leading-none tabular-nums'
// Faces on this channel before the rest become '+n'
const RAIL_PRESENCE_MAX = 4

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
 * (ZapBanner) in that corner, so the rail stays out of it there and the
 * banner tells live changes instead.
 *
 * While the viewer steps through channels, the rail shows the channel they
 * are heading for at once; the tune itself waits until they stop pressing.
 * A typed number shows the channel it matches, just the digits while it
 * matches none, and 'No channel 99' when it is entered and no channel has it.
 *
 * When the picture falls well behind its own live edge (a pause, a stall, a
 * slow buffer), the LIVE pill's place says 'Behind live · Jump to live'. That
 * is this viewer's stream, not the group: someone who reconnected 30s behind
 * their friends is at their own live edge, so it never claims to be in sync.
 *
 * The first time the viewer pauses the shared live channel, the rail says
 * 'You'll fall behind the group' until they play again. Once per player.
 *
 * Who else is on this channel shows as a stack of faces beside the NHL
 * toggle, only while this viewer sees what everyone is watching (the admin
 * setting, and not hiding their own), and never for someone who hides theirs.
 */
export function PlayerInfoOverlay({ channel, pending = null, entry = null, missing = null }: PlayerInfoOverlayProps) {
  const { controlsVisible, isTheaterMode, setInfoRailVisible, behindLive, isLivePaused } = usePlayerShell()
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

  // A change to the shared live channel while this viewer is on it
  const liveChange = useLiveChangeAnnouncement(channel?.type === 'live')

  const railChannel = pending ?? channel
  // Digits with no channel to show for them
  const railNumber = missing ?? (entry !== null && pending === null ? entry : null)
  const isPreview = pending !== null || railNumber !== null
  const hasRail = (railNumber !== null || railChannel !== null) && !(isTVMode && isTheaterMode)
  const isRailVisible = hasRail && (controlsVisible || isTuneBanner || liveChange !== null || isPreview)

  // The pause hint shows for the first pause of the live channel only, while
  // the rail can say it (paused keeps the controls, and so the rail, up)
  const isLivePauseShown = hasRail && !isPreview && channel?.type === 'live' && isLivePaused
  const [pauseHint, setPauseHint] = useState<'unseen' | 'showing' | 'seen'>('unseen')
  if (isLivePauseShown && pauseHint === 'unseen') setPauseHint('showing')
  if (!isLivePauseShown && pauseHint === 'showing') setPauseHint('seen')

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
            behindLive={pending ? null : behindLive}
            isPauseHint={isLivePauseShown && pauseHint !== 'seen'}
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
  /** The engine is behind its own live edge */
  behindLive: BehindLive | null
  /** Say that pausing the live channel puts the viewer behind the group */
  isPauseHint: boolean
}

function InfoRail({ channel, isVisible, liveChange, behindLive, isPauseHint }: InfoRailProps) {
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
  // Empty unless presence shows channels to this viewer; people who hide
  // theirs have no channel, so they are never on one
  const watchingWith = usePresenceByChannel().get(channel.id) ?? []

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
            {behindLive ? (
              <BehindLiveButton behindLive={behindLive} isVisible={isVisible} />
            ) : (
              isClubChannel && <LivePill />
            )}
          </p>
          {!liveChange && <p className="mt-0.5 truncate text-sm leading-tight text-white/80">{details}</p>}
          {/* Always there on channel 0, so screen readers hear the change
              (and the pause hint). Empty between announcements, which takes
              no height; never display:none, which would take it out of the
              accessibility tree and make each change a new region that
              screen readers skip */}
          {isLive && (
            <p role="status" className="mt-0.5 truncate text-sm font-semibold leading-tight empty:mt-0">
              {liveChange
                ? describeLiveChange(liveChange.channelName, liveChange.by)
                : isPauseHint && "You'll fall behind the group"}
            </p>
          )}
        </div>
      </div>

      {/* The header's NHL toggle is gone in theater, fullscreen and on phones.
          video-controls: a tap here uses a control rather than hiding them. */}
      <div
        className={cn('video-controls flex shrink-0 items-center gap-2', isVisible && 'pointer-events-auto')}
        onMouseEnter={() => setHoveringControls(true)}
        onMouseLeave={() => setHoveringControls(false)}
      >
        {watchingWith.length > 0 && (
          <span role="img" aria-label={`Watching with ${presenceNames(watchingWith)}`} className="flex items-center">
            <PresenceStack people={watchingWith} max={RAIL_PRESENCE_MAX} />
          </span>
        )}
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

/**
 * The LIVE pill's behind state: the same shape, outlined rather than filled,
 * and a button back to the edge. video-controls: a tap here jumps rather than
 * hiding the controls.
 */
function BehindLiveButton({ behindLive, isVisible }: { behindLive: BehindLive; isVisible: boolean }) {
  const { setHoveringControls } = usePlayerShell()

  return (
    <button
      type="button"
      tabIndex={isVisible ? 0 : -1}
      onClick={behindLive.jumpToLive}
      onMouseEnter={() => setHoveringControls(true)}
      onMouseLeave={() => setHoveringControls(false)}
      className={cn(
        // The hit area reaches past the chip, which sits in the name's line
        'video-controls relative inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded border border-live px-2 py-1 before:absolute before:-inset-2',
        'font-display text-[11px] font-extrabold uppercase leading-none tracking-[0.12em] text-white',
        'transition-colors hover:bg-live/25 focus-ring-media',
        isVisible && 'pointer-events-auto'
      )}
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full border border-live" />
      Behind live{' '}
      <span aria-hidden="true">·</span>{' '}
      <span className="underline underline-offset-2">Jump to live</span>
    </button>
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
