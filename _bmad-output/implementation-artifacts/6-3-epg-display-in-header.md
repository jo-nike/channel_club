# Story 6.3: EPG Display in Header

Status: ready-for-dev

## Story

As a user,
I want to see what's currently playing in the header,
so that I know what program is on without checking a guide.

## Acceptance Criteria

1. **Display format**: Show current program title next to channel name: "Channel Name - Program Title"
2. **No EPG graceful handling**: When no EPG data exists, display only channel name (no error shown)
3. **Channel switch update**: When admin changes channel, EPG info updates to show new channel's program
4. **Loading state**: Brief loading indicator while fetching EPG (optional, can show channel name only during load)

## Tasks / Subtasks

- [ ] Task 1: Create EPG types (AC: #1)
  - [ ] Add EPG types to `frontend/src/types/index.ts`
- [ ] Task 2: Create EPG API function (AC: #1, #3)
  - [ ] Add `fetchNowPlaying(channelId)` to `frontend/src/services/api.ts`
- [ ] Task 3: Create useEPG hook (AC: #1, #2, #3, #4)
  - [ ] Create `frontend/src/hooks/useEPG.ts`
  - [ ] Implement EPG fetching with channel dependency
  - [ ] Handle loading/error states
  - [ ] Re-fetch when channel changes
- [ ] Task 4: Display EPG in header (AC: #1, #2)
  - [ ] Modify MainView.tsx header to show EPG
  - [ ] Format as "Channel Name - Program Title" or just channel name
- [ ] Task 5: Write tests
  - [ ] Create `frontend/src/hooks/useEPG.test.ts`
  - [ ] Update MainView.test.tsx for EPG display

## Dev Notes

### Architecture Compliance

- **Hook pattern**: Follow existing hook patterns in `frontend/src/hooks/`
- **API pattern**: Follow existing API patterns in `frontend/src/services/api.ts`
- **Component modification**: Modify existing MainView.tsx

### Technical Implementation

**Types** (`frontend/src/types/index.ts` additions):
```typescript
export interface Program {
  title: string
  startTime: string  // ISO 8601
  endTime: string    // ISO 8601
  description?: string
}

export interface EPGResponse {
  channelId: string
  currentProgram: Program | null
  nextProgram?: Program | null
}
```

**API function** (`frontend/src/services/api.ts`):
```typescript
export async function fetchNowPlaying(channelId: string): Promise<EPGResponse> {
  const response = await fetch(`${API_URL}/api/epg/now-playing?channel_id=${channelId}`, {
    headers: {
      'Authorization': `Bearer ${getToken()}`,
    },
  })
  if (!response.ok) {
    throw new Error('Failed to fetch EPG')
  }
  return response.json()
}
```

**Hook** (`frontend/src/hooks/useEPG.ts`):
```typescript
import { useState, useEffect } from 'react'
import { useChannelStore } from '@/stores/channelStore'
import { fetchNowPlaying } from '@/services/api'
import type { EPGResponse } from '@/types'

export function useEPG() {
  const currentChannel = useChannelStore((s) => s.currentChannel)
  const [epg, setEPG] = useState<EPGResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!currentChannel?.id) {
      setEPG(null)
      return
    }

    let cancelled = false
    setIsLoading(true)

    fetchNowPlaying(currentChannel.id)
      .then((data) => {
        if (!cancelled) {
          setEPG(data)
          setIsLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEPG(null)
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [currentChannel?.id])

  return { epg, isLoading }
}
```

**Header integration** (MainView.tsx):
```tsx
// Add import
import { useEPG } from '@/hooks/useEPG'

// Inside component
const currentChannel = useChannelStore((s) => s.currentChannel)
const { epg } = useEPG()

// In header display
<span className="text-muted-foreground text-sm truncate max-w-[300px]">
  {currentChannel?.name
    ? epg?.currentProgram?.title
      ? `${currentChannel.name} - ${epg.currentProgram.title}`
      : currentChannel.name
    : 'No channel selected'
  }
</span>
```

### Dependency: Story 6-2

This story depends on Story 6-2 (EPG Backend Service) being completed first. The backend endpoint `/api/epg/now-playing` must exist.

If implementing before 6-2 is done, the hook should gracefully handle 404 errors and show channel name only.

### Key Considerations

1. **No error toast on EPG failure**: EPG is enhancement, not critical. Fail silently.
2. **Re-fetch on channel change**: The `useEffect` dependency on `currentChannel?.id` handles this
3. **Truncation**: Use `truncate` and `max-w-[300px]` to prevent header overflow
4. **Mobile handling**: Consider hiding program title on very small screens with `hidden sm:inline`

### Project Structure Notes

New files:
- `frontend/src/hooks/useEPG.ts`
- `frontend/src/hooks/useEPG.test.ts`

Modified files:
- `frontend/src/types/index.ts` (add EPG types)
- `frontend/src/services/api.ts` (add fetchNowPlaying)
- `frontend/src/components/MainView.tsx` (display EPG)

### Testing Requirements

- Test hook with mocked API
- Test re-fetch on channel change
- Test null/error handling
- Test header display with and without EPG data

### References

- [Source: frontend/src/hooks/useWebSocket.ts] - Existing hook pattern
- [Source: frontend/src/services/api.ts] - Existing API pattern
- [Source: frontend/src/components/MainView.tsx#79-111] - Header to modify
- [Source: _bmad-output/architecture.md#Post-Implementation-Updates] - EPG response format

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
