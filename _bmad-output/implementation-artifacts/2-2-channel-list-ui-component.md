# Story 2.2: Channel List UI Component

Status: review

## Story

As a user,
I want to see a list of available channels,
So that I can know what's available to watch.

## Acceptance Criteria

1. **Given** I am logged in
   **When** the main view loads
   **Then** I see a channel list fetched from `/api/channels`
   **And** each channel displays its name
   **And** loading state shows while fetching

2. **Given** I am logged in as admin
   **When** I view the channel list
   **Then** I see each channel as clickable/selectable
   **And** the currently selected channel is visually highlighted

3. **Given** I am logged in as viewer
   **When** I view the channel list
   **Then** I see the channel list as read-only (info only)
   **And** I can see which channel is currently playing

4. **Given** the channel fetch fails
   **When** the error is caught
   **Then** I see an error message "Unable to load channels"
   **And** a retry button is available

5. **Given** no channels are available
   **When** the API returns an empty array
   **Then** I see "No channels available" message

## Tasks / Subtasks

- [x] Task 1: Add Channel API Function (AC: #1, #4)
  - [x] Add `fetchChannels()` to frontend/src/services/api.ts
  - [x] Use fetchWithAuth helper for authenticated request
  - [x] Return typed Channel[] array
  - [x] Add API tests

- [x] Task 2: Expand Channel Store (AC: #1, #2, #3)
  - [x] Update frontend/src/stores/channelStore.ts
  - [x] Add `channels: Channel[]` state
  - [x] Add `isLoading: boolean` state
  - [x] Add `error: string | null` state
  - [x] Add `setChannels`, `setLoading`, `setError` actions
  - [x] Keep existing currentChannel logic
  - [x] Add store tests

- [x] Task 3: Implement ChannelList Component (AC: #1, #2, #3, #4, #5)
  - [x] Update frontend/src/components/ChannelList.tsx
  - [x] Fetch channels on mount using useEffect
  - [x] Display loading skeleton while fetching
  - [x] Map channels to list items with name display
  - [x] Highlight current channel with visual indicator
  - [x] Show clickable state for admin users (from authStore)
  - [x] Display error state with retry button
  - [x] Display empty state message
  - [x] Add component tests

- [x] Task 4: Add shadcn/ui Components
  - [x] Add skeleton component for loading state
  - [x] Add scroll-area for channel list overflow
  - [x] Style with Tailwind for 10-foot UI readiness (large text, focus states)

- [x] Task 5: Integrate with MainView
  - [x] Ensure ChannelList is rendered in MainView
  - [x] Verify channel list displays after login

## Dev Notes

### Architecture Compliance

**Component Location:** `frontend/src/components/ChannelList.tsx`
- Named export: `export function ChannelList()`
- Uses Zustand stores for state: useAuthStore, useChannelStore
- Uses api.ts for data fetching

**State Management:**
- channelStore holds channel list state
- authStore provides role for admin/viewer distinction
- No local useState for data that should be in stores

### API Function Implementation

```typescript
// frontend/src/services/api.ts (additions)
import type { Channel } from '@/types'

export async function fetchChannels(): Promise<Channel[]> {
  const response = await fetchWithAuth('/channels')

  if (!response.ok) {
    if (response.status === 503) {
      throw new Error('Channel service unavailable')
    }
    throw new Error('Failed to fetch channels')
  }

  return response.json()
}
```

### Channel Store Expansion

```typescript
// frontend/src/stores/channelStore.ts
import { create } from 'zustand'
import type { Channel } from '@/types'

interface ChannelState {
  channels: Channel[]
  currentChannel: Channel | null
  isLoading: boolean
  error: string | null
  setChannels: (channels: Channel[]) => void
  setCurrentChannel: (channel: Channel | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useChannelStore = create<ChannelState>((set) => ({
  channels: [],
  currentChannel: null,
  isLoading: false,
  error: null,
  setChannels: (channels) => set({ channels, error: null }),
  setCurrentChannel: (currentChannel) => set({ currentChannel }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error, isLoading: false }),
}))
```

**Note:** currentChannel changes from `string | null` to `Channel | null` for richer data.

### ChannelList Component Implementation

```typescript
// frontend/src/components/ChannelList.tsx
import { useEffect } from 'react'
import { useChannelStore } from '@/stores/channelStore'
import { useAuthStore } from '@/stores/authStore'
import { fetchChannels } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Channel } from '@/types'

export function ChannelList() {
  const { channels, currentChannel, isLoading, error, setChannels, setLoading, setError } = useChannelStore()
  const { role } = useAuthStore()
  const isAdmin = role === 'admin'

  useEffect(() => {
    loadChannels()
  }, [])

  async function loadChannels() {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchChannels()
      setChannels(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load channels')
    } finally {
      setLoading(false)
    }
  }

  if (isLoading) {
    return <ChannelListSkeleton />
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 p-4">
        <p className="text-destructive">{error}</p>
        <Button onClick={loadChannels}>Retry</Button>
      </div>
    )
  }

  if (channels.length === 0) {
    return (
      <div className="flex items-center justify-center p-4">
        <p className="text-muted-foreground">No channels available</p>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-2 p-4">
        {channels.map((channel) => (
          <ChannelItem
            key={channel.id}
            channel={channel}
            isSelected={currentChannel?.id === channel.id}
            isAdmin={isAdmin}
          />
        ))}
      </div>
    </ScrollArea>
  )
}

function ChannelItem({
  channel,
  isSelected,
  isAdmin
}: {
  channel: Channel
  isSelected: boolean
  isAdmin: boolean
}) {
  const setCurrentChannel = useChannelStore((s) => s.setCurrentChannel)

  // Keyboard accessible - admin can select
  function handleSelect() {
    if (isAdmin) {
      setCurrentChannel(channel)
      // Note: Story 3.3 will add API call to broadcast channel change
    }
  }

  return (
    <div
      role={isAdmin ? 'button' : undefined}
      tabIndex={isAdmin ? 0 : undefined}
      onClick={isAdmin ? handleSelect : undefined}
      onKeyDown={isAdmin ? (e) => e.key === 'Enter' && handleSelect() : undefined}
      className={cn(
        'flex items-center gap-3 rounded-lg border p-4 transition-colors',
        'text-lg', // 10-foot UI: larger text
        'min-h-[56px]', // 10-foot UI: larger touch target
        isSelected && 'border-primary bg-primary/10',
        isAdmin && 'cursor-pointer hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring',
        !isAdmin && 'cursor-default'
      )}
    >
      <span className="font-medium">{channel.name}</span>
      {isSelected && (
        <span className="ml-auto text-sm text-primary">Now Playing</span>
      )}
    </div>
  )
}

function ChannelListSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  )
}
```

### shadcn/ui Components to Add

```bash
cd frontend
npx shadcn@latest add skeleton scroll-area
```

### Types Update

The Channel type already exists in `types/index.ts`:
```typescript
export interface Channel {
  id: string
  name: string
  streamUrl: string
}
```

### 10-Foot UI Considerations

- Minimum text size: 18px (text-lg = 18px, increase to text-xl for TV mode later)
- Minimum touch target: 56px (min-h-[56px])
- Clear focus states: focus:ring-2
- High contrast: use primary colors for selected state
- Keyboard navigation: tabIndex and onKeyDown handlers

### Project Structure Notes

**Files to modify:**
- `frontend/src/services/api.ts` - ADD fetchChannels function
- `frontend/src/stores/channelStore.ts` - REPLACE with expanded store
- `frontend/src/components/ChannelList.tsx` - REPLACE with full implementation

**Files to create:**
- `frontend/src/components/ChannelList.test.tsx` - Component tests
- `frontend/src/stores/channelStore.test.ts` - Store tests (update existing)

**shadcn/ui components to add:**
- `frontend/src/components/ui/skeleton.tsx`
- `frontend/src/components/ui/scroll-area.tsx`

### Testing Strategy

**Unit Tests:**
- channelStore: verify all state actions
- fetchChannels: mock fetch, verify response handling

**Component Tests:**
- Loading state renders skeletons
- Channels render after successful fetch
- Error state renders with retry button
- Empty state shows message
- Admin sees clickable items
- Viewer sees read-only items
- Current channel shows "Now Playing" badge
- Keyboard navigation works for admin

### Previous Story Intelligence

From Story 1.3 (Login UI):
- Use similar patterns for loading/error states
- Follow same component structure with named exports
- Test patterns established in LoginForm.test.tsx

### Anti-Patterns to Avoid

- Do NOT use default exports for components
- Do NOT fetch data outside of useEffect
- Do NOT store UI-only state (loading, error) in component - use store
- Do NOT hardcode channel data
- Do NOT skip keyboard accessibility for admin actions

### References

- [Source: _bmad-output/architecture.md#Frontend-Architecture]
- [Source: _bmad-output/architecture.md#Component-Boundaries]
- [Source: _bmad-output/epics.md#Story-2.2]
- [Source: _bmad-output/project-context.md#TypeScript/React-Rules]
- [Source: _bmad-output/project-context.md#10-Foot-UI-Rules]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

N/A - No blocking issues encountered.

### Completion Notes List

- **Task 1:** Added `fetchChannels()` function to api.ts with proper error handling for 503 and generic failures. Uses `fetchWithAuth` for authenticated requests.
- **Task 2:** Expanded channelStore to include `channels[]`, `isLoading`, `error` state with actions. Changed `currentChannel` type from `string | null` to `Channel | null` for richer data.
- **Task 3:** Implemented full ChannelList component with loading skeleton, error retry, empty state, admin click/keyboard selection, viewer read-only view, and "Now Playing" indicator.
- **Task 4:** Added shadcn/ui Skeleton and ScrollArea components. Applied 10-foot UI styling (text-lg, min-h-[56px], focus rings).
- **Task 5:** Integrated ChannelList into MainView sidebar for both admin and viewer roles. Admin sees "Channel Selection" header, viewer sees "Channels" header.

### Change Log

- 2024-12-24: Implemented Story 2.2 - Channel List UI Component
  - Added fetchChannels API function with authenticated requests
  - Expanded channelStore with channels, loading, error state
  - Implemented ChannelList component with all acceptance criteria
  - Added shadcn/ui skeleton and scroll-area components
  - Integrated ChannelList into MainView for all authenticated users
  - Added comprehensive test coverage (88 tests passing)

### File List

**Modified:**
- frontend/src/services/api.ts - Added fetchChannels function and Channel type import
- frontend/src/stores/channelStore.ts - Expanded with channels[], isLoading, error, and typed currentChannel
- frontend/src/components/ChannelList.tsx - Full implementation with loading/error/empty states
- frontend/src/components/MainView.tsx - Integrated ChannelList in sidebar for all users
- frontend/src/components/MainView.test.tsx - Updated tests for new integration

**Created:**
- frontend/src/stores/channelStore.test.ts - 13 unit tests for expanded store
- frontend/src/components/ChannelList.test.tsx - 15 component tests
- frontend/src/components/ui/skeleton.tsx - shadcn/ui skeleton component
- frontend/src/components/ui/scroll-area.tsx - shadcn/ui scroll-area component

