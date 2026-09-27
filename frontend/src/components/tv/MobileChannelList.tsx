import { Radio, AudioLines } from 'lucide-react'
import { useProgrammeClock } from '@/hooks/useProgrammeClock'
import { calculateProgress, findOnAir, formatRemaining } from '@/lib/programmes'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore, describeLiveGuide } from '@/stores/tvStore'
import { getErsatzTVLogoUrl } from '@/services/ersatztvApi'
import { Button } from '@/components/ui/button'
import type { ErsatzTVProgramme, UnifiedChannel } from '@/types'

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
  // Shared 30s clock for the current programme, progress and time remaining
  const currentTime = useProgrammeClock()

  const unifiedChannels = getUnifiedChannels()
  const hasLiveChannel = isLiveChannelActive()

  // Helper to get current programme for a channel
  const getCurrentProgramme = (channel: UnifiedChannel): ErsatzTVProgramme | null => {
    if (channel.type === 'live') return null
    const programmes = programmesByChannel[channel.id]
    if (!programmes) return null
    return findOnAir(programmes, currentTime)
  }

  // Helper to get live programme title
  const getLiveProgrammeTitle = (): string => {
    if (liveEPGTitle) return liveEPGTitle
    if (hasLiveChannel) return describeLiveGuide(liveEPGStatus)
    return onPickLive ? 'Nothing on yet' : 'Waiting for someone to put something on'
  }

  return (
    <div className="space-y-2 p-4">
      <h2 className="text-lg font-semibold">Channels</h2>
      <div className="grid grid-cols-1 gap-2">
        {unifiedChannels.map((channel) => {
          const isLive = channel.type === 'live'
          const isSelected = selectedChannel?.id === channel.id
          const currentProgramme = getCurrentProgramme(channel)
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
