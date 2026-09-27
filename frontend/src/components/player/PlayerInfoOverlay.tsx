import { ChannelLogo } from '@/components/ChannelLogo'
import { NHLScoresOverlay } from '@/components/NHLScoresOverlay'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useNowPlaying } from '@/hooks/useNowPlaying'
import { useTVMode } from '@/hooks/useTVMode'
import { cn } from '@/lib/utils'
import { useChannelStore } from '@/stores/channelStore'
import { useUIStore } from '@/stores/uiStore'
import type { UnifiedChannel } from '@/types'
import { usePlayerShell } from './PlayerShellContext'

interface PlayerInfoOverlayProps {
  /** The channel the player is on; null before the TV store has one */
  channel: UnifiedChannel | null
}

/**
 * The top of the player: an info rail saying which channel this is, what's
 * on and whether it's the club's shared live channel, with the NHL ticker
 * under it. Rendered in the player shell, so it shows in theater and
 * fullscreen (where the page header is gone) and survives engine swaps.
 *
 * The rail shows and hides with the control bar. It is the one top rail: the
 * ticker moves down while the rail is up, so the two never overlap. TV
 * theater has its own channel banner (ZapBanner) in that corner, so the rail
 * stays out of it there.
 */
export function PlayerInfoOverlay({ channel }: PlayerInfoOverlayProps) {
  const { controlsVisible, isTheaterMode } = usePlayerShell()
  const isTVMode = useTVMode()
  const isNHLOverlayVisible = useUIStore((s) => s.isNHLOverlayVisible)

  const hasRail = channel !== null && !(isTVMode && isTheaterMode)
  const isRailVisible = hasRail && controlsVisible

  return (
    <>
      {hasRail && <InfoRail channel={channel} isVisible={isRailVisible} />}
      <NHLScoresOverlay isVisible={isNHLOverlayVisible} belowRail={isRailVisible} />
    </>
  )
}

function InfoRail({ channel, isVisible }: { channel: UnifiedChannel; isVisible: boolean }) {
  const { setHoveringControls } = usePlayerShell()
  const { title, timeLeft, isLive, hasLiveChannel } = useNowPlaying(channel)
  // The live slot's logo is the live channel's, which the slot doesn't carry
  const liveChannel = useChannelStore((s) => s.currentChannel)
  const isNHLOverlayVisible = useUIStore((s) => s.isNHLOverlayVisible)
  const toggleNHLOverlay = useUIStore((s) => s.toggleNHLOverlay)

  const isClubChannel = isLive && hasLiveChannel
  const logoChannel = isLive ? liveChannel : channel
  // The live slot usually has no guide data: say so plainly rather than
  // leave the line empty or pretend something is 'broadcasting'
  const details = title
    ? [title, timeLeft].filter(Boolean).join(' · ')
    : isClubChannel
      ? 'Live · no guide info'
      : isLive
        ? 'Nothing on yet'
        : 'No guide info'
  const nhlLabel = isNHLOverlayVisible ? 'Hide NHL Scores' : 'NHL Scores'

  return (
    <div
      data-testid="player-info-rail"
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 bg-linear-to-b from-black/80 via-black/40 to-transparent pb-6 text-white transition-opacity duration-300',
        // Clear of the notch and status bar in landscape, theater and
        // fullscreen; the shell sets the top inset only when it is at the top
        'pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[calc(0.75rem+var(--player-inset-top,0px))]',
        isVisible ? 'opacity-100' : 'opacity-0'
      )}
    >
      <div className="flex min-h-12 min-w-0 items-center gap-3">
        <span className="font-display text-4xl font-black leading-none tabular-nums">{channel.number}</span>
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
          <p className="mt-0.5 truncate text-sm leading-tight text-white/80">{details}</p>
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
            <p>{nhlLabel}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
