import { useEffect, useState } from 'react'
import { Radio, AudioLines } from 'lucide-react'
import { calculateProgress, formatRemaining } from '@/lib/programmes'
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
  const [currentTime, setCurrentTime] = useState(() => Date.now())

  const unifiedChannels = getUnifiedChannels()
  const hasLiveChannel = isLiveChannelActive()

  // Update current time every 30 seconds for time remaining calculations
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(Date.now()), 30 * 1000)
    return () => clearInterval(interval)
  }, [])

  // Helper to get current programme for a channel
  const getCurrentProgramme = (channel: UnifiedChannel): ErsatzTVProgramme | undefined => {
    if (channel.type === 'live') return undefined
    const programmes = programmesByChannel[channel.id]
    if (!programmes) return undefined
    const now = new Date()
    return programmes.find(
      (p) => new Date(p.start) <= now && new Date(p.stop) > now
    )
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
          const currentProgramme = getCurrentProgramme(channel)
          const cardClassName = `
            rounded-lg border
            ${selectedChannel?.id === channel.id ? 'border-primary bg-primary/10' : ''}
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
                flex items-center gap-3 p-3 text-left
                transition-colors hover:bg-accent
                ${showPickLive ? 'min-w-0 flex-1 rounded-lg' : cardClassName}
              `}
            >
              <div
                className={`h-12 w-12 flex-shrink-0 overflow-hidden rounded flex items-center justify-center ${
                  isLive ? 'bg-destructive/20' : 'bg-muted'
                }`}
              >
                {isLive ? (
                  hasLiveChannel ? (
                    <Radio className="h-6 w-6 text-destructive" />
                  ) : (
                    <span className="text-xs font-bold text-destructive">0</span>
                  )
                ) : channel.logoUrl ? (
                  <img
                    src={getErsatzTVLogoUrl(channel.id)}
                    alt=""
                    className="h-full w-full object-contain"
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                ) : (
                  <span className="text-sm font-medium">{channel.number}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium">
                    {isLive ? (hasLiveChannel ? channel.name : 'Live') : channel.name}
                  </p>
                  {isLive && hasLiveChannel && (
                    <span className="rounded bg-live px-1.5 py-0.5 text-[10px] font-bold uppercase text-live-foreground">
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
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {formatRemaining(new Date(currentProgramme.stop).getTime(), currentTime)}
                    </span>
                  </div>
                )}
              </div>
              {/* Static, so nothing blinks beside the video */}
              {selectedChannel?.id === channel.id && (
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
