# Story 7.10: EPG Channel Sidebar

Status: ready-for-dev

## Story

As a user,
I want to see a list of ErsatzTV channels,
so that I can browse and select what to watch.

## Acceptance Criteria

1. **Channel list display**: Sidebar shows all channels with logo, name, and number
2. **Current programme display**: Each channel shows its current programme title
3. **Channel selection**: Clicking a channel selects it and starts playing
4. **Currently playing highlight**: The playing channel is visually highlighted

## Tasks / Subtasks

- [ ] Task 1: Create EPGChannelSidebar component (AC: #1)
  - [ ] Create `src/components/ersatztv/EPGChannelSidebar.tsx`
  - [ ] Render channel list from ersatztvStore
  - [ ] Display channel logo, number, and name
  - [ ] Handle loading and error states
- [ ] Task 2: Display current programme (AC: #2)
  - [ ] Fetch current programme for each visible channel
  - [ ] Display programme title below channel name
  - [ ] Handle missing programme data gracefully
- [ ] Task 3: Implement channel selection (AC: #3)
  - [ ] Handle click events on channel items
  - [ ] Call selectChannel action from store
  - [ ] Update video player with new stream
- [ ] Task 4: Add currently playing highlight (AC: #4)
  - [ ] Compare channel.id with selectedChannel.id
  - [ ] Apply distinct visual styling (border, background)
  - [ ] Ensure 10-foot UI visibility
- [ ] Task 5: Write tests
  - [ ] Test channel list rendering
  - [ ] Test channel selection callback
  - [ ] Test currently playing highlight
  - [ ] Test loading/error states

## Dev Notes

### Architecture Compliance

- **Component location**: `src/components/ersatztv/EPGChannelSidebar.tsx`
- **Named exports**: `export function EPGChannelSidebar()`
- **Styling**: Tailwind CSS, 10-foot UI compliant
- **State**: Use ersatztvStore for channels and selection

### Technical Implementation

**EPGChannelSidebar component** (`src/components/ersatztv/EPGChannelSidebar.tsx`):
```typescript
import { useEffect } from 'react'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { getErsatzTVLogoUrl } from '@/services/ersatztvApi'
import type { ErsatzTVChannel } from '@/types'

interface EPGChannelSidebarProps {
  onChannelSelect?: (channel: ErsatzTVChannel) => void
}

export function EPGChannelSidebar({ onChannelSelect }: EPGChannelSidebarProps) {
  const {
    channels,
    selectedChannel,
    loading,
    error,
    loadChannels,
    selectChannel,
  } = useErsatztvStore()

  useEffect(() => {
    if (channels.length === 0) {
      loadChannels()
    }
  }, [channels.length, loadChannels])

  const handleChannelClick = (channel: ErsatzTVChannel) => {
    selectChannel(channel)
    onChannelSelect?.(channel)
  }

  if (loading && channels.length === 0) {
    return <ChannelSidebarSkeleton />
  }

  if (error && channels.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="text-center">
          <p className="text-destructive">{error}</p>
          <button
            onClick={() => loadChannels()}
            className="mt-2 rounded bg-primary px-4 py-2 text-primary-foreground"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <aside className="h-full w-72 overflow-y-auto border-r bg-card">
      <div className="sticky top-0 border-b bg-card/95 p-4 backdrop-blur">
        <h2 className="text-lg font-semibold">Channels</h2>
      </div>

      <ul className="divide-y">
        {channels.map((channel) => (
          <ChannelItem
            key={channel.id}
            channel={channel}
            isSelected={selectedChannel?.id === channel.id}
            onSelect={handleChannelClick}
          />
        ))}
      </ul>
    </aside>
  )
}

interface ChannelItemProps {
  channel: ErsatzTVChannel
  isSelected: boolean
  onSelect: (channel: ErsatzTVChannel) => void
}

function ChannelItem({ channel, isSelected, onSelect }: ChannelItemProps) {
  return (
    <li>
      <button
        onClick={() => onSelect(channel)}
        className={`
          flex w-full items-center gap-3 p-3 text-left transition-colors
          hover:bg-accent focus:bg-accent focus:outline-none
          focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring
          ${isSelected ? 'bg-primary/10 border-l-4 border-primary' : ''}
        `}
        aria-pressed={isSelected}
      >
        {/* Channel logo */}
        <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded bg-muted">
          <img
            src={getErsatzTVLogoUrl(channel.id)}
            alt=""
            className="h-full w-full object-contain"
            onError={(e) => {
              // Hide broken image
              (e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        </div>

        {/* Channel info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-muted-foreground">
              {channel.number}
            </span>
            <span className="truncate font-medium">{channel.name}</span>
          </div>
          <ChannelCurrentProgramme channelId={channel.id} />
        </div>

        {/* Playing indicator */}
        {isSelected && (
          <div className="flex-shrink-0">
            <span className="inline-flex h-3 w-3 animate-pulse rounded-full bg-primary" />
          </div>
        )}
      </button>
    </li>
  )
}

function ChannelCurrentProgramme({ channelId }: { channelId: string }) {
  // Get current programme from store or fetch on demand
  // For simplicity, use a local fetch with useSWR or useEffect pattern
  const { currentProgramme } = useErsatztvStore()

  // Only show if this is the selected channel's programme
  // For other channels, we'd need per-channel programme state or batch fetch

  return (
    <p className="truncate text-sm text-muted-foreground">
      {/* Placeholder - implement per-channel current programme fetch if needed */}
      Now playing...
    </p>
  )
}

function ChannelSidebarSkeleton() {
  return (
    <aside className="h-full w-72 border-r bg-card">
      <div className="border-b p-4">
        <div className="h-6 w-24 animate-pulse rounded bg-muted" />
      </div>
      <div className="divide-y">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <div className="h-12 w-12 animate-pulse rounded bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
```

### Enhanced Per-Channel Programme Display

If you need current programme for ALL channels (not just selected), implement batch fetching:

```typescript
// In EPGChannelSidebar or a custom hook:
const [channelProgrammes, setChannelProgrammes] = useState<Record<string, string>>({})

useEffect(() => {
  // Fetch current programmes for all channels
  const fetchAllCurrentProgrammes = async () => {
    const results: Record<string, string> = {}
    await Promise.all(
      channels.map(async (channel) => {
        try {
          const data = await fetchErsatzTVCurrentProgramme(channel.id)
          if (data.current) {
            results[channel.id] = data.current.title
          }
        } catch {
          // Ignore individual failures
        }
      })
    )
    setChannelProgrammes(results)
  }

  if (channels.length > 0) {
    fetchAllCurrentProgrammes()
    // Refresh every 5 minutes
    const interval = setInterval(fetchAllCurrentProgrammes, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }
}, [channels])
```

### Project Structure Notes

**New files:**
- `frontend/src/components/ersatztv/EPGChannelSidebar.tsx`
- `frontend/src/components/ersatztv/EPGChannelSidebar.test.tsx`

### 10-Foot UI Compliance

- **Touch targets**: 48px minimum height for channel items (p-3 = 12px padding + content)
- **Focus states**: Visible ring for keyboard navigation
- **High contrast**: Selected state uses primary color with sufficient contrast
- **Large text**: Channel name uses base font size (16px+)

### Testing Requirements

```typescript
// src/components/ersatztv/EPGChannelSidebar.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { EPGChannelSidebar } from './EPGChannelSidebar'
import { useErsatztvStore } from '@/stores/ersatztvStore'

vi.mock('@/stores/ersatztvStore')

describe('EPGChannelSidebar', () => {
  const mockChannels = [
    { id: 'ch1', name: 'Comedy', number: 1, group: 'Movies' },
    { id: 'ch2', name: 'Action', number: 2, group: 'Movies' },
  ]

  beforeEach(() => {
    vi.mocked(useErsatztvStore).mockReturnValue({
      channels: mockChannels,
      selectedChannel: null,
      loading: false,
      error: null,
      loadChannels: vi.fn(),
      selectChannel: vi.fn(),
    })
  })

  it('renders channel list', () => {
    render(<EPGChannelSidebar />)

    expect(screen.getByText('Comedy')).toBeInTheDocument()
    expect(screen.getByText('Action')).toBeInTheDocument()
  })

  it('highlights selected channel', () => {
    vi.mocked(useErsatztvStore).mockReturnValue({
      ...vi.mocked(useErsatztvStore)(),
      selectedChannel: mockChannels[0],
    })

    render(<EPGChannelSidebar />)

    const comedyButton = screen.getByRole('button', { name: /comedy/i })
    expect(comedyButton).toHaveAttribute('aria-pressed', 'true')
  })

  it('calls selectChannel on click', () => {
    const selectChannel = vi.fn()
    vi.mocked(useErsatztvStore).mockReturnValue({
      ...vi.mocked(useErsatztvStore)(),
      selectChannel,
    })

    render(<EPGChannelSidebar />)

    fireEvent.click(screen.getByText('Comedy'))
    expect(selectChannel).toHaveBeenCalledWith(mockChannels[0])
  })

  it('shows loading skeleton', () => {
    vi.mocked(useErsatztvStore).mockReturnValue({
      ...vi.mocked(useErsatztvStore)(),
      channels: [],
      loading: true,
    })

    render(<EPGChannelSidebar />)

    // Skeleton elements should be present
    expect(screen.queryByText('Comedy')).not.toBeInTheDocument()
  })

  it('shows error state with retry button', () => {
    const loadChannels = vi.fn()
    vi.mocked(useErsatztvStore).mockReturnValue({
      ...vi.mocked(useErsatztvStore)(),
      channels: [],
      error: 'Failed to load',
      loadChannels,
    })

    render(<EPGChannelSidebar />)

    expect(screen.getByText('Failed to load')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Retry'))
    expect(loadChannels).toHaveBeenCalled()
  })
})
```

### Anti-Patterns to Avoid

- **DO NOT use default export** - use named export
- **DO NOT fetch channels in every render** - check if already loaded
- **DO NOT hardcode logo URLs** - use `getErsatzTVLogoUrl()` helper
- **DO NOT forget keyboard navigation** - use button elements with proper focus states
- **DO NOT block on programme fetch** - show channel list immediately, load programmes async

### References

- [Source: frontend/src/components/ChannelList.tsx] - Existing channel list pattern
- [Source: frontend/src/stores/ersatztvStore.ts] - Store from story 7-9
- [Source: frontend/src/services/ersatztvApi.ts] - API helpers from story 7-9
- [Source: _bmad-output/project-context.md#10-foot-ui-rules] - UI requirements

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

