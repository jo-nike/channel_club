# Story 7.13: ErsatzTV Main View

Status: review

## Story

As a user,
I want a complete ErsatzTV viewing experience,
so that I can browse and watch movie channels.

## Acceptance Criteria

1. **Header with navigation**: View shows header with navigation back to live TV
2. **HLS video player**: View includes the HLS video player component
3. **EPG grid display**: View shows the EPG grid below the video
4. **Auto-refresh**: Programme data automatically refreshes every 5 minutes
5. **Desktop layout**: Desktop shows EPG grid in full-width format
6. **Mobile layout**: Mobile shows a mobile-optimized card layout

## Tasks / Subtasks

- [x] Task 1: Create ErsatzTVView main component (AC: #1, #2, #3)
  - [x] Replace placeholder from story 7-7 with full implementation
  - [x] Create `src/components/ersatztv/ErsatzTVView.tsx`
  - [x] Add header with "Back to Live TV" navigation link
  - [x] Integrate HLSVideoPlayer component
  - [x] Integrate EPGGrid component
- [x] Task 2: Wire up state management
  - [x] Load channels on mount via ersatztvStore
  - [x] Handle channel selection from grid/sidebar
  - [x] Pass selected channel's stream URL to player
- [x] Task 3: Implement auto-refresh (AC: #4)
  - [x] Set up 5-minute interval for programme data refresh
  - [x] Clear interval on component unmount
  - [x] Handle refresh errors gracefully
- [x] Task 4: Implement responsive layouts (AC: #5, #6)
  - [x] Desktop: EPG grid below video
  - [x] Mobile: Card-based channel list with current programme
  - [x] Use media query or CSS breakpoints
- [x] Task 5: Integrate programme modal
  - [x] Handle programme clicks from EPGGrid
  - [x] Open ProgrammeDetailsModal with selected programme
  - [x] Handle "Watch" action to switch channel
- [x] Task 6: Write tests
  - [x] Test component renders with all sub-components
  - [x] Test channel selection updates player
  - [x] Test navigation link works
  - [x] Test responsive layout switching

## Dev Notes

### Architecture Compliance

- **Component location**: `src/components/ersatztv/ErsatzTVView.tsx`
- **Named exports**: `export function ErsatzTVView()`
- **Routing**: Served at `/ersatztv` route (from story 7-7)
- **State**: Uses ersatztvStore for all ErsatzTV data

### Technical Implementation

**ErsatzTVView component** (`src/components/ersatztv/ErsatzTVView.tsx`):
```typescript
import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { getErsatzTVStreamUrl } from '@/services/ersatztvApi'
import { HLSVideoPlayer } from '@/components/ersatztv/HLSVideoPlayer'
import { EPGGrid } from '@/components/ersatztv/EPGGrid'
import { EPGChannelSidebar } from '@/components/ersatztv/EPGChannelSidebar'
import { ProgrammeDetailsModal } from '@/components/ersatztv/ProgrammeDetailsModal'
import { Button } from '@/components/ui/button'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import type { ErsatzTVProgramme, ErsatzTVChannel } from '@/types'

// Refresh interval for programme data (5 minutes)
const REFRESH_INTERVAL = 5 * 60 * 1000

export function ErsatzTVView() {
  const {
    channels,
    selectedChannel,
    loading,
    error,
    loadChannels,
    selectChannel,
    loadProgrammes,
  } = useErsatztvStore()

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedProgramme, setSelectedProgramme] = useState<ErsatzTVProgramme | null>(null)
  const [modalChannel, setModalChannel] = useState<ErsatzTVChannel | null>(null)

  // Responsive
  const isMobile = useMediaQuery('(max-width: 768px)')

  // Stream URL for current channel
  const streamUrl = selectedChannel
    ? getErsatzTVStreamUrl(selectedChannel.id)
    : null

  // Load channels on mount
  useEffect(() => {
    loadChannels()
  }, [loadChannels])

  // Auto-select first channel when loaded
  useEffect(() => {
    if (channels.length > 0 && !selectedChannel) {
      selectChannel(channels[0])
    }
  }, [channels, selectedChannel, selectChannel])

  // Auto-refresh programme data
  useEffect(() => {
    const refreshProgrammes = () => {
      if (selectedChannel) {
        loadProgrammes(selectedChannel.id)
      }
    }

    const interval = setInterval(refreshProgrammes, REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [selectedChannel, loadProgrammes])

  // Handle programme click from grid
  const handleProgrammeClick = useCallback((
    programme: ErsatzTVProgramme,
    channel: ErsatzTVChannel
  ) => {
    setSelectedProgramme(programme)
    setModalChannel(channel)
    setModalOpen(true)
  }, [])

  // Handle watch from modal
  const handleWatch = useCallback((channel: ErsatzTVChannel) => {
    selectChannel(channel)
    setModalOpen(false)
  }, [selectChannel])

  // Handle channel selection from sidebar
  const handleChannelSelect = useCallback((channel: ErsatzTVChannel) => {
    selectChannel(channel)
  }, [selectChannel])

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between border-b bg-card px-4 py-2">
        <div className="flex items-center gap-4">
          <Link to="/">
            <Button variant="ghost" size="sm">
              ← Live TV
            </Button>
          </Link>
          <h1 className="text-lg font-semibold">Movie Channels</h1>
        </div>

        {/* Current channel indicator */}
        {selectedChannel && (
          <div className="text-sm text-muted-foreground">
            Now watching: <span className="font-medium">{selectedChannel.name}</span>
          </div>
        )}
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Desktop: Sidebar */}
        {!isMobile && (
          <EPGChannelSidebar onChannelSelect={handleChannelSelect} />
        )}

        {/* Content area */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {/* Video player */}
          <div className="relative aspect-video w-full flex-shrink-0 bg-black">
            {streamUrl ? (
              <HLSVideoPlayer
                streamUrl={streamUrl}
                title={selectedChannel?.name}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-muted-foreground">
                  {loading ? 'Loading channels...' : 'Select a channel to start watching'}
                </p>
              </div>
            )}
          </div>

          {/* EPG section */}
          <div className="flex-1 overflow-y-auto">
            {isMobile ? (
              <MobileChannelList
                channels={channels}
                selectedChannel={selectedChannel}
                onChannelSelect={handleChannelSelect}
              />
            ) : (
              <EPGGrid
                hours={6}
                onProgrammeClick={handleProgrammeClick}
              />
            )}
          </div>
        </main>
      </div>

      {/* Programme details modal */}
      <ProgrammeDetailsModal
        programme={selectedProgramme}
        channel={modalChannel}
        open={modalOpen}
        onOpenChange={setModalOpen}
        onWatch={handleWatch}
      />

      {/* Error toast */}
      {error && (
        <div className="fixed bottom-4 right-4 rounded-lg bg-destructive px-4 py-2 text-destructive-foreground">
          {error}
        </div>
      )}
    </div>
  )
}

// Mobile card layout
interface MobileChannelListProps {
  channels: ErsatzTVChannel[]
  selectedChannel: ErsatzTVChannel | null
  onChannelSelect: (channel: ErsatzTVChannel) => void
}

function MobileChannelList({
  channels,
  selectedChannel,
  onChannelSelect,
}: MobileChannelListProps) {
  return (
    <div className="space-y-2 p-4">
      <h2 className="text-lg font-semibold">Channels</h2>
      <div className="grid grid-cols-1 gap-2">
        {channels.map((channel) => (
          <button
            key={channel.id}
            onClick={() => onChannelSelect(channel)}
            className={`
              flex items-center gap-3 rounded-lg border p-3 text-left
              transition-colors hover:bg-accent
              ${selectedChannel?.id === channel.id ? 'border-primary bg-primary/10' : ''}
            `}
          >
            <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded bg-muted">
              <img
                src={`/api/ersatztv/logos/${channel.id}`}
                alt=""
                className="h-full w-full object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{channel.name}</p>
              <p className="text-sm text-muted-foreground">{channel.group}</p>
            </div>
            {selectedChannel?.id === channel.id && (
              <span className="h-3 w-3 animate-pulse rounded-full bg-primary" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
```

### useMediaQuery Hook (if not exists)

Create `src/hooks/useMediaQuery.ts`:
```typescript
import { useState, useEffect } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches
  )

  useEffect(() => {
    const mediaQuery = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)

    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [query])

  return matches
}
```

### Layout Structure

```
┌────────────────────────────────────────────────────┐
│  ← Live TV     Movie Channels     Now: Comedy Ch. │  Header
├────────────┬───────────────────────────────────────┤
│            │                                       │
│  Sidebar   │         HLS Video Player              │
│  (Channels)│         (16:9 aspect ratio)           │
│            │                                       │
├────────────┼───────────────────────────────────────┤
│            │                                       │
│            │         EPG Grid                      │
│            │         (scrollable)                  │
│            │                                       │
└────────────┴───────────────────────────────────────┘

Mobile:
┌──────────────────────────┐
│  ← Live TV  Movie Ch.    │
├──────────────────────────┤
│                          │
│     HLS Video Player     │
│                          │
├──────────────────────────┤
│     Channel Cards        │
│     (scrollable list)    │
│                          │
└──────────────────────────┘
```

### Project Structure Notes

**New files:**
- `frontend/src/components/ersatztv/ErsatzTVView.tsx` (replace placeholder)
- `frontend/src/components/ersatztv/ErsatzTVView.test.tsx`
- `frontend/src/hooks/useMediaQuery.ts` (if not exists)

**Integration with existing:**
- Uses HLSVideoPlayer from story 7-8
- Uses EPGGrid from story 7-11
- Uses EPGChannelSidebar from story 7-10
- Uses ProgrammeDetailsModal from story 7-12
- Uses ersatztvStore from story 7-9
- Routes configured in story 7-7

### Component Dependencies

```
ErsatzTVView
├── HLSVideoPlayer (7-8)
├── EPGChannelSidebar (7-10)
├── EPGGrid (7-11)
├── ProgrammeDetailsModal (7-12)
├── ersatztvStore (7-9)
└── ersatztvApi (7-9)
```

### Testing Requirements

```typescript
// src/components/ersatztv/ErsatzTVView.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ErsatzTVView } from './ErsatzTVView'

vi.mock('@/stores/ersatztvStore')
vi.mock('@/services/ersatztvApi')
vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: () => false, // Desktop by default
}))
vi.mock('./HLSVideoPlayer', () => ({
  HLSVideoPlayer: () => <div data-testid="hls-player" />,
}))
vi.mock('./EPGGrid', () => ({
  EPGGrid: () => <div data-testid="epg-grid" />,
}))
vi.mock('./EPGChannelSidebar', () => ({
  EPGChannelSidebar: () => <div data-testid="channel-sidebar" />,
}))

describe('ErsatzTVView', () => {
  beforeEach(() => {
    vi.mocked(useErsatztvStore).mockReturnValue({
      channels: [{ id: 'ch1', name: 'Test Channel', number: 1 }],
      selectedChannel: { id: 'ch1', name: 'Test Channel' },
      loading: false,
      error: null,
      loadChannels: vi.fn(),
      selectChannel: vi.fn(),
      loadProgrammes: vi.fn(),
    })
  })

  it('renders header with navigation', () => {
    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    expect(screen.getByText('← Live TV')).toBeInTheDocument()
    expect(screen.getByText('Movie Channels')).toBeInTheDocument()
  })

  it('renders video player', () => {
    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    expect(screen.getByTestId('hls-player')).toBeInTheDocument()
  })

  it('renders EPG grid on desktop', () => {
    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    expect(screen.getByTestId('epg-grid')).toBeInTheDocument()
  })

  it('renders channel sidebar on desktop', () => {
    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    expect(screen.getByTestId('channel-sidebar')).toBeInTheDocument()
  })

  it('loads channels on mount', () => {
    const loadChannels = vi.fn()
    vi.mocked(useErsatztvStore).mockReturnValue({
      ...vi.mocked(useErsatztvStore)(),
      loadChannels,
    })

    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    expect(loadChannels).toHaveBeenCalled()
  })

  it('shows current channel in header', () => {
    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    expect(screen.getByText(/Now watching:/)).toBeInTheDocument()
    expect(screen.getByText('Test Channel')).toBeInTheDocument()
  })

  it('shows error message when error exists', () => {
    vi.mocked(useErsatztvStore).mockReturnValue({
      ...vi.mocked(useErsatztvStore)(),
      error: 'Failed to load',
    })

    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    expect(screen.getByText('Failed to load')).toBeInTheDocument()
  })
})
```

### Anti-Patterns to Avoid

- **DO NOT use default export** - use named export
- **DO NOT fetch on every render** - use useEffect with proper deps
- **DO NOT forget cleanup** - clear intervals on unmount
- **DO NOT hardcode stream URLs** - use getErsatzTVStreamUrl helper
- **DO NOT duplicate state** - use ersatztvStore as single source of truth
- **DO NOT forget responsive design** - implement both desktop and mobile layouts

### References

- [Source: frontend/src/components/MainView.tsx] - Existing main view pattern
- [Source: frontend/src/components/ersatztv/HLSVideoPlayer.tsx] - Player from 7-8
- [Source: frontend/src/components/ersatztv/EPGGrid.tsx] - Grid from 7-11
- [Source: frontend/src/components/ersatztv/EPGChannelSidebar.tsx] - Sidebar from 7-10
- [Source: frontend/src/stores/ersatztvStore.ts] - Store from 7-9
- [Source: _bmad-output/project-context.md] - Component patterns

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

N/A - No debug issues encountered.

### Completion Notes List

- ✅ Implemented full ErsatzTVView component replacing placeholder from story 7-7
- ✅ Created useMediaQuery hook using useSyncExternalStore for proper SSR support
- ✅ Header with "← Live TV" navigation link to root route
- ✅ Integrated HLSVideoPlayer component with dynamic stream URL based on selected channel
- ✅ Integrated EPGGrid component for desktop layout with programme click handling
- ✅ Integrated EPGChannelSidebar for desktop channel navigation
- ✅ Integrated ProgrammeDetailsModal for programme details and "Watch Now" action
- ✅ Implemented 5-minute auto-refresh interval with proper cleanup on unmount
- ✅ Desktop layout: sidebar + video player + EPG grid
- ✅ Mobile layout: video player + card-based channel list (no EPG grid/sidebar)
- ✅ Used ersatztvStore as single source of truth for state management
- ✅ Auto-selects first channel when channels are loaded
- ✅ Error toast displayed when errors occur
- ✅ All 436 tests pass including 19 new ErsatzTVView tests and 5 useMediaQuery tests
- ✅ Updated router tests to expect new component content instead of placeholder

### File List

**New files:**
- frontend/src/hooks/useMediaQuery.ts
- frontend/src/hooks/useMediaQuery.test.ts

**Modified files:**
- frontend/src/components/ersatztv/ErsatzTVView.tsx (replaced placeholder with full implementation)
- frontend/src/components/ersatztv/ErsatzTVView.test.tsx (updated with comprehensive tests)
- frontend/src/router.test.tsx (updated expectations for new ErsatzTVView content)

## Change Log

| Date | Change |
|------|--------|
| 2026-01-03 | Story implementation complete - all tasks/subtasks finished, 436 tests pass |
