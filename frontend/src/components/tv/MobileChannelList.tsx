import { Radio, AudioLines, ChevronDown } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { useProgrammeClock } from '@/hooks/useProgrammeClock'
import { buildProgrammeIndex, findCurrentAndNext, findInRange, type CurrentAndNext } from '@/lib/programmeIndex'
import { calculateProgress, formatRemaining } from '@/lib/programmes'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore, buildUnifiedChannels, describeLiveGuide, LIVE_CHANNEL_ID } from '@/stores/tvStore'
import { useChannelStore } from '@/stores/channelStore'
import { Button } from '@/components/ui/button'
import { LivePill } from '@/components/LivePill'
import { ChannelLogo } from '@/components/ChannelLogo'
import { ChannelPresenceStack } from '@/components/tv/ChannelPresenceStack'
import { usePresenceByChannel } from '@/hooks/usePresenceByChannel'
import { cn } from '@/lib/utils'
import type { ErsatzTVProgramme, UnifiedChannel } from '@/types'

// Created once: the Next lines and schedules format times on every tick
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

const NOTHING_ON: CurrentAndNext = { current: null, next: null }

// How many programmes an expanded row lists, starting with the one on now
const SCHEDULE_LENGTH = 4

// Mobile card layout
interface MobileChannelListProps {
  onChannelSelect: (channel: UnifiedChannel) => void
  // A programme tapped in an expanded row's schedule
  onProgrammeClick: (programme: ErsatzTVProgramme, channel: UnifiedChannel) => void
  liveEPGTitle?: string | null
  // Opens the Live TV switcher; only for people allowed to change live TV
  onPickLive?: () => void
}

