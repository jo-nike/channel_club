import { useEffect, useRef, useState, useMemo } from 'react'
import { Radio } from 'lucide-react'
import { useTVStore, LIVE_CHANNEL_ID } from '@/stores/tvStore'
import { getErsatzTVLogoUrl } from '@/services/ersatztvApi'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { UnifiedChannel, ErsatzTVProgramme, EPGResponse } from '@/types'

// Grid constants
const SLOT_WIDTH = 150 // pixels per 30 minutes
const HOUR_WIDTH = SLOT_WIDTH * 2
const ROW_HEIGHT = 64 // pixels per channel row
const CHANNEL_LABEL_WIDTH = 80
const PROGRAMME_GAP = 3 // pixels between programme boxes

interface TVEPGGridProps {
  hours?: number
  programmesByChannel: Record<string, ErsatzTVProgramme[]>
  loading?: boolean
  liveEPG?: EPGResponse | null
  onProgrammeClick?: (programme: ErsatzTVProgramme, channel: UnifiedChannel) => void
  onChannelClick?: (channel: UnifiedChannel) => void
}

export function TVEPGGrid({
  hours = 6,
  programmesByChannel,
  loading = false,
  liveEPG,
  onProgrammeClick,
  onChannelClick,
}: TVEPGGridProps) {
  const { getUnifiedChannels, isLiveChannelActive } = useTVStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const [currentTime, setCurrentTime] = useState(new Date())

  const unifiedChannels = getUnifiedChannels()
  const hasLiveChannel = isLiveChannelActive()

  // Calculate time range - start 30 min before current rounded time
  const startTime = useMemo(() => {
    const now = new Date()
    now.setMinutes(Math.floor(now.getMinutes() / 30) * 30, 0, 0)
    now.setMinutes(now.getMinutes() - 30)
    return now
  }, [])

  const endTime = useMemo(() => {
    const end = new Date(startTime)
    end.setHours(end.getHours() + hours)
    return end
  }, [startTime, hours])

  const gridWidth = hours * HOUR_WIDTH

  // Generate time slots for header
  const timeSlots = useMemo(() => {
    const slots: Date[] = []
    const current = new Date(startTime)
    while (current < endTime) {
      slots.push(new Date(current))
      current.setMinutes(current.getMinutes() + 30)
    }
    return slots
  }, [startTime, endTime])

  // Update current time every minute for now marker
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date())
    }, 60000)
    return () => clearInterval(interval)
  }, [])

  // Auto-scroll to current time on load
  useEffect(() => {
    if (containerRef.current && !loading && Object.keys(programmesByChannel).length > 0) {
      const nowOffset = calculateTimeOffset(new Date(), startTime)
      containerRef.current.scrollLeft = Math.max(0, nowOffset - 100)
    }
  }, [loading, startTime, programmesByChannel])

  // Calculate now marker position
  const nowMarkerOffset = useMemo(() => {
    return calculateTimeOffset(currentTime, startTime)
  }, [currentTime, startTime])

  // Convert live EPG to programme format for display (current only, no next)
  const liveProgrammes = useMemo(() => {
    if (!liveEPG?.currentProgram) return []

    return [
      {
        id: 'live-current',
        channelId: LIVE_CHANNEL_ID,
        title: liveEPG.currentProgram.title,
        description: liveEPG.currentProgram.description,
        start: liveEPG.currentProgram.startTime,
        stop: liveEPG.currentProgram.endTime,
      },
    ]
  }, [liveEPG])

  if (loading) {
    return <EPGGridSkeleton />
  }

  return (
    <div className="relative overflow-hidden" data-testid="tv-epg-grid">
      {/* Time header */}
      <div className="sticky top-0 z-20 bg-card border-b">
        <div
          className="flex"
          style={{ width: gridWidth, marginLeft: CHANNEL_LABEL_WIDTH }}
        >
          {timeSlots.map((slot, i) => (
            <div
              key={i}
              className="flex-shrink-0 border-l px-2 py-2 text-sm text-muted-foreground"
              style={{ width: SLOT_WIDTH }}
            >
              {formatTime(slot)}
            </div>
          ))}
        </div>
      </div>

      {/* Grid container */}
      <div
        ref={containerRef}
        className="relative overflow-x-hidden overflow-y-hidden"
        style={{ height: unifiedChannels.length * ROW_HEIGHT }}
      >
        {/* Now marker */}
        {nowMarkerOffset > 0 && nowMarkerOffset < gridWidth && (
          <div
            className="absolute top-0 bottom-0 z-30 w-0.5 bg-destructive"
            style={{ left: CHANNEL_LABEL_WIDTH + nowMarkerOffset }}
          >
            <div className="absolute -top-1 -left-1.5 h-3 w-3 rounded-full bg-destructive" />
          </div>
        )}

        {/* Channel rows */}
        {unifiedChannels.map((channel, rowIndex) => (
          <ChannelRow
            key={channel.id}
            channel={channel}
            programmes={
              channel.type === 'live'
                ? liveProgrammes
                : programmesByChannel[channel.id] || []
            }
            startTime={startTime}
            gridWidth={gridWidth}
            rowIndex={rowIndex}
            hasLiveChannel={hasLiveChannel}
            onProgrammeClick={onProgrammeClick}
            onChannelClick={onChannelClick}
          />
        ))}
      </div>
    </div>
  )
}

