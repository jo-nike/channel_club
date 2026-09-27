import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Pin, PinOff, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'

import { useNHLScores } from '@/hooks/useNHLScores'
import { useChannelStore } from '@/stores/channelStore'
import { useNhlMappingStore } from '@/stores/nhlMappingStore'
import { fetchGroupedChannels, setCurrentChannel as setCurrentChannelApi } from '@/services/api'
import { matchNetworkToChannels, type MatcherResult } from '@/lib/nhlChannelMatcher'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/logger'
import type { Channel } from '@/types'
import type { NHLBroadcast, NHLGame } from '@/types/nhl'

interface BroadcastMatch {
  broadcast: NHLBroadcast
  result: MatcherResult
}

interface GameRow {
  game: NHLGame
  /** Broadcasts in display order, each resolved against the channel list. */
  broadcasts: BroadcastMatch[]
  /** True when at least one broadcast resolves to a channel in the lineup. */
  playable: boolean
}

export function NHLGamesTab() {
  const { data, isLoading, error, refetch } = useNHLScores(true)
  const overrides = useNhlMappingStore((s) => s.overrides)
  const [channels, setChannels] = useState<Channel[]>([])
  const [channelsLoading, setChannelsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const grouped = await fetchGroupedChannels()
        if (cancelled) return
        const flat = [...grouped.groups.flatMap((g) => g.channels), ...grouped.ungrouped]
        setChannels(flat)
      } catch (e) {
        logger.debug('NHLGamesTab', `Failed to load channels: ${e}`)
      } finally {
        if (!cancelled) setChannelsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const games = useMemo(() => {
    const all = data?.games ?? []
    return all
      .map((game): GameRow => {
        const broadcasts = [...game.broadcasts].sort(sortBroadcasts).map((broadcast) => ({
          broadcast,
          result: matchNetworkToChannels(broadcast.network, channels, overrides),
        }))
        return {
          game,
          broadcasts,
          playable: broadcasts.some((b) => b.result.matched.length > 0),
        }
      })
      .sort(sortGames)
  }, [data, channels, overrides])
  const playableCount = games.filter((g) => g.playable).length

  if (isLoading || channelsLoading) {
    return <NHLGamesTabSkeleton />
  }

  if (error) {
    return (
      <div className="p-4 text-center text-destructive">
        Failed to load NHL games: {error.message}
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">NHL Games</h2>
          <p className="text-sm text-muted-foreground">
            {games.length === 0
              ? 'No games today'
              : `${games.length} game${games.length === 1 ? '' : 's'} \u00b7 ${playableCount} on your channels${
                  playableCount > 0 ? ' \u00b7 click a broadcast to put it on' : ''
                }`}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={refetch} aria-label="Refresh NHL games">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {games.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No NHL games scheduled today.
        </div>
      ) : (
        <div className="space-y-3">
          {games.map((row) => (
            <GameCard
              key={row.game.id}
              game={row.game}
              broadcasts={row.broadcasts}
              channels={channels}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Sort: live -> scheduled -> final; within each status, games on your
// channels first; then by start time.
function sortGames(a: GameRow, b: GameRow): number {
  const statusOrder = { live: 0, scheduled: 1, final: 2 } as const
  const diff = statusOrder[a.game.status] - statusOrder[b.game.status]
  if (diff !== 0) return diff
  if (a.playable !== b.playable) return a.playable ? -1 : 1
  return a.game.startTime.localeCompare(b.game.startTime)
}

// Sort broadcasts: CA first, then US; national markets before regional; then alpha.
function sortBroadcasts(a: NHLBroadcast, b: NHLBroadcast): number {
  const countryRank = (c: string) => (c === 'CA' ? 0 : c === 'US' ? 1 : 2)
  const marketRank = (m: string) => (m === 'N' ? 0 : 1)
  const c = countryRank(a.countryCode) - countryRank(b.countryCode)
  if (c !== 0) return c
  const m = marketRank(a.market) - marketRank(b.market)
  if (m !== 0) return m
  return a.network.localeCompare(b.network)
}

function formatStatus(game: NHLGame): string {
  if (game.status === 'live') {
    if (game.isIntermission) return `${game.period ?? ''} INT`.trim()
    return `${game.period ?? ''} ${game.timeRemaining ?? ''}`.trim()
  }
  if (game.status === 'final') {
    return game.outcomeType ? `F/${game.outcomeType}` : 'FINAL'
  }
  const d = new Date(game.startTime)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

interface GameCardProps {
  game: NHLGame
  broadcasts: BroadcastMatch[]
  channels: Channel[]
}

function GameCard({ game, broadcasts, channels }: GameCardProps) {
  const [showUnmatched, setShowUnmatched] = useState(false)
  const matched = broadcasts.filter((b) => b.result.matched.length > 0)
  const unmatched = broadcasts.filter((b) => b.result.matched.length === 0)
  const chip = ({ broadcast, result }: BroadcastMatch) => (
    <BroadcastChip
      key={`${broadcast.network}-${broadcast.market}-${broadcast.countryCode}`}
      broadcast={broadcast}
      result={result}
      channels={channels}
    />
  )

  return (
    <Card className={cn('gap-0 py-0', game.status === 'live' && 'border-green-500')}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <TeamLine
              abbr={game.awayTeam.abbreviation}
              name={game.awayTeam.name}
              score={game.awayTeam.score}
              logo={game.awayTeam.logo}
              showScore={game.status !== 'scheduled'}
            />
            <span className="text-xs text-muted-foreground">@</span>
            <TeamLine
              abbr={game.homeTeam.abbreviation}
              name={game.homeTeam.name}
              score={game.homeTeam.score}
              logo={game.homeTeam.logo}
              showScore={game.status !== 'scheduled'}
            />
          </div>
          <div
            className={cn(
              'text-xs font-medium whitespace-nowrap',
              game.status === 'live' && 'text-green-600',
            )}
          >
            {formatStatus(game)}
          </div>
        </div>

        {broadcasts.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {matched.map(chip)}
            {showUnmatched && unmatched.map(chip)}
            {unmatched.length > 0 && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                aria-expanded={showUnmatched}
                onClick={() => setShowUnmatched((v) => !v)}
              >
                {showUnmatched
                  ? `Hide ${unmatched.length} not in your lineup`
                  : `+${unmatched.length} not in your lineup`}
              </button>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic">No broadcast info</div>
        )}
      </CardContent>
    </Card>
  )
}

interface TeamLineProps {
  abbr: string
  name: string
  score: number
  logo: string
  showScore: boolean
}

function TeamLine({ abbr, name, score, logo, showScore }: TeamLineProps) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      {logo && <img src={logo} alt="" className="h-6 w-6 shrink-0" />}
      <span className="font-medium truncate" title={name}>
        {abbr}
      </span>
      {showScore && <span className="font-display text-base font-extrabold tabular-nums">{score}</span>}
    </div>
  )
}

interface BroadcastChipProps {
  broadcast: NHLBroadcast
  result: MatcherResult
  channels: Channel[]
}

function BroadcastChip({ broadcast, result, channels }: BroadcastChipProps) {
  const { setCurrentChannel } = useChannelStore()

  const playChannel = useCallback(
    async (channel: Channel) => {
      const previous = useChannelStore.getState().currentChannel
      setCurrentChannel(channel)
      try {
        await setCurrentChannelApi(channel)
      } catch (e) {
        setCurrentChannel(previous)
        toast.error('Failed to change channel', {
          description: e instanceof Error ? e.message : 'Please try again',
        })
      }
    },
    [setCurrentChannel],
  )

  const countryLabel = broadcast.countryCode
  const isNational = broadcast.market === 'N'
  const matchedCount = result.matched.length
  const isGreyed = matchedCount === 0

  const chipBase = cn(
    'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
    isNational ? 'shadow-sm' : 'opacity-90',
    isGreyed
      ? 'border-dashed text-muted-foreground bg-muted/30'
      : 'hover:bg-accent hover:text-accent-foreground cursor-pointer',
    result.isOverride && 'ring-1 ring-primary',
  )

  // Single clear match -> one-click play + a pin button to override elsewhere
  if (matchedCount === 1) {
    const channel = result.matched[0]
    return (
      <div className="inline-flex items-center">
        <button
          className={cn(chipBase, 'rounded-r-none border-r-0')}
          onClick={() => playChannel(channel)}
          title={`Play ${channel.name}`}
        >
          <NetworkLabel broadcast={broadcast} />
          <span className="text-muted-foreground">· {countryLabel}</span>
        </button>
        <PinButton broadcast={broadcast} channels={channels} isOverride={result.isOverride} />
      </div>
    )
  }

  // Multiple matches -> popover to pick which one to play
  if (matchedCount > 1) {
    return (
      <div className="inline-flex items-center">
        <Popover>
          <PopoverTrigger asChild>
            <button className={cn(chipBase, 'rounded-r-none border-r-0')}>
              <NetworkLabel broadcast={broadcast} />
              <span className="text-muted-foreground">
                · {countryLabel} · {matchedCount}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2">
            <div className="text-xs text-muted-foreground mb-1 px-1">
              Pick a channel to play
            </div>
            <div className="space-y-0.5 max-h-60 overflow-y-auto">
              {result.matched.map((c) => (
                <button
                  key={c.id}
                  className="w-full text-left rounded px-2 py-1.5 text-sm hover:bg-accent"
                  onClick={() => playChannel(c)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <PinButton broadcast={broadcast} channels={channels} isOverride={result.isOverride} />
      </div>
    )
  }

  // No match -> greyed-out + pin flow to create a binding
  return (
    <div className="inline-flex items-center">
      <div className={cn(chipBase, 'rounded-r-none border-r-0 cursor-default')}>
        <NetworkLabel broadcast={broadcast} />
        <span>· {countryLabel}</span>
      </div>
      <PinButton broadcast={broadcast} channels={channels} isOverride={false} />
    </div>
  )
}

function NetworkLabel({ broadcast }: { broadcast: NHLBroadcast }) {
  const marketBadge =
    broadcast.market === 'N' ? null : (
      <span className="text-[10px] uppercase text-muted-foreground">
        {broadcast.market === 'H' ? 'home' : 'away'}
      </span>
    )
  return (
    <>
      <span>{broadcast.network}</span>
      {marketBadge}
    </>
  )
}

interface PinButtonProps {
  broadcast: NHLBroadcast
  channels: Channel[]
  isOverride: boolean
}

function PinButton({ broadcast, channels, isOverride }: PinButtonProps) {
  const setOverride = useNhlMappingStore((s) => s.setOverride)
  const clearOverride = useNhlMappingStore((s) => s.clearOverride)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return channels.slice(0, 50)
    return channels.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 50)
  }, [channels, query])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'inline-flex h-[26px] items-center justify-center rounded-md rounded-l-none border border-l px-1.5 transition-colors',
            isOverride
              ? 'text-primary border-primary hover:bg-primary/10'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          )}
          aria-label={isOverride ? `Clear override for ${broadcast.network}` : `Pin channel to ${broadcast.network}`}
          title={isOverride ? 'Override active \u2014 click to change, shift-click to clear' : 'Pin a channel to this network'}
          onClick={(e) => {
            if (isOverride && e.shiftKey) {
              e.preventDefault()
              clearOverride(broadcast.network)
            }
          }}
        >
          {isOverride ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2">
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground px-1">
            Pin a channel to <span className="font-medium text-foreground">{broadcast.network}</span>
          </div>
          <Input
            placeholder="Search channels\u2026"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8"
            autoFocus
          />
          <div className="space-y-0.5 max-h-60 overflow-y-auto">
            {filtered.map((c) => (
              <button
                key={c.id}
                className="w-full text-left rounded px-2 py-1.5 text-sm hover:bg-accent"
                onClick={() => {
                  setOverride(broadcast.network, c.id)
                  setOpen(false)
                  setQuery('')
                }}
              >
                {c.name}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-2 py-4 text-xs text-muted-foreground text-center">
                No channels match "{query}"
              </div>
            )}
          </div>
          {isOverride && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                clearOverride(broadcast.network)
                setOpen(false)
              }}
            >
              Clear override
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function NHLGamesTabSkeleton() {
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-8 w-8" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    </div>
  )
}
