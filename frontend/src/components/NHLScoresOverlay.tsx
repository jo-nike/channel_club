import { useEffect, useCallback, useRef, useState } from 'react'
import { RefreshCw, AlertCircle } from 'lucide-react'
import { useNHLScores } from '@/hooks/useNHLScores'

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
import { cn } from '@/lib/utils'
import type { NHLGame, NHLTeam } from '@/types/nhl'

interface NHLScoresOverlayProps {
  isVisible: boolean
}

/**
 * NHL scores overlay displaying today's games with live updates.
 * Positioned over the video player with transparent backdrop.
 *
 * Accessibility features:
 * - Escape key closes the overlay
 * - Clicking outside (on backdrop) closes the overlay
 * - aria-live region announces score updates to screen readers
 */
export function NHLScoresOverlay({ isVisible }: NHLScoresOverlayProps) {
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
      className="absolute inset-x-0 top-0 z-20 p-2"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="nhl-scores-title"
    >
      <div className="w-full p-3 rounded-lg bg-background/95 border shadow-lg">
        {/* Header row with title and content inline */}
        <div className="flex items-center gap-4">
          {/* Title section */}
          <div className="flex items-center gap-2 shrink-0">
            <NHLLogo className="h-5 w-5" />
            <h2 id="nhl-scores-title" className="text-sm font-semibold">
              NHL
            </h2>
            {data?.liveGameCount ? (
              <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-green-500/20 text-green-500 font-medium">
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
              <TickerScroll games={sortGames(data.games)} />
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

/**
 * Auto-scrolling ticker for games.
 * Scrolls slowly when content overflows, pauses on hover.
 * Live games are shown first and get more screen time.
 */
function TickerScroll({ games }: { games: NHLGame[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const scrollPosRef = useRef(0)
  const pauseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Check if content overflows
  useEffect(() => {
    const checkOverflow = () => {
      if (containerRef.current && contentRef.current) {
        setIsOverflowing(contentRef.current.scrollWidth > containerRef.current.clientWidth)
      }
    }
    checkOverflow()
    window.addEventListener('resize', checkOverflow)
    return () => window.removeEventListener('resize', checkOverflow)
  }, [games])

  // Auto-scroll animation
  useEffect(() => {
    if (!isOverflowing || isPaused) return

    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return

    const scrollWidth = content.scrollWidth
    const containerWidth = container.clientWidth
    const maxScroll = scrollWidth - containerWidth

    // Find where live games end (to pause there longer)
    const liveGamesCount = games.filter((g) => g.status === 'live').length
    const pauseAtStart = liveGamesCount > 0

    let animationId: number
    let lastTime = 0
    const scrollSpeed = 0.02 // pixels per millisecond (slow)

    // Initial pause on live games (3 seconds)
    if (pauseAtStart && scrollPosRef.current === 0) {
      pauseTimeoutRef.current = setTimeout(() => {
        pauseTimeoutRef.current = null
      }, 3000)
    }

    const animate = (time: number) => {
      if (pauseTimeoutRef.current) {
        animationId = requestAnimationFrame(animate)
        lastTime = time
        return
      }

      if (lastTime === 0) lastTime = time
      const delta = time - lastTime
      lastTime = time

      scrollPosRef.current += delta * scrollSpeed

      // Reset to start when reaching end (with a small pause)
      if (scrollPosRef.current >= maxScroll) {
        scrollPosRef.current = 0
        // Pause at start to show live games
        if (pauseAtStart) {
          pauseTimeoutRef.current = setTimeout(() => {
            pauseTimeoutRef.current = null
          }, 3000)
        }
      }

      container.scrollLeft = scrollPosRef.current
      animationId = requestAnimationFrame(animate)
    }

    animationId = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(animationId)
      if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current)
        pauseTimeoutRef.current = null
      }
    }
  }, [isOverflowing, isPaused, games])

  return (
    <div
      ref={containerRef}
      className="overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div ref={contentRef} className="flex gap-3">
        {games.map((game) => (
          <GameCardCompact key={game.id} game={game} />
        ))}
      </div>
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
 * Compact horizontal game card for sports ticker panel.
 */
function GameCardCompact({ game }: { game: NHLGame }) {
  const isLive = game.status === 'live'
  const isFinal = game.status === 'final'
  const isScheduled = game.status === 'scheduled'
  const showPowerPlay =
    game.situation &&
    game.situation.homeStrength !== game.situation.awayStrength

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-1 rounded border shrink-0',
        isLive && 'border-green-500 bg-green-500/5'
      )}
      aria-label={`${game.awayTeam.name} vs ${game.homeTeam.name}`}
    >
      {/* Away team */}
      <TeamBadge
        team={game.awayTeam}
        score={isScheduled ? undefined : game.awayTeam.score}
        isWinner={isFinal && game.awayTeam.score > game.homeTeam.score}
      />

      {/* VS / Score separator */}
      <span className="text-[10px] text-muted-foreground">@</span>

      {/* Home team */}
      <TeamBadge
        team={game.homeTeam}
        score={isScheduled ? undefined : game.homeTeam.score}
        isWinner={isFinal && game.homeTeam.score > game.awayTeam.score}
      />

      {/* Status */}
      <div className="flex items-center gap-1 pl-1 border-l border-border/50">
        <GameStatusBadge game={game} />
        {showPowerPlay && <PowerPlayIndicator />}
      </div>
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
  return (
    <div className="flex items-center gap-1">
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
            'text-xs tabular-nums',
            isWinner ? 'font-bold text-primary' : 'text-muted-foreground'
          )}
        >
          {score}
        </span>
      )}
    </div>
  )
}

/**
 * Game status badge showing time, period, or final result.
 */
function GameStatusBadge({ game }: { game: NHLGame }) {
  const isLive = game.status === 'live'
  const statusText = getStatusDisplay(game)

  return (
    <div
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
    </div>
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