export function MobileChannelList({
  onChannelSelect,
  onProgrammeClick,
  liveEPGTitle,
  onPickLive,
}: MobileChannelListProps) {
  // Field selectors: the list re-renders for what it shows, not on every
  // update to the stores it reads
  const ersatzTVChannels = useErsatztvStore((s) => s.channels)
  const programmesByChannel = useErsatztvStore((s) => s.programmesByChannel)
  const selectedChannel = useTVStore((s) => s.selectedChannel)
  const liveEPGStatus = useTVStore((s) => s.liveEPGStatus)
  const liveChannel = useChannelStore((s) => s.currentChannel)
  // The live channel's schedule, for the live row's Next line and schedule
  const liveProgrammes = useTVStore((s) => s.liveProgrammes)
  // Shared 30s clock for the current programme, progress and time remaining
  const currentTime = useProgrammeClock()

  // One row at a time shows its schedule
  const [expandedChannelId, setExpandedChannelId] = useState<string | null>(null)
  const scheduleIdPrefix = useId()

  // The unified list, built from the two stores it comes from, so the live
  // slot follows live TV
  const unifiedChannels = useMemo(
    () => buildUnifiedChannels(liveChannel, ersatzTVChannels),
    [liveChannel, ersatzTVChannels]
  )
  const hasLiveChannel = liveChannel !== null
  // Who else is on each card; empty unless this viewer sees channels
  const presenceByChannel = usePresenceByChannel()

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
  // The expanded row's programmes that haven't ended, from the one on now
  const getSchedule = (channel: UnifiedChannel) =>
    findInRange(
      channel.type === 'live' ? liveProgrammeIndex : programmeIndex,
      channel.id,
      currentTime,
      Infinity
    ).slice(0, SCHEDULE_LENGTH)

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
        {unifiedChannels.map((channel, index) => {
          const isLive = channel.type === 'live'
          const isSelected = selectedChannel?.id === channel.id
          const { current, next } = getNowAndNext(channel)
          // The live row's title comes from the now-playing lookup instead
          const currentProgramme = isLive ? null : current?.programme
          // One background: the live tint wins (the border marks selection),
          // then selection
          const cardClassName = cn(
            'rounded-lg border',
            isSelected && 'border-primary',
            isLive ? 'bg-live/5' : isSelected && 'bg-primary/10'
          )
          // The empty live slot offers the picker next to the tune button
          // (a sibling, since buttons can't nest)
          const showPickLive = isLive && !hasLiveChannel && !!onPickLive
          // Every row has a schedule to show but the empty live slot
          const canExpand = !isLive || hasLiveChannel
          const isExpanded = canExpand && expandedChannelId === channel.id
          const scheduleId = `${scheduleIdPrefix}schedule-${index}`
          const channelName = isLive && !hasLiveChannel ? 'Live' : channel.name
          // The people on the channel, but never on the empty live slot
          const people = hasLiveChannel || !isLive ? presenceByChannel.get(channel.id) : undefined

          const tuneButton = (
            <button
              onClick={() => onChannelSelect(channel)}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-accent"
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
              {/* The logo, or the live slot's icon while it has none */}
              <ChannelLogo
                channel={channel}
                className={cn('rounded', isLive && 'bg-live/20')}
                fallback={isLive ? <Radio className="h-5 w-5 text-live" /> : undefined}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium">
                    {isLive ? (hasLiveChannel ? channel.name : 'Live') : channel.name}
                  </p>
                  {isLive && hasLiveChannel && <LivePill />}
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
                    {next && `Next ${timeFormat.format(next.startMs)} · ${next.programme.title}`}
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

          // The tune button, the people on the channel, the picker and the
          // chevron are siblings, since buttons can't nest: tapping the
          // chevron never tunes
          return (
            <div key={channel.id} className={cardClassName}>
              <div className={cn('flex items-center', showPickLive && 'pr-3')}>
                {tuneButton}
                {people && people.length > 0 && (
                  <ChannelPresenceStack
                    people={people}
                    channelName={channelName}
                    isWatching={isSelected}
                    onJoin={() => onChannelSelect(channel)}
                    // A 44px touch target
                    className="h-11 px-1.5"
                  />
                )}
                {showPickLive && (
                  <Button size="sm" onClick={onPickLive}>
                    Pick a channel
                  </Button>
                )}
                {canExpand && (
                  <button
                    type="button"
                    onClick={() => setExpandedChannelId(isExpanded ? null : channel.id)}
                    aria-expanded={isExpanded}
                    aria-controls={scheduleId}
                    aria-label={`Show schedule for ${channelName}`}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent"
                  >
                    <ChevronDown
                      className={cn('h-5 w-5 transition-transform', isExpanded && 'rotate-180')}
                      aria-hidden="true"
                    />
                  </button>
                )}
              </div>
              {isExpanded && (
                <ChannelSchedule
                  id={scheduleId}
                  channelName={channelName}
                  schedule={getSchedule(channel)}
                  onProgrammeClick={(programme) => onProgrammeClick(programme, channel)}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface ChannelScheduleProps {
  id: string
  channelName: string
  schedule: readonly { programme: ErsatzTVProgramme; startMs: number }[]
  onProgrammeClick: (programme: ErsatzTVProgramme) => void
}

// An expanded row's upcoming programmes; each opens its details
function ChannelSchedule({ id, channelName, schedule, onProgrammeClick }: ChannelScheduleProps) {
  if (schedule.length === 0) {
    return (
      <p id={id} className="border-t px-3 py-2 text-sm text-muted-foreground">
        No schedule to show
      </p>
    )
  }

  return (
    <ul id={id} aria-label={`Schedule for ${channelName}`} className="border-t p-1">
      {schedule.map(({ programme, startMs }) => (
        <li key={programme.id}>
          <button
            type="button"
            onClick={() => onProgrammeClick(programme)}
            // The time and title are separate boxes with no space between
            aria-label={`${timeFormat.format(startMs)} ${programme.title}`}
            className="flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent"
          >
            <span className="min-w-12 shrink-0 font-display font-bold tabular-nums text-muted-foreground">
              {timeFormat.format(startMs)}
            </span>
            <span className="min-w-0 truncate">{programme.title}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
