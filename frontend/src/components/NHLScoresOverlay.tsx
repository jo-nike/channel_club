import { useContext, useEffect, useCallback, useId, useMemo, useRef, useState } from 'react'
import { RefreshCw, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PlayerShellContext } from '@/components/player/PlayerShellContext'
import { useChannelCatalogueLoad } from '@/hooks/useChannelCatalogue'
import { useChatEnabled } from '@/hooks/useChatEnabled'
import { useNHLScores } from '@/hooks/useNHLScores'
import { useSetLiveChannel } from '@/hooks/useSetLiveChannel'
import type { ChatSendResult } from '@/hooks/useWebSocket'

/**
 * NHL shield logo as inline SVG.
 */
function NHLLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 105 150"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      {/* Shield shape */}
      <path
        d="M52.5 0C23.5 0 0 10 0 10v90c0 30 52.5 50 52.5 50S105 130 105 100V10S81.5 0 52.5 0z"
        fill="currentColor"
      />
      {/* NHL text */}
      <text
        x="52.5"
        y="85"
        textAnchor="middle"
        fontSize="36"
        fontWeight="bold"
        fontFamily="Arial, sans-serif"
        fill="var(--background, #fff)"
      >
        NHL
      </text>
    </svg>
  )
}
import { useUIStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import { useChatStore } from '@/stores/chatStore'
import { useNhlMappingStore } from '@/stores/nhlMappingStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { cn } from '@/lib/utils'
import { scrollBehavior } from '@/lib/motion'
import { askGroupMessage, channelsOf, matchGames, type GameRow } from '@/lib/nhlWatch'
import type { Channel } from '@/types'
import type { NHLGame, NHLTeam } from '@/types/nhl'

interface NHLScoresOverlayProps {
  isVisible: boolean
  /** The player's info rail is up: sit under it rather than on top of it */
  belowRail?: boolean
}

/**
 * NHL scores overlay displaying today's games with live updates.
 * Positioned over the video player with transparent backdrop.
 *
 * Accessibility features:
 * - A labelled region, not a dialog: it is not modal
 * - Escape key closes the overlay
 * - Clicking outside (on backdrop) closes the overlay
 * - aria-live region announces score updates to screen readers
 */
export function NHLScoresOverlay({ isVisible, belowRail = false }: NHLScoresOverlayProps) {
  const { data, isLoading, error, refetch } = useNHLScores(isVisible)
  const toggleNHLOverlay = useUIStore((s) => s.toggleNHLOverlay)

  // Handle escape key to close overlay
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isVisible) {
        e.stopPropagation()
        toggleNHLOverlay()
      }
    },
    [isVisible, toggleNHLOverlay]
  )

  useEffect(() => {
    if (isVisible) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isVisible, handleKeyDown])

  // Handle backdrop click to close overlay
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        toggleNHLOverlay()
      }
    },
    [toggleNHLOverlay]
  )

  if (!isVisible) return null

  return (
    <div
      className={cn(
        // video-controls: a tap here uses the ticker rather than toggling the
        // player controls, and a swipe that starts here is not a channel change
        'video-controls absolute inset-x-0 z-20 p-2',
        // The rail's height: 0.75rem above its 3rem row, plus the shell's top inset
        belowRail ? 'top-[calc(3.75rem+var(--player-inset-top,0px))]' : 'top-0'
      )}
      onClick={handleBackdropClick}
      // A strip over the video, not a modal: the player stays usable under it
      role="region"
      aria-label="NHL scores"
    >
      <div className="w-full p-3 rounded-lg bg-background/95 border shadow-lg">
        {/* Header row with title and content inline */}
        <div className="flex items-center gap-4">
          {/* Title section */}
          <div className="flex items-center gap-2 shrink-0">
            <NHLLogo className="h-5 w-5" />
            <h2 className="text-sm font-semibold">
              NHL
            </h2>
            {data?.liveGameCount ? (
              <span className="px-1.5 py-0.5 text-xs rounded-full bg-green-500/20 text-green-500 font-medium">
                {data.liveGameCount} Live
              </span>
            ) : null}
          </div>

          {/* Divider */}
          <div className="h-6 w-px bg-border shrink-0" />

          {/* Content with aria-live for score updates */}
          <div aria-live="polite" aria-atomic="false" className="flex-1 min-w-0">
            {isLoading && !data && <LoadingStateCompact />}
            {error && <ErrorStateCompact onRetry={refetch} />}
            {data?.games.length === 0 && <EmptyStateCompact />}
            {data && data.games.length > 0 && (
              <TickerScroll games={data.games} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Compact loading state for horizontal panel.
 */
function LoadingStateCompact() {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <RefreshCw className="h-4 w-4 animate-spin" />
      <span className="text-xs">Loading...</span>
    </div>
  )
}

/**
 * Compact error state for horizontal panel.
 */
function ErrorStateCompact({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <AlertCircle className="h-4 w-4 text-destructive" />
      <span className="text-xs text-muted-foreground">Failed to load</span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRetry()
        }}
        className="px-2 py-0.5 text-xs rounded bg-secondary hover:bg-secondary/80 transition-colors"
      >
        Retry
      </button>
    </div>
  )
}