interface ChannelRowProps {
  channel: UnifiedChannel
  programmes: ErsatzTVProgramme[]
  startTime: Date
  gridWidth: number
  rowIndex: number
  hasLiveChannel: boolean
  onProgrammeClick?: (programme: ErsatzTVProgramme, channel: UnifiedChannel) => void
  onChannelClick?: (channel: UnifiedChannel) => void
}

function ChannelRow({
  channel,
  programmes,
  startTime,
  gridWidth,
  rowIndex,
  hasLiveChannel,
  onProgrammeClick,
  onChannelClick,
}: ChannelRowProps) {
  const isLive = channel.type === 'live'

  // Only show red background when live channel has active broadcast
  const showLiveHighlight = isLive && hasLiveChannel

  return (
    <div
      className={`absolute left-0 flex ${showLiveHighlight ? 'bg-destructive/5' : ''}`}
      style={{ top: rowIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
      data-testid="channel-row"
    >
      {/* Channel label with logo - clickable */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => onChannelClick?.(channel)}
            className={`sticky left-0 z-20 flex flex-shrink-0 items-center gap-1.5 px-2 text-sm font-medium border-r hover:bg-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
              showLiveHighlight ? 'bg-rose-50 dark:bg-rose-950' : 'bg-card'
            }`}
            style={{ width: CHANNEL_LABEL_WIDTH }}
          >
            {isLive ? (
              <div className="h-8 w-8 flex-shrink-0 rounded bg-destructive/20 flex items-center justify-center">
                <Radio className="h-4 w-4 text-destructive" />
              </div>
            ) : channel.logoUrl ? (
              <img
                src={getErsatzTVLogoUrl(channel.id)}
                alt=""
                className="h-8 w-8 flex-shrink-0 rounded object-contain"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            ) : (
              <div className="h-8 w-8 flex-shrink-0 rounded bg-muted" />
            )}
            <span className="truncate">{channel.number}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Switch to {channel.name}</p>
        </TooltipContent>
      </Tooltip>

      {/* Programme boxes */}
      <div className="relative" style={{ width: gridWidth }}>
        {isLive && !hasLiveChannel ? (
          // Placeholder for live channel when no broadcast - position at ~1 hour mark
          <div
            className="absolute top-1 bottom-1 flex items-center z-0"
            style={{ left: SLOT_WIDTH * 2 }}
          >
            <div className="rounded border border-dashed border-muted-foreground/30 bg-card px-4 py-2 text-sm text-muted-foreground whitespace-nowrap">
              No broadcast scheduled
            </div>
          </div>
        ) : (
          programmes.map((programme) => (
            <ProgrammeBox
              key={programme.id}
              programme={programme}
              channel={channel}
              startTime={startTime}
              isLive={isLive}
              onClick={onProgrammeClick}
            />
          ))
        )}
      </div>
    </div>
  )
}

interface ProgrammeBoxProps {
  programme: ErsatzTVProgramme
  channel: UnifiedChannel
  startTime: Date
  isLive: boolean
  onClick?: (programme: ErsatzTVProgramme, channel: UnifiedChannel) => void
}

function ProgrammeBox({
  programme,
  channel,
  startTime,
  isLive,
  onClick,
}: ProgrammeBoxProps) {
  const progStart = new Date(programme.start)
  const progEnd = new Date(programme.stop)

  const left = calculateTimeOffset(progStart, startTime)
  const width = calculateDurationWidth(progStart, progEnd)

  // Skip if programme ends before grid starts
  if (left + width < 0) return null

  // Calculate if the programme is clipped (started before grid start)
  const isClipped = left < 0
  const visualLeft = Math.max(0, left)
  const visualWidth = Math.max(60, width - (isClipped ? -left : 0) - PROGRAMME_GAP)

  return (
    <button
      className={`
        absolute top-1 bottom-1 z-0 overflow-hidden rounded border
        px-2 py-1 text-sm flex flex-col justify-center
        hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring
        transition-colors
        ${
          isLive
            ? 'bg-destructive/20 text-destructive-foreground border-destructive/30'
            : 'bg-accent text-accent-foreground'
        }
        ${isClipped ? 'text-right' : 'text-left'}
      `}
      style={{
        left: visualLeft,
        width: visualWidth,
      }}
      onClick={() => onClick?.(programme, channel)}
    >
      <p className="truncate font-medium">{programme.title}</p>
      <p className="truncate text-xs opacity-75">
        {formatTime(progStart)} - {formatTime(progEnd)}
      </p>
    </button>
  )
}

// Helper functions
function calculateTimeOffset(time: Date, startTime: Date): number {
  const diffMinutes = (time.getTime() - startTime.getTime()) / (1000 * 60)
  return (diffMinutes / 30) * SLOT_WIDTH
}

function calculateDurationWidth(start: Date, end: Date): number {
  const diffMinutes = (end.getTime() - start.getTime()) / (1000 * 60)
  return (diffMinutes / 30) * SLOT_WIDTH
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function EPGGridSkeleton() {
  return (
    <div className="animate-pulse rounded-t-lg overflow-hidden">
      <div className="h-12 bg-muted border-b" />
      <div className="space-y-1 p-2">
        {/* Live channel row skeleton */}
        <div className="h-16 rounded bg-destructive/10" />
        {/* Regular channel row skeletons */}
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 rounded bg-muted" />
        ))}
      </div>
    </div>
  )
}
