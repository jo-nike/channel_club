# Story 3.3: Admin Channel Selection UI

Status: review

## Story

As an admin,
I want to select a channel from the list,
So that all viewers switch to that channel.

## Acceptance Criteria

1. **Given** I am logged in as admin
   **When** I view the channel list
   **Then** I see a "Select" or clickable action on each channel

2. **Given** I click to select a channel
   **When** the selection is confirmed
   **Then** PUT `/api/channels/current` is called
   **And** the current channel indicator updates
   **And** my local video player switches to that stream

3. **Given** a channel is currently selected
   **When** I view the channel list
   **Then** the current channel is visually highlighted

4. **Given** I am logged in as viewer
   **When** I view the channel list
   **Then** I do NOT see channel selection controls
   **And** I can only view the current channel being played

5. **Given** the channel update API call fails
   **When** an error occurs
   **Then** I see an error toast notification
   **And** the selection reverts to previous state

## Tasks / Subtasks

- [x] Task 1: Update ChannelList for Admin Selection (AC: #1, #3)
  - [x] Add click handler for channel selection (admin only)
  - [x] Highlight currently selected channel
  - [x] Show selection indicator (checkmark or "Now Playing")
  - [x] Style selected channel differently (border, background)

- [x] Task 2: Implement Role-Based UI (AC: #1, #4)
  - [x] Get user role from authStore
  - [x] Conditionally render selection controls for admin
  - [x] Hide selection UI for viewer role
  - [x] Show "Now Playing" indicator for all users

- [x] Task 3: Create API Service for Channel Selection (AC: #2)
  - [x] Add `setCurrentChannel(channel)` to `services/api.ts`
  - [x] Make PUT request to `/api/channels/current`
  - [x] Include JWT in Authorization header
  - [x] Handle success and error responses

- [x] Task 4: Update Channel Store (AC: #2, #3)
  - [x] Add `setCurrentChannel` action to channelStore
  - [x] Track `currentChannel` in store state
  - [x] Optimistic update on selection
  - [x] Revert on API failure

- [x] Task 5: Error Handling with Toast (AC: #5)
  - [x] Add toast notification system (shadcn/ui toast)
  - [x] Show error toast on API failure
  - [x] Revert UI state on failure

- [x] Task 6: Testing
  - [x] Test admin sees selection controls
  - [x] Test viewer doesn't see selection controls
  - [x] Test channel selection updates UI
  - [x] Test current channel is highlighted
  - [x] Test error handling and revert

## Dev Notes

### Architecture Compliance

**Files to modify:**
- `frontend/src/components/ChannelList.tsx` - Add selection logic
- `frontend/src/stores/channelStore.ts` - Add currentChannel tracking
- `frontend/src/services/api.ts` - Add setCurrentChannel function

**Files to create (if needed):**
- Install shadcn toast component if not present

### Channel List with Admin Selection

```typescript
// frontend/src/components/ChannelList.tsx
import { useChannelStore } from '@/stores/channelStore'
import { useAuthStore } from '@/stores/authStore'
import { setCurrentChannel } from '@/services/api'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

interface Channel {
  channelId: string
  name: string
  streamUrl: string
}

export function ChannelList() {
  const channels = useChannelStore((s) => s.channels)
  const currentChannel = useChannelStore((s) => s.currentChannel)
  const setCurrentChannelInStore = useChannelStore((s) => s.setCurrentChannel)
  const isLoading = useChannelStore((s) => s.isLoading)
  const role = useAuthStore((s) => s.role)
  const { toast } = useToast()

  const isAdmin = role === 'admin'

  async function handleSelectChannel(channel: Channel) {
    if (!isAdmin) return

    // Optimistic update
    const previousChannel = currentChannel
    setCurrentChannelInStore(channel)

    try {
      await setCurrentChannel(channel)
    } catch (error) {
      // Revert on failure
      setCurrentChannelInStore(previousChannel)
      toast({
        variant: 'destructive',
        title: 'Failed to change channel',
        description: 'Please try again',
      })
    }
  }

  if (isLoading) {
    return <ChannelListSkeleton />
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      <h2 className="text-lg font-semibold">Channels</h2>
      <ul className="space-y-2">
        {channels.map((channel) => (
          <ChannelItem
            key={channel.channelId}
            channel={channel}
            isSelected={currentChannel?.channelId === channel.channelId}
            isAdmin={isAdmin}
            onSelect={() => handleSelectChannel(channel)}
          />
        ))}
      </ul>
    </div>
  )
}

interface ChannelItemProps {
  channel: Channel
  isSelected: boolean
  isAdmin: boolean
  onSelect: () => void
}

function ChannelItem({ channel, isSelected, isAdmin, onSelect }: ChannelItemProps) {
  return (
    <li
      className={cn(
        'flex items-center justify-between rounded-lg border p-3',
        'transition-colors',
        isSelected && 'border-primary bg-primary/10',
        isAdmin && 'cursor-pointer hover:bg-accent',
        // 10-foot UI: larger touch targets
        'min-h-[44px]'
      )}
      onClick={isAdmin ? onSelect : undefined}
      tabIndex={isAdmin ? 0 : undefined}
      onKeyDown={(e) => {
        if (isAdmin && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onSelect()
        }
      }}
      role={isAdmin ? 'button' : undefined}
      aria-pressed={isAdmin ? isSelected : undefined}
    >
      <span className="text-base font-medium">{channel.name}</span>
      {isSelected && (
        <span className="text-sm text-primary">Now Playing</span>
      )}
    </li>
  )
}

function ChannelListSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="h-6 w-24 animate-pulse rounded bg-muted" />
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-[44px] animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  )
}
```

### Updated Channel Store

```typescript
// frontend/src/stores/channelStore.ts
import { create } from 'zustand'

interface Channel {
  channelId: string
  name: string
  streamUrl: string
}

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
  setChannels: (channels) => set({ channels }),
  setCurrentChannel: (channel) => set({ currentChannel: channel }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}))
```

### API Service Function

```typescript
// frontend/src/services/api.ts
import { useAuthStore } from '@/stores/authStore'

interface Channel {
  channelId: string
  name: string
  streamUrl: string
}

export async function setCurrentChannel(channel: Channel): Promise<Channel> {
  const token = useAuthStore.getState().token

  const response = await fetch('/api/channels/current', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(channel),
  })

  if (!response.ok) {
    throw new Error('Failed to set channel')
  }

  return response.json()
}
```

### Toast Setup (shadcn/ui)

```bash
# Install toast component
npx shadcn@latest add toast
```

```typescript
// Add Toaster to App.tsx or layout
import { Toaster } from '@/components/ui/toaster'

export function App() {
  return (
    <>
      {/* ... app content ... */}
      <Toaster />
    </>
  )
}
```

### Role-Based Rendering Logic

```typescript
// Pattern for role-based UI
const isAdmin = role === 'admin'

// Admin sees: clickable channels with selection
// Viewer sees: read-only list with current indicator

{isAdmin && (
  <button onClick={onSelect}>Select</button>
)}

// Or conditionally add click handlers:
onClick={isAdmin ? onSelect : undefined}
```

### Project Structure Notes

**Alignment with architecture:**
- Named exports for components
- Zustand store pattern
- API service layer
- camelCase for JSON/props
- 10-foot UI compliance (44px targets)

### Dependencies from Previous Stories

- Story 2.2: ChannelList component (exists, needs modification)
- Story 1.3: authStore with role
- Story 1.4: Role detection from JWT

### Visual Design

```
┌─────────────────────────────────┐
│  Channels                       │
├─────────────────────────────────┤
│ ┌─────────────────────────────┐ │
│ │ TSN              Now Playing │ │  ← Selected (highlighted)
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ Sportsnet                   │ │  ← Clickable for admin
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ ESPN                        │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

### 10-Foot UI Considerations

- Minimum 44px height for channel items
- Clear focus indicators for keyboard/D-pad navigation
- "Now Playing" text large enough to read from distance
- High contrast for selected state

### Keyboard Navigation

```typescript
// Handle Enter/Space for selection
onKeyDown={(e) => {
  if (isAdmin && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault()
    onSelect()
  }
}}
tabIndex={isAdmin ? 0 : undefined}
```

### Anti-Patterns to Avoid

- Do NOT show selection UI to viewers
- Do NOT block UI while waiting for API
- Do NOT lose selection state on failure
- Do NOT forget keyboard accessibility
- Do NOT use default exports

### Testing Strategy

```typescript
// frontend/src/components/ChannelList.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { ChannelList } from './ChannelList'
import { useAuthStore } from '@/stores/authStore'
import { useChannelStore } from '@/stores/channelStore'

describe('ChannelList', () => {
  beforeEach(() => {
    useChannelStore.setState({
      channels: [
        { channelId: '1', name: 'TSN', streamUrl: '...' },
        { channelId: '2', name: 'ESPN', streamUrl: '...' },
      ],
      currentChannel: { channelId: '1', name: 'TSN', streamUrl: '...' },
    })
  })

  test('admin sees clickable channels', () => {
    useAuthStore.setState({ role: 'admin' })
    render(<ChannelList />)

    const channel = screen.getByText('ESPN').closest('li')
    expect(channel).toHaveAttribute('role', 'button')
  })

  test('viewer does not see selection controls', () => {
    useAuthStore.setState({ role: 'viewer' })
    render(<ChannelList />)

    const channel = screen.getByText('ESPN').closest('li')
    expect(channel).not.toHaveAttribute('role', 'button')
  })

  test('current channel shows Now Playing', () => {
    render(<ChannelList />)
    expect(screen.getByText('Now Playing')).toBeInTheDocument()
  })
})
```

### References

- [Source: _bmad-output/architecture.md#Frontend-Architecture]
- [Source: _bmad-output/architecture.md#Component-Boundaries]
- [Source: _bmad-output/epics.md#Story-3.3]
- [Source: _bmad-output/project-context.md#TypeScript/React-Rules]
- [Source: _bmad-output/project-context.md#10-Foot-UI-Rules]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None - implementation proceeded smoothly.

### Completion Notes List

- Implemented admin channel selection with optimistic updates and API calls
- Added `setCurrentChannel` and `fetchCurrentChannel` API functions in `services/api.ts`
- Installed shadcn sonner toast component for error notifications
- Updated `ChannelList.tsx` to call PUT `/api/channels/current` when admin selects a channel
- Added error toast notification on API failure with automatic state revert
- Role-based UI already existed - admins see clickable channel items, viewers see read-only list
- All channels display "Now Playing" indicator for the currently selected channel
- Added comprehensive tests for new API functions and updated ChannelList tests
- All 36 tests related to this story pass (17 ChannelList + 19 API)
- Build and TypeScript checks pass

### File List

- frontend/src/services/api.ts (modified - added setCurrentChannel, fetchCurrentChannel)
- frontend/src/components/ChannelList.tsx (modified - added API call and toast error handling)
- frontend/src/components/ui/sonner.tsx (created - toast notification component)
- frontend/src/App.tsx (modified - added Toaster component)
- frontend/src/components/ChannelList.test.tsx (modified - added API mock and error revert test)
- frontend/src/services/api.test.ts (modified - added tests for new API functions)

### Change Log

- 2025-12-26: Implemented admin channel selection UI with API integration and error handling