/**
 * Compact empty state for horizontal panel.
 */
function EmptyStateCompact() {
  return (
    <span className="text-xs text-muted-foreground">No games today</span>
  )
}

// A chevron moves the row by most of its width, keeping a pill of context
const PAGE_FRACTION = 0.8
// An arrow key moves it by about one pill; the snap settles it on the next one
const KEY_STEP_PX = 160

/**
 * The games in a row that scrolls by hand: swipe, wheel, the chevrons, or the
 * arrow keys once it has focus. It never moves by itself. The ends fade, with
 * a chevron, only while there is more that way.
 *
 * Each game opens what you can do about it, so the channel lineup loads while
 * the row is up (any signed-in viewer can read it) to match each game's
 * broadcasts to channels, pins first, as the Live TV switcher does. If the
 * lineup can't be loaded, the games say so rather than wait for it.
 */
function TickerScroll({ games }: { games: NHLGame[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState({ before: false, after: false })
  const { catalogue, failed: lineupFailed } = useChannelCatalogueLoad()
  const overrides = useNhlMappingStore((s) => s.overrides)

  const sorted = useMemo(() => sortGames(games), [games])
  // Each game's broadcasts on your channels, by game id; null until the lineup loads
  const rows = useMemo(
    () =>
      catalogue
        ? new Map(matchGames(games, [...catalogue.values()], overrides).map((row) => [row.game.id, row]))
        : null,
    [games, catalogue, overrides]
  )

  // Whether there is more to see on either side, re-read on scroll and when
  // the row or its games change size
  useEffect(() => {
    const scroller = scrollerRef.current
    const content = contentRef.current
    if (!scroller || !content) return

    const update = () => {
      const before = scroller.scrollLeft > 1
      const after = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1
      setMore((current) =>
        current.before === before && current.after === after ? current : { before, after }
      )
    }

    update()
    scroller.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    observer.observe(content)
    return () => {
      scroller.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [])

  const scrollRow = (left: number) => {
    scrollerRef.current?.scrollBy({ left, behavior: scrollBehavior() })
  }
  const scrollPage = (direction: 1 | -1) => {
    const width = scrollerRef.current?.clientWidth ?? 0
    scrollRow(direction * width * PAGE_FRACTION)
  }

  // The arrows scroll the row rather than change the volume. Only from the
  // row: a game's popover is portalled out of it, but its keys still bubble here
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    if (!(e.target instanceof Node) || !scrollerRef.current?.contains(e.target)) return
    e.preventDefault()
    scrollRow(e.key === 'ArrowRight' ? KEY_STEP_PX : -KEY_STEP_PX)
  }

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        tabIndex={0}
        role="group"
        aria-label="Today's games"
        onKeyDown={handleKeyDown}
        className="overflow-x-auto snap-x snap-mandatory scroll-px-8 rounded [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
      >
        <div ref={contentRef} className="flex w-max gap-3">
          {sorted.map((game) => (
            <GameCardCompact key={game.id} game={game} row={rows?.get(game.id)} lineupFailed={lineupFailed} />
          ))}
        </div>
      </div>
      {/* Keyboard users scroll the focused row with the arrows, so the chevrons
          stay out of the tab order: one would vanish under focus at the end */}
      {more.before && (
        <div className="pointer-events-none absolute inset-y-0 left-0 flex w-12 items-center bg-linear-to-r from-background via-background/80 to-transparent">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Scroll games left"
            onClick={() => scrollPage(-1)}
            className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full border bg-background shadow-sm hover:bg-accent"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
      {more.after && (
        <div className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-end bg-linear-to-l from-background via-background/80 to-transparent">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Scroll games right"
            onClick={() => scrollPage(1)}
            className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full border bg-background shadow-sm hover:bg-accent"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Sort games by status priority and start time.
 * Live games appear first, then scheduled, then final.
 * Within each status group, games are sorted by start time (earliest first).
 *
 * @param games - Array of NHL games to sort
 * @returns New sorted array (original array is not mutated)
 */
function sortGames(games: NHLGame[]): NHLGame[] {
  const statusOrder: Record<string, number> = {
    live: 0,
    scheduled: 1,
    final: 2,
  }

  return [...games].sort((a, b) => {
    // Sort by status first
    const statusDiff = statusOrder[a.status] - statusOrder[b.status]
    if (statusDiff !== 0) return statusDiff

    // Within same status, sort by start time
    return new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  })
}

/**
 * Compact horizontal game card for sports ticker panel: a button that opens
 * what you can do about the game (see GameActions).
 */
function GameCardCompact({
  game,
  row,
  lineupFailed,
}: {
  game: NHLGame
  /** The game's broadcasts matched to your channels; undefined until the lineup loads */
  row: GameRow | undefined
  /** The lineup couldn't be loaded, so row never comes */
  lineupFailed: boolean
}) {
  const shell = useContext(PlayerShellContext)
  const [isOpen, setIsOpen] = useState(false)
  const [portalContainer, setPortalContainer] = useState<HTMLElement | undefined>(undefined)
  const isLive = game.status === 'live'
  const isFinal = game.status === 'final'
  const isScheduled = game.status === 'scheduled'
  const showPowerPlay =
    game.situation &&
    game.situation.homeStrength !== game.situation.awayStrength

  // The popover portals into the player shell, which is also the element the
  // player fullscreens, so it shows in and out of fullscreen alike (outside a
  // shell, into the page). Refs are not render-time values: resolve it as the
  // popover opens, when it is populated.
  const handleOpenChange = (open: boolean) => {
    if (open) setPortalContainer(shell?.containerRef.current ?? undefined)
    setIsOpen(open)
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-2 px-2 py-1 rounded border shrink-0 snap-start text-left transition-colors hover:bg-accent focus-visible:-outline-offset-2',
            isLive && 'border-green-500 bg-green-500/5'
          )}
          aria-label={gameLabel(game, !!showPowerPlay)}
        >
          {/* Away team */}
          <TeamBadge
            team={game.awayTeam}
            score={isScheduled ? undefined : game.awayTeam.score}
            isWinner={isFinal && game.awayTeam.score > game.homeTeam.score}
          />

          {/* VS / Score separator */}
          <span className="text-xs text-muted-foreground">@</span>

          {/* Home team */}
          <TeamBadge
            team={game.homeTeam}
            score={isScheduled ? undefined : game.homeTeam.score}
            isWinner={isFinal && game.homeTeam.score > game.awayTeam.score}
          />

          {/* Status */}
          <span className="flex items-center gap-1 pl-1 border-l border-border/50">
            <GameStatusBadge game={game} />
            {showPowerPlay && <PowerPlayIndicator />}
          </span>
        </button>
      </PopoverTrigger>
      {/* video-controls: a tap in here uses the popover rather than toggling
          the player's controls. Escape closes the popover, not the ticker. */}
      <PopoverContent
        container={portalContainer}
        side="bottom"
        align="start"
        className="video-controls w-72 p-3"
        aria-label={`${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`}
        onEscapeKeyDown={(e) => e.stopPropagation()}
      >
        <GameActions game={game} row={row} lineupFailed={lineupFailed} onDone={() => setIsOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

/**
 * The game's button name: the teams with their scores, the status and any
 * power play, as the pill shows them. A button's label replaces its content
 * for assistive tech, so all of it goes in here.
 */
function gameLabel(game: NHLGame, powerPlay: boolean): string {
  const scored = game.status !== 'scheduled'
  const team = (t: NHLTeam) => (scored ? `${t.name} ${t.score}` : t.name)
  const parts = [`${team(game.awayTeam)} at ${team(game.homeTeam)}`, getStatusDisplay(game)]
  if (powerPlay) parts.push('power play')
  return parts.filter(Boolean).join(', ')
}

/**
 * Tell the asker how their question went. The popover has closed by then, so
 * this is all they hear of it.
 */
async function reportAsk(sending: Promise<ChatSendResult>) {
  const result = await sending
  if (result === 'acknowledged') {
    toast.success('Asked the group in chat')
  } else if (result === 'not-sent') {
    toast.error("Couldn't ask the group", { description: 'Please try again' })
  } else {
    toast.warning('Your question may not have been posted', {
      description: 'Check the chat before asking again',
    })
  }
}

/**
 * What you can do about a game: the channels it is on, each with 'Watch
 * together' (put it on live TV for everyone, then join it) for admins, and
 * for everyone when the admin lets viewers change live TV. Everyone else can
 * 'Ask the group' in chat instead, with the game and its channels filled in;
 * that needs chat, so with chat off it is disabled and says why. A game that
 * is over, or on none of your channels, has nothing to do. When the lineup
 * can't be loaded it says so, and those who can't switch can still ask for
 * the game by name.
 */
function GameActions({
  game,
  row,
  lineupFailed,
  onDone,
}: {
  game: NHLGame
  row: GameRow | undefined
  /** The lineup couldn't be loaded, so row never comes */
  lineupFailed: boolean
  /** Close the popover */
  onDone: () => void
}) {
  const isAdmin = useAuthStore((s) => s.role === 'admin')
  const userChannelSelection = useSettingsStore((s) => s.userChannelSelection)
  const chatEnabled = useChatEnabled()
  const sendMessage = useChatStore((s) => s.sendMessage)
  const setLiveChannel = useSetLiveChannel({ tuneActor: true })
  const canSwitch = isAdmin || userChannelSelection
  const hintId = useId()

  const matchup = `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`
  const channels = row ? channelsOf(row.broadcasts) : []
  const networks = game.broadcasts.map((b) => b.network).join(', ')

  // The switch is optimistic and synchronous, so the popover can close at once
  const watch = (channel: Channel) => {
    void setLiveChannel(channel)
    onDone()
  }
  const ask = () => {
    void reportAsk(sendMessage(askGroupMessage(game, channels)))
    onDone()
  }

  // Asking needs chat, not the lineup: without it the message names no channel
  const askTheGroup = (note: string) => (
    <div className="grid gap-2">
      <p className="text-sm text-muted-foreground">{note}</p>
      <Button
        size="sm"
        disabled={!chatEnabled}
        aria-describedby={chatEnabled ? undefined : hintId}
        onClick={ask}
      >
        Ask the group
      </Button>
      {!chatEnabled && (
        <p id={hintId} className="text-xs text-muted-foreground">
          Chat is off, so you can't ask the group. Only an admin can change live TV.
        </p>
      )}
    </div>
  )
  const lineupError = "Couldn't load your channels. Reopen the scores to try again."

  let body
  if (game.status === 'final') {
    body = <p className="text-sm text-muted-foreground">This game is over.</p>
  } else if (lineupFailed) {
    body = canSwitch ? <p className="text-sm text-muted-foreground">{lineupError}</p> : askTheGroup(lineupError)
  } else if (row === undefined) {
    body = <p className="text-sm text-muted-foreground">Finding it on your channels…</p>
  } else if (channels.length === 0) {
    body = (
      <p className="text-sm text-muted-foreground">
        Not on any of your channels{networks ? ` (on ${networks})` : ''}.
      </p>
    )
  } else if (canSwitch) {
    body = (
      <ul aria-label={`Channels showing ${matchup}`} className="grid gap-1.5">
        {channels.map((channel) => (
          <li key={channel.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm">{channel.name}</span>
            <Button
              size="sm"
              className="shrink-0"
              aria-label={`Watch together on ${channel.name}`}
              onClick={() => watch(channel)}
            >
              Watch together
            </Button>
          </li>
        ))}
      </ul>
    )
  } else {
    body = askTheGroup(`On ${channels.map((c) => c.name).join(', ')}`)
  }

  return (
    <div className="grid gap-2">
      <p className="font-display text-base font-extrabold tabular-nums">{matchup}</p>
      {body}
    </div>
  )
}

/**
 * Compact team badge with logo, abbreviation, and score.
 */
function TeamBadge({
  team,
  score,
  isWinner,
}: {
  team: NHLTeam
  score?: number
  isWinner: boolean
}) {
  // Spans, not divs: this sits inside the game's button
  return (
    <span className="flex items-center gap-1">
      <img
        src={team.logoDark}
        alt=""
        className="h-4 w-4 object-contain"
        onError={(e) => {
          const img = e.target as HTMLImageElement
          if (img.src !== team.logo) {
            img.src = team.logo
          } else {
            img.style.display = 'none'
          }
        }}
      />
      <span
        className={cn(
          'text-xs font-medium',
          isWinner ? 'text-primary' : 'text-muted-foreground'
        )}
      >
        {team.abbreviation}
      </span>
      {score !== undefined && (
        <span
          className={cn(
            'font-display text-sm tabular-nums',
            isWinner ? 'font-black text-primary' : 'font-bold text-muted-foreground'
          )}
        >
          {score}
        </span>
      )}
    </span>
  )
}

/**
 * Game status badge showing time, period, or final result.
 */
function GameStatusBadge({ game }: { game: NHLGame }) {
  const isLive = game.status === 'live'
  const statusText = getStatusDisplay(game)

  return (
    <span
      className={cn('flex items-center gap-1.5', isLive && 'text-green-500')}
    >
      {isLive && (
        <span
          className="h-2 w-2 rounded-full bg-green-500 animate-pulse shrink-0"
          aria-hidden="true"
        />
      )}
      <span
        className={cn(
          'text-xs font-medium truncate',
          !isLive && 'text-muted-foreground'
        )}
      >
        {statusText}
      </span>
    </span>
  )
}

/**
 * Power play indicator badge.
 */
function PowerPlayIndicator() {
  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-500 font-medium shrink-0"
      aria-label="Power play in progress"
    >
      PP
    </span>
  )
}

/**
 * Get human-readable status display text for a game.
 *
 * @param game - NHL game object
 * @returns Status text:
 *   - Scheduled: Local start time (e.g., "7:00 PM")
 *   - Live: Period and time remaining (e.g., "2nd 08:45") or intermission (e.g., "2nd INT")
 *   - Final: "FINAL" or "F/OT" or "F/SO" for overtime/shootout games
 */
function getStatusDisplay(game: NHLGame): string {
  switch (game.status) {
    case 'scheduled':
      return formatLocalTime(game.startTime)
    case 'live':
      if (game.isIntermission) {
        return `${game.period ?? ''} INT`
      }
      return `${game.period ?? ''} ${game.timeRemaining ?? ''}`.trim()
    case 'final':
      if (game.outcomeType) {
        return `F/${game.outcomeType}`
      }
      return 'FINAL'
    default:
      return ''
  }
}

/**
 * Format ISO 8601 timestamp to local time string.
 *
 * @param isoString - ISO 8601 date string (e.g., "2026-01-15T00:00:00Z")
 * @returns Localized time string (e.g., "7:00 PM")
 */
function formatLocalTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}
