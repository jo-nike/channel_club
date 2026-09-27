import { Radio, AudioLines } from 'lucide-react'
import { useMemo } from 'react'
import { useProgrammeClock } from '@/hooks/useProgrammeClock'
import { buildProgrammeIndex, findCurrentAndNext, type CurrentAndNext } from '@/lib/programmeIndex'
import { calculateProgress, formatRemaining } from '@/lib/programmes'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore, describeLiveGuide, LIVE_CHANNEL_ID } from '@/stores/tvStore'
import { getErsatzTVLogoUrl } from '@/services/ersatztvApi'
import { Button } from '@/components/ui/button'
import type { UnifiedChannel } from '@/types'

// Created once: the Next line formats a time on every row on every tick
const nextTimeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

const NOTHING_ON: CurrentAndNext = { current: null, next: null }

// Mobile card layout
interface MobileChannelListProps {
  onChannelSelect: (channel: UnifiedChannel) => void
  liveEPGTitle?: string | null
  // Opens the live channel picker; only for people allowed to change live TV
  onPickLive?: () => void
}

export function MobileChannelList({ onChannelSelect, liveEPGTitle, onPickLive }: MobileChannelListProps) {
  const { getUnifiedChannels, isLiveChannelActive, selectedChannel, liveEPGStatus } = useTVStore()
  const { programmesByChannel } = useErsatztvStore()
  // The live channel's schedule, for the live row's Next line
  const liveProgrammes = useTVStore((s) => s.liveProgrammes)
  // Shared 30s clock for the current programme, progress and time remaining
  const currentTime = useProgrammeClock()

  const unifiedChannels = getUnifiedChannels()
  const hasLiveChannel = isLiveChannelActive()

  // Now and next per channel: the ErsatzTV index is cached per
  // programmesByChannel (and shared with the guide); the live row gets its own
  const programmeIndex = buildProgrammeIndex(programmesByChannel)
  const liveProgrammeIndex = useMemo(
    () => buildProgrammeIndex({ [LIVE_CHANNEL_ID]: liveProgrammes }),
    [liveProgrammes]
  )
  const getNowAndNext = (channel: UnifiedChannel): CurrentAndNext => {
    if (channel.type === 'live') {
      return hasLiveChannel ? findCurrentAndNext(liveProgrammeIndex, channel.id, currentTime) : NOTHING_ON
    }
    return findCurrentAndNext(programmeIndex, channel.id, currentTime)
  }

  // Helper to get live programme title
  const getLiveProgrammeTitle = (): string => {
    if (liveEPGTitle) return liveEPGTitle
    if (hasLiveChannel) return describeLiveGuide(liveEPGStatus)
    return onPickLive ? 'Nothing on yet' : 'Waiting for someone to put something on'
  }

  // The bottom padding grows by the install banner's room while it shows,
  // so the last channel can scroll out from under it
  return (
    <div className="space-y-2 px-4 pt-4 pb-[calc(1rem+var(--install-prompt-h,0px))]">
      <h2 className="text-lg font-semibold">Channels</h2>
      <div className="grid grid-cols-1 gap-2">
        {unifiedChannels.map((channel) => {
          const isLive = channel.type === 'live'
          const isSelected = selectedChannel?.id === channel.id
          const { current, next } = getNowAndNext(channel)
          // The live row's title comes from the now-playing lookup instead
          const currentProgramme = isLive ? null : current?.programme
          const cardClassName = `
            rounded-lg border
            ${isSelected ? 'border-primary bg-primary/10' : ''}
            ${isLive ? 'bg-destructive/5' : ''}
          `
          // The empty live slot offers the picker next to the tune button
          // (a sibling, since buttons can't nest)
          const showPickLive = isLive && !hasLiveChannel && !!onPickLive

          const tuneButton = (
            <button
              key={channel.id}
              onClick={() => onChannelSelect(channel)}
              className={`
                flex items-center gap-3 p-2 text-left
                transition-colors hover:bg-accent
                ${showPickLive ? 'min-w-0 flex-1 rounded-lg' : cardClassName}
              `}
            >
              {/* Every row carries its number (0 is the live slot), so a
                  channel with a logo can still be found by number */}
              <span
                className={`w-6 shrink-0 text-right font-display text-lg font-extrabold leading-none tabular-nums ${
                  isSelected ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                {channel.number}
              </span>
              <div
                className={`h-10 w-10 flex-shrink-0 overflow-hidden rounded flex items-center justify-center ${
                  isLive ? 'bg-destructive/20' : 'bg-muted'
                }`}
              >
                {isLive ? (
                  <Radio className="h-5 w-5 text-destructive" />
                ) : channel.logoUrl ? (
                  <img
                    src={getErsatzTVLogoUrl(channel.id)}
                    alt=""
                    className="h-full w-full object-contain"
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium">
                    {isLive ? (hasLiveChannel ? channel.name : 'Live') : channel.name}
                  </p>
                  {isLive && hasLiveChannel && (
                    <span className="rounded bg-live px-1.5 py-0.5 text-xs font-bold uppercase text-live-foreground">
                      Live
                    </span>
                  )}
                </div>
                <p className="truncate text-sm text-muted-foreground">
                  {isLive ? getLiveProgrammeTitle() : currentProgramme?.title || channel.group}
                </p>
                {/* Progress bar and time remaining for ErsatzTV channels */}
                {!isLive && currentProgramme && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary/60 transition-all duration-300"
                        style={{
                          width: `${calculateProgress(
                            new Date(currentProgramme.start).getTime(),
                            new Date(currentProgramme.stop).getTime(),
                            currentTime
                          )}%`,
                        }}
                      />
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatRemaining(new Date(currentProgramme.stop).getTime(), currentTime)}
                    </span>
                  </div>
                )}
                {/* Always there (except on the empty live slot), so rows
                    don't grow when the schedule arrives */}
                {(!isLive || hasLiveChannel) && (
                  <p className="mt-1 h-4 truncate text-xs leading-4 text-muted-foreground">
                    {next && `Next ${nextTimeFormat.format(next.startMs)} · ${next.programme.title}`}
                  </p>
                )}
              </div>
              {/* Static, so nothing blinks beside the video */}
              {isSelected && (
                <AudioLines
                  className={`h-4 w-4 shrink-0 ${isLive ? 'text-live' : 'text-primary'}`}
                  aria-hidden="true"
                  data-testid="now-playing-indicator"
                />
              )}
            </button>
          )

          if (!showPickLive) return tuneButton

          return (
            <div key={channel.id} className={`flex items-center pr-3 ${cardClassName}`}>
              {tuneButton}
              <Button size="sm" onClick={onPickLive}>
                Pick a channel
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
