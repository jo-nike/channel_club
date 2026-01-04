import { useEffect, useRef, useState, useMemo } from 'react'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { getErsatzTVLogoUrl } from '@/services/ersatztvApi'
import type { ErsatzTVChannel, ErsatzTVProgramme } from '@/types'

// Grid constants
const SLOT_WIDTH = 150 // pixels per 30 minutes
const HOUR_WIDTH = SLOT_WIDTH * 2
const ROW_HEIGHT = 64 // pixels per channel row
const CHANNEL_LABEL_WIDTH = 80
const PROGRAMME_GAP = 3 // pixels between programme boxes

interface EPGGridProps {
  hours?: number // Time window to display (default 6)
  programmesByChannel: Record<string, ErsatzTVProgramme[]> // Passed from parent
  loading?: boolean // Loading state from parent
  onProgrammeClick?: (programme: ErsatzTVProgramme, channel: ErsatzTVChannel) => void
  onChannelClick?: (channel: ErsatzTVChannel) => void
}

export function EPGGrid({
  hours = 6,
  programmesByChannel,
  loading = false,
  onProgrammeClick,
  onChannelClick,
}: EPGGridProps) {
  const { channels } = useErsatztvStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const [currentTime, setCurrentTime] = useState(new Date())

  // Calculate time range - start 30 min before current rounded time
  const startTime = useMemo(() => {
    const now = new Date()
    // Round down to nearest 30 minutes
    now.setMinutes(Math.floor(now.getMinutes() / 30) * 30, 0, 0)
    // Go back 30 minutes to show what's currently playing
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

  if (loading) {
    return <EPGGridSkeleton />
  }

  return (
    <div className="relative overflow-hidden" data-testid="epg-grid">
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
              data-testid="time-slot"
            >
              {formatTime(slot)}
            </div>
          ))}
        </div>
      </div>

      {/* Grid container - no horizontal scroll */}
      <div
        ref={containerRef}
        className="relative overflow-x-hidden overflow-y-hidden"
        style={{ height: channels.length * ROW_HEIGHT }}
        data-testid="grid-container"
      >
        {/* Now marker */}
        {nowMarkerOffset > 0 && nowMarkerOffset < gridWidth && (
          <div
            className="absolute top-0 bottom-0 z-30 w-0.5 bg-primary"
            style={{ left: CHANNEL_LABEL_WIDTH + nowMarkerOffset }}
            data-testid="now-marker"
          >
            <div className="absolute -top-1 -left-1.5 h-3 w-3 rounded-full bg-primary" />
          </div>
        )}

        {/* Channel rows */}
        {channels.map((channel, rowIndex) => (
          <ChannelRow
            key={channel.id}
            channel={channel}
            programmes={programmesByChannel[channel.id] || []}
            startTime={startTime}
            gridWidth={gridWidth}
            rowIndex={rowIndex}
            onProgrammeClick={onProgrammeClick}
            onChannelClick={onChannelClick}
          />
        ))}
      </div>
    </div>
  )
}

interface ChannelRowProps {
  channel: ErsatzTVChannel
  programmes: ErsatzTVProgramme[]
  startTime: Date
  gridWidth: number
  rowIndex: number
  onProgrammeClick?: (programme: ErsatzTVProgramme, channel: ErsatzTVChannel) => void
  onChannelClick?: (channel: ErsatzTVChannel) => void
}

function ChannelRow({
  channel,
  programmes,
  startTime,
  gridWidth,
  rowIndex,
  onProgrammeClick,
  onChannelClick,
}: ChannelRowProps) {
  return (
    <div
      className="absolute left-0 flex"
      style={{ top: rowIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
      data-testid="channel-row"
    >
      {/* Channel label with logo - clickable */}
      <button
        onClick={() => onChannelClick?.(channel)}
        className="sticky left-0 z-10 flex flex-shrink-0 items-center gap-1.5 bg-card px-2 text-sm font-medium border-r hover:bg-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        style={{ width: CHANNEL_LABEL_WIDTH }}
        title={`Switch to ${channel.name}`}
      >
        <img
          src={getErsatzTVLogoUrl(channel.id)}
          alt=""
          className="h-8 w-8 flex-shrink-0 rounded object-contain"
          onError={(e) => {
            ;(e.target as HTMLImageElement).style.display = 'none'
          }}
        />
        <span className="truncate">{channel.number}</span>
      </button>

      {/* Programme boxes */}
      <div className="relative" style={{ width: gridWidth }}>
        {programmes.map((programme) => (
          <ProgrammeBox
            key={programme.id}
            programme={programme}
            channel={channel}
            startTime={startTime}
            onClick={onProgrammeClick}
          />
        ))}
      </div>
    </div>
  )
}

interface ProgrammeBoxProps {
  programme: ErsatzTVProgramme
  channel: ErsatzTVChannel
  startTime: Date
  onClick?: (programme: ErsatzTVProgramme, channel: ErsatzTVChannel) => void
}

function ProgrammeBox({ programme, channel, startTime, onClick }: ProgrammeBoxProps) {
  const progStart = new Date(programme.start)
  const progEnd = new Date(programme.stop)

  const left = calculateTimeOffset(progStart, startTime)
  const width = calculateDurationWidth(progStart, progEnd)

  // Skip if programme ends before grid starts
  if (left + width < 0) return null

  return (
    <button
      className={`
        absolute top-1 bottom-1 overflow-hidden rounded border
        bg-accent text-accent-foreground px-2 py-1 text-left text-sm
        hover:bg-accent/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring
        transition-colors
      `}
      style={{
        left: Math.max(0, left),
        width: Math.max(60, width - (left < 0 ? -left : 0) - PROGRAMME_GAP),
      }}
      onClick={() => onClick?.(programme, channel)}
      data-testid="programme-box"
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
    <div className="animate-pulse" data-testid="epg-grid-skeleton">
      <div className="h-12 bg-muted border-b" />
      <div className="space-y-1 p-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 rounded bg-muted" />
        ))}
      </div>
    </div>
  )
}
