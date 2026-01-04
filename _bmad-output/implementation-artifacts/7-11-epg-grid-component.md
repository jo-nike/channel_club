# Story 7.11: EPG Grid Component

Status: ready-for-dev

## Story

As a user,
I want to see an EPG grid of all programmes,
so that I can see what's on now and coming up.

## Acceptance Criteria

1. **Time header**: Grid shows time slots in 30-minute intervals across the header
2. **Channel rows**: Grid shows channel rows with programmes positioned by time
3. **Now marker**: A "now" marker line is visible at the current time position
4. **Horizontal scroll**: Grid scrolls horizontally to show future programmes
5. **Programme click**: Clicking a programme box opens the programme details modal

## Tasks / Subtasks

- [ ] Task 1: Create EPGGrid container component (AC: #1, #2)
  - [ ] Create `src/components/ersatztv/EPGGrid.tsx`
  - [ ] Implement time header with 30-minute slots
  - [ ] Render channel rows from ersatztvStore
  - [ ] Calculate programme box widths based on duration
- [ ] Task 2: Implement now marker (AC: #3)
  - [ ] Calculate current time position in grid
  - [ ] Render vertical line at current time
  - [ ] Update marker position every minute
- [ ] Task 3: Enable horizontal scrolling (AC: #4)
  - [ ] Add overflow-x-auto to grid container
  - [ ] Set appropriate grid width based on time range
  - [ ] Auto-scroll to current time on load
- [ ] Task 4: Implement programme click handler (AC: #5)
  - [ ] Add onClick to programme boxes
  - [ ] Pass selected programme to parent via callback
  - [ ] Parent will open modal (story 7-12)
- [ ] Task 5: Fetch programme data for grid
  - [ ] Load programmes for all channels on mount
  - [ ] Set time window (default 6 hours)
  - [ ] Handle loading and error states
- [ ] Task 6: Write tests
  - [ ] Test time header rendering
  - [ ] Test programme box positioning
  - [ ] Test now marker updates
  - [ ] Test programme click callback

## Dev Notes

### Architecture Compliance

- **Component location**: `src/components/ersatztv/EPGGrid.tsx`
- **Named exports**: `export function EPGGrid()`
- **Styling**: Tailwind CSS, responsive design
- **State**: Use ersatztvStore for channels, local state for grid-specific data

### Technical Implementation

**EPGGrid component** (`src/components/ersatztv/EPGGrid.tsx`):
```typescript
import { useEffect, useRef, useState, useMemo } from 'react'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { fetchErsatzTVProgrammes } from '@/services/ersatztvApi'
import type { ErsatzTVChannel, ErsatzTVProgramme } from '@/types'

// Grid constants
const SLOT_WIDTH = 150 // pixels per 30 minutes
const HOUR_WIDTH = SLOT_WIDTH * 2
const ROW_HEIGHT = 64 // pixels per channel row
const HEADER_HEIGHT = 48

interface EPGGridProps {
  hours?: number // Time window to display (default 6)
  onProgrammeClick?: (programme: ErsatzTVProgramme, channel: ErsatzTVChannel) => void
}

export function EPGGrid({ hours = 6, onProgrammeClick }: EPGGridProps) {
  const { channels, loadChannels } = useErsatztvStore()
  const [programmesByChannel, setProgrammesByChannel] = useState<
    Record<string, ErsatzTVProgramme[]>
  >({})
  const [loading, setLoading] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const [currentTime, setCurrentTime] = useState(new Date())

  // Calculate time range
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

  // Generate time slots
  const timeSlots = useMemo(() => {
    const slots: Date[] = []
    const current = new Date(startTime)
    while (current < endTime) {
      slots.push(new Date(current))
      current.setMinutes(current.getMinutes() + 30)
    }
    return slots
  }, [startTime, endTime])

  // Load channels and programmes
  useEffect(() => {
    const loadData = async () => {
      setLoading(true)

      if (channels.length === 0) {
        await loadChannels()
      }

      // Fetch programmes for all channels
      const programmeData: Record<string, ErsatzTVProgramme[]> = {}
      await Promise.all(
        channels.map(async (channel) => {
          try {
            const data = await fetchErsatzTVProgrammes(channel.id, hours)
            programmeData[channel.id] = data.programmes
          } catch {
            programmeData[channel.id] = []
          }
        })
      )
      setProgrammesByChannel(programmeData)
      setLoading(false)
    }

    loadData()
  }, [channels, hours, loadChannels])

  // Update current time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date())
    }, 60000)
    return () => clearInterval(interval)
  }, [])

  // Auto-scroll to current time
  useEffect(() => {
    if (containerRef.current && !loading) {
      const nowOffset = calculateTimeOffset(new Date(), startTime)
      containerRef.current.scrollLeft = Math.max(0, nowOffset - 100)
    }
  }, [loading, startTime])

  // Calculate now marker position
  const nowMarkerOffset = useMemo(() => {
    return calculateTimeOffset(currentTime, startTime)
  }, [currentTime, startTime])

  if (loading) {
    return <EPGGridSkeleton />
  }

  return (
    <div className="relative overflow-hidden">
      {/* Time header */}
      <div className="sticky top-0 z-20 bg-card">
        <div
          className="flex"
          style={{ width: gridWidth, marginLeft: 80 }} // 80px for channel column
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
        className="relative overflow-x-auto overflow-y-hidden"
        style={{ height: channels.length * ROW_HEIGHT }}
      >
        {/* Now marker */}
        {nowMarkerOffset > 0 && nowMarkerOffset < gridWidth && (
          <div
            className="absolute top-0 bottom-0 z-30 w-0.5 bg-primary"
            style={{ left: 80 + nowMarkerOffset }}
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
}

function ChannelRow({
  channel,
  programmes,
  startTime,
  gridWidth,
  rowIndex,
  onProgrammeClick,
}: ChannelRowProps) {
  return (
    <div
      className="absolute left-0 flex"
      style={{ top: rowIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
    >
      {/* Channel label */}
      <div className="sticky left-0 z-10 flex w-20 flex-shrink-0 items-center bg-card px-2 text-sm font-medium">
        {channel.number}
      </div>

      {/* Programme boxes */}
      <div
        className="relative"
        style={{ width: gridWidth }}
      >
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

  // Skip if programme ends before grid starts or starts after grid
  if (left + width < 0) return null

  return (
    <button
      className={`
        absolute top-1 bottom-1 overflow-hidden rounded border
        bg-accent px-2 py-1 text-left text-sm
        hover:bg-accent/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring
        transition-colors
      `}
      style={{
        left: Math.max(0, left),
        width: Math.max(60, width - (left < 0 ? -left : 0)),
      }}
      onClick={() => onClick?.(programme, channel)}
    >
      <p className="truncate font-medium">{programme.title}</p>
      <p className="truncate text-xs text-muted-foreground">
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
    <div className="animate-pulse">
      <div className="h-12 bg-muted" />
      <div className="space-y-1 p-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 rounded bg-muted" />
        ))}
      </div>
    </div>
  )
}
```

### Responsive Considerations

For mobile, consider a simplified card view instead of grid:
```typescript
// Use media query to switch views
const isMobile = useMediaQuery('(max-width: 768px)')

return isMobile ? <EPGMobileCardView /> : <EPGGrid />
```

### Project Structure Notes

**New files:**
- `frontend/src/components/ersatztv/EPGGrid.tsx`
- `frontend/src/components/ersatztv/EPGGrid.test.tsx`

### Performance Considerations

- **Virtualization**: For many channels, consider react-window or react-virtualized
- **Batch fetching**: Fetch all channel programmes in parallel
- **Memoization**: Use useMemo for expensive calculations (time slots, positions)

### Testing Requirements

```typescript
// src/components/ersatztv/EPGGrid.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { EPGGrid } from './EPGGrid'

vi.mock('@/stores/ersatztvStore')
vi.mock('@/services/ersatztvApi')

describe('EPGGrid', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-03T12:00:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders time slots in 30-minute intervals', async () => {
    render(<EPGGrid />)

    // Should show multiple time slots
    expect(screen.getByText('12:00')).toBeInTheDocument()
    expect(screen.getByText('12:30')).toBeInTheDocument()
    expect(screen.getByText('13:00')).toBeInTheDocument()
  })

  it('renders channel rows with programmes', async () => {
    vi.mocked(useErsatztvStore).mockReturnValue({
      channels: [{ id: 'ch1', name: 'Test', number: 1 }],
      loadChannels: vi.fn(),
    })

    vi.mocked(fetchErsatzTVProgrammes).mockResolvedValue({
      channelId: 'ch1',
      programmes: [
        {
          id: 'p1',
          channelId: 'ch1',
          title: 'Movie Title',
          start: '2026-01-03T12:00:00Z',
          stop: '2026-01-03T14:00:00Z',
        },
      ],
    })

    render(<EPGGrid />)

    await screen.findByText('Movie Title')
  })

  it('shows now marker at current time', async () => {
    render(<EPGGrid />)

    // Now marker should exist (has specific styling)
    const nowMarker = document.querySelector('[class*="bg-primary"]')
    expect(nowMarker).toBeInTheDocument()
  })

  it('calls onProgrammeClick when programme is clicked', async () => {
    const onProgrammeClick = vi.fn()

    render(<EPGGrid onProgrammeClick={onProgrammeClick} />)

    await screen.findByText('Movie Title')
    fireEvent.click(screen.getByText('Movie Title'))

    expect(onProgrammeClick).toHaveBeenCalled()
  })

  it('supports horizontal scrolling', async () => {
    const { container } = render(<EPGGrid hours={12} />)

    const scrollContainer = container.querySelector('[class*="overflow-x-auto"]')
    expect(scrollContainer).toBeInTheDocument()
  })
})
```

### Anti-Patterns to Avoid

- **DO NOT use default export** - use named export
- **DO NOT fetch programmes on every render** - fetch on mount and cache
- **DO NOT hardcode time calculations** - use helper functions
- **DO NOT forget timezone handling** - work with UTC from API, display in local time
- **DO NOT block grid render** - show skeleton while loading

### References

- [Source: frontend/src/stores/ersatztvStore.ts] - Store from story 7-9
- [Source: frontend/src/services/ersatztvApi.ts] - API service from story 7-9
- [Source: frontend/src/types/index.ts] - ErsatzTV types
- [Source: _bmad-output/project-context.md] - Component patterns

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

