import { useMemo, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ChannelList } from '@/components/ChannelList'
import { OnAirCard } from '@/components/admin/OnAirCard'
import { useChannelCatalogue } from '@/hooks/useChannelCatalogue'
import { useNHLScores } from '@/hooks/useNHLScores'
import { useSetLiveChannel } from '@/hooks/useSetLiveChannel'
import { useAuthStore } from '@/stores/authStore'
import { useChannelStore } from '@/stores/channelStore'
import { useNhlMappingStore } from '@/stores/nhlMappingStore'
import { useRecentLiveChannelIds } from '@/stores/recentLiveStore'
import { gamesOnNow, type GameOnNow } from '@/lib/nhlWatch'
import type { Channel } from '@/types'
import type { NHLGame } from '@/types/nhl'

interface LiveSwitcherSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The Live TV switcher, for admins and for everyone else when the admin has
 * allowed it: what's on air, the NHL games on now that are on your channels,
 * the channels you recently put on, then the full lineup. Picking anything
 * puts it on live TV for everyone and closes the sheet, and once the switch
 * goes through tunes you to channel 0 to watch it. A bottom sheet on phones,
 * a dialog from tablet width up.
 */
export function LiveSwitcherSheet({ open, onOpenChange }: LiveSwitcherSheetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] w-[95vw] max-w-2xl flex-col gap-0 overflow-hidden p-0 max-sm:top-auto max-sm:bottom-0 max-sm:w-full max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none max-sm:pb-safe sm:w-[85vw]">
        <DialogHeader className="px-4 pt-4 pr-12 text-left">
          <DialogTitle>Live TV</DialogTitle>
          <DialogDescription>Pick a channel to put on for everyone watching.</DialogDescription>
        </DialogHeader>
        {/* Only mounted while open, so the scores and channels load (and the
            scores poll) only while someone is choosing */}
        <SwitcherBody onPicked={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function SwitcherBody({ onPicked }: { onPicked: () => void }) {
  const currentChannelId = useChannelStore((s) => s.currentChannel?.id ?? null)
  const username = useAuthStore((s) => s.username)
  const recentIds = useRecentLiveChannelIds(username)
  const catalogue = useChannelCatalogue()
  const overrides = useNhlMappingStore((s) => s.overrides)
  const { data: scores } = useNHLScores(true)
  const setLiveChannel = useSetLiveChannel({ tuneActor: true })

  const games = useMemo(
    () => (catalogue ? gamesOnNow(scores, [...catalogue.values()], overrides) : []),
    [scores, catalogue, overrides],
  )
  // Each recent id as the catalogue has it now, leaving out channels that are
  // gone and the one already on air. None until the catalogue has loaded.
  const recents = recentIds.flatMap((id) => {
    const channel = catalogue?.get(id)
    return channel && channel.id !== currentChannelId ? [channel] : []
  })

  // The switch is optimistic and synchronous, so the sheet can close at once
  const pick = (channel: Channel) => {
    void setLiveChannel(channel)
    onPicked()
  }

  return (
    <>
      <OnAirCard showRecents={false} />
      <div className="epg-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {games.length > 0 && (
          <SwitcherSection title="Sports on now">
            <ul className="grid gap-2">
              {games.map((entry) => (
                <GameOnNowRow
                  key={entry.game.id}
                  entry={entry}
                  currentChannelId={currentChannelId}
                  onPick={pick}
                />
              ))}
            </ul>
          </SwitcherSection>
        )}

        {recents.length > 0 && (
          <SwitcherSection title="Recent">
            <div role="group" aria-label="Recent live channels" className="flex flex-wrap gap-2">
              {recents.map((channel) => (
                <Button
                  key={channel.id}
                  variant="outline"
                  size="sm"
                  className="max-w-full"
                  title={`Put ${channel.name} on live TV`}
                  onClick={() => pick(channel)}
                >
                  <span className="truncate">{channel.name}</span>
                </Button>
              ))}
            </div>
          </SwitcherSection>
        )}

        <SwitcherSection title="All channels" flush>
          <ChannelList onChannelSelected={onPicked} tuneActor />
        </SwitcherSection>
      </div>
    </>
  )
}

function SwitcherSection({
  title,
  flush = false,
  children,
}: {
  title: string
  /** The content brings its own padding (the channel list does) */
  flush?: boolean
  children: ReactNode
}) {
  return (
    <section aria-label={title} className={flush ? 'pt-4' : 'px-4 pt-4'}>
      <h3
        className={
          flush
            ? 'px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground'
            : 'mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground'
        }
      >
        {title}
      </h3>
      {children}
    </section>
  )
}

/** Period and clock of a live game, or the intermission. */
function liveClock(game: NHLGame): string {
  if (game.isIntermission) return `${game.period ?? ''} INT`.trim()
  return `${game.period ?? ''} ${game.timeRemaining ?? ''}`.trim()
}

function GameOnNowRow({
  entry,
  currentChannelId,
  onPick,
}: {
  entry: GameOnNow
  currentChannelId: string | null
  onPick: (channel: Channel) => void
}) {
  const { game, channels } = entry
  const away = game.awayTeam.abbreviation
  const home = game.homeTeam.abbreviation

  return (
    <li className="grid gap-2 rounded-xl border bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 font-semibold tabular-nums">
          <span title={game.awayTeam.name}>{away}</span>
          <span className="font-display text-lg font-extrabold">{game.awayTeam.score}</span>
          <span aria-hidden="true" className="text-muted-foreground">–</span>
          <span className="font-display text-lg font-extrabold">{game.homeTeam.score}</span>
          <span title={game.homeTeam.name}>{home}</span>
        </p>
        <span className="shrink-0 font-display text-sm font-extrabold uppercase tabular-nums text-live">
          {liveClock(game)}
        </span>
      </div>
      <div role="group" aria-label={`Channels showing ${away} at ${home}`} className="flex flex-wrap gap-2">
        {channels.map((channel) => {
          const onAir = channel.id === currentChannelId
          return (
            <Button
              key={channel.id}
              variant={onAir ? 'secondary' : 'outline'}
              size="sm"
              className="max-w-full"
              disabled={onAir}
              title={onAir ? `${channel.name} is on live TV` : `Put ${channel.name} on live TV`}
              onClick={() => onPick(channel)}
            >
              <span className="truncate">{channel.name}</span>
              {onAir && <span className="text-xs text-muted-foreground">On air</span>}
            </Button>
          )
        })}
      </div>
    </li>
  )
}
