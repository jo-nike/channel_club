# Story 7.9: ErsatzTV Store & API Service

Status: ready-for-dev

## Story

As a frontend developer,
I want Zustand store and API service for ErsatzTV,
so that components can access ErsatzTV data.

## Acceptance Criteria

1. **Zustand store state**: `ersatztvStore` provides: channels, selectedChannel, programmes, loading, error
2. **API service - fetchChannels**: `fetchChannels()` fetches from `/api/ersatztv/channels` with auth token
3. **API service - getStreamUrl**: `getStreamUrl(channelId)` returns the proxied HLS manifest URL

## Tasks / Subtasks

- [ ] Task 1: Create ErsatzTV types (AC: #1, #2, #3)
  - [ ] Add `ErsatzTVChannel` interface to `src/types/index.ts`
  - [ ] Add `ErsatzTVProgramme` interface
  - [ ] Add `ErsatzTVCurrentResponse` interface
- [ ] Task 2: Create ersatztvApi service (AC: #2, #3)
  - [ ] Create `src/services/ersatztvApi.ts`
  - [ ] Implement `fetchChannels()` function
  - [ ] Implement `fetchProgrammes(channelId, hours)` function
  - [ ] Implement `fetchCurrentProgramme(channelId)` function
  - [ ] Implement `getStreamUrl(channelId)` helper function
  - [ ] Implement `getLogoUrl(channelId)` helper function
- [ ] Task 3: Create ersatztvStore (AC: #1)
  - [ ] Create `src/stores/ersatztvStore.ts`
  - [ ] Define state: channels, selectedChannel, programmes, loading, error
  - [ ] Implement loadChannels action
  - [ ] Implement selectChannel action
  - [ ] Implement loadProgrammes action
- [ ] Task 4: Write tests
  - [ ] Test API service functions with mocked fetch
  - [ ] Test store state changes
  - [ ] Test error handling

## Dev Notes

### Architecture Compliance

- **Store location**: `src/stores/ersatztvStore.ts`
- **API service location**: `src/services/ersatztvApi.ts`
- **Types location**: `src/types/index.ts`
- **Naming**: camelCase for files, hook pattern for store (`useErsatztvStore`)
- **Authentication**: All API calls use `fetchWithAuth` from existing api.ts

### Technical Implementation

**Types** (add to `src/types/index.ts`):
```typescript
// ErsatzTV types
export interface ErsatzTVChannel {
  id: string
  name: string
  streamUrl: string       // Original stream URL (not used directly)
  logoUrl: string         // Proxied logo URL
  number: number
  group: string
}

export interface ErsatzTVProgramme {
  id: string
  channelId: string
  title: string
  description?: string
  start: string           // ISO 8601
  stop: string            // ISO 8601
  category?: string[]
}

export interface ErsatzTVChannelsResponse {
  channels: ErsatzTVChannel[]
}

export interface ErsatzTVCurrentResponse {
  channelId: string
  current: ErsatzTVProgramme | null
  nextUp: ErsatzTVProgramme | null
}

export interface ErsatzTVProgrammesResponse {
  channelId: string
  programmes: ErsatzTVProgramme[]
}
```

**API Service** (`src/services/ersatztvApi.ts`):
```typescript
import { fetchWithAuth } from '@/services/api'
import type {
  ErsatzTVChannel,
  ErsatzTVChannelsResponse,
  ErsatzTVCurrentResponse,
  ErsatzTVProgrammesResponse,
} from '@/types'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

export async function fetchErsatzTVChannels(): Promise<ErsatzTVChannel[]> {
  const response = await fetchWithAuth('/ersatztv/channels')

  if (!response.ok) {
    if (response.status === 503) {
      throw new Error('ErsatzTV service unavailable')
    }
    throw new Error('Failed to fetch channels')
  }

  const data: ErsatzTVChannelsResponse = await response.json()
  return data.channels
}

export async function fetchErsatzTVProgrammes(
  channelId: string,
  hours: number = 6
): Promise<ErsatzTVProgrammesResponse> {
  const response = await fetchWithAuth(
    `/ersatztv/programmes/${channelId}?hours=${hours}`
  )

  if (!response.ok) {
    throw new Error('Failed to fetch programmes')
  }

  return response.json()
}

export async function fetchErsatzTVCurrentProgramme(
  channelId: string
): Promise<ErsatzTVCurrentResponse> {
  const response = await fetchWithAuth(`/ersatztv/current/${channelId}`)

  if (!response.ok) {
    throw new Error('Failed to fetch current programme')
  }

  return response.json()
}

export function getErsatzTVStreamUrl(channelId: string): string {
  const token = localStorage.getItem('token')
  // Return proxied stream URL with auth
  return `${API_URL}/ersatztv/stream/${channelId}?token=${token}`
}

export function getErsatzTVLogoUrl(channelId: string): string {
  return `${API_URL}/ersatztv/logos/${channelId}`
}
```

**Zustand Store** (`src/stores/ersatztvStore.ts`):
```typescript
import { create } from 'zustand'
import type { ErsatzTVChannel, ErsatzTVProgramme } from '@/types'
import {
  fetchErsatzTVChannels,
  fetchErsatzTVProgrammes,
  fetchErsatzTVCurrentProgramme,
} from '@/services/ersatztvApi'

interface ErsatztvState {
  // State
  channels: ErsatzTVChannel[]
  selectedChannel: ErsatzTVChannel | null
  programmes: ErsatzTVProgramme[]
  currentProgramme: ErsatzTVProgramme | null
  nextProgramme: ErsatzTVProgramme | null
  loading: boolean
  error: string | null

  // Actions
  loadChannels: () => Promise<void>
  selectChannel: (channel: ErsatzTVChannel) => void
  loadProgrammes: (channelId: string, hours?: number) => Promise<void>
  loadCurrentProgramme: (channelId: string) => Promise<void>
  clearError: () => void
}

export const useErsatztvStore = create<ErsatztvState>((set, get) => ({
  // Initial state
  channels: [],
  selectedChannel: null,
  programmes: [],
  currentProgramme: null,
  nextProgramme: null,
  loading: false,
  error: null,

  // Actions
  loadChannels: async () => {
    set({ loading: true, error: null })
    try {
      const channels = await fetchErsatzTVChannels()
      set({ channels, loading: false })
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load channels',
        loading: false,
      })
    }
  },

  selectChannel: (channel: ErsatzTVChannel) => {
    set({ selectedChannel: channel })
    // Optionally auto-load current programme
    get().loadCurrentProgramme(channel.id)
  },

  loadProgrammes: async (channelId: string, hours: number = 6) => {
    set({ loading: true, error: null })
    try {
      const data = await fetchErsatzTVProgrammes(channelId, hours)
      set({ programmes: data.programmes, loading: false })
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load programmes',
        loading: false,
      })
    }
  },

  loadCurrentProgramme: async (channelId: string) => {
    try {
      const data = await fetchErsatzTVCurrentProgramme(channelId)
      set({
        currentProgramme: data.current,
        nextProgramme: data.nextUp,
      })
    } catch {
      // Silent fail for current programme - not critical
      set({ currentProgramme: null, nextProgramme: null })
    }
  },

  clearError: () => set({ error: null }),
}))
```

### Usage Pattern

```typescript
// In component:
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { getErsatzTVStreamUrl } from '@/services/ersatztvApi'

export function ErsatzTVView() {
  const {
    channels,
    selectedChannel,
    loading,
    error,
    loadChannels,
    selectChannel,
  } = useErsatztvStore()

  useEffect(() => {
    loadChannels()
  }, [loadChannels])

  const streamUrl = selectedChannel
    ? getErsatzTVStreamUrl(selectedChannel.id)
    : null

  return (
    // ... render with streamUrl
  )
}
```

### Project Structure Notes

**New files:**
- `frontend/src/services/ersatztvApi.ts`
- `frontend/src/services/ersatztvApi.test.ts`
- `frontend/src/stores/ersatztvStore.ts`
- `frontend/src/stores/ersatztvStore.test.ts`

**Modified files:**
- `frontend/src/types/index.ts` - add ErsatzTV types

### Testing Requirements

**API Service Tests** (`src/services/ersatztvApi.test.ts`):
```typescript
import { fetchErsatzTVChannels, getErsatzTVStreamUrl } from './ersatztvApi'

// Mock fetchWithAuth
vi.mock('@/services/api', () => ({
  fetchWithAuth: vi.fn(),
}))

describe('ersatztvApi', () => {
  describe('fetchErsatzTVChannels', () => {
    it('returns channels on success', async () => {
      const mockChannels = [{ id: 'ch1', name: 'Test' }]
      vi.mocked(fetchWithAuth).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ channels: mockChannels }),
      } as Response)

      const result = await fetchErsatzTVChannels()
      expect(result).toEqual(mockChannels)
    })

    it('throws on 503 service unavailable', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue({
        ok: false,
        status: 503,
      } as Response)

      await expect(fetchErsatzTVChannels()).rejects.toThrow('ErsatzTV service unavailable')
    })
  })

  describe('getErsatzTVStreamUrl', () => {
    it('returns proxied URL with token', () => {
      localStorage.setItem('token', 'test-token')
      const url = getErsatzTVStreamUrl('channel-1')
      expect(url).toContain('/ersatztv/stream/channel-1')
      expect(url).toContain('token=test-token')
    })
  })
})
```

**Store Tests** (`src/stores/ersatztvStore.test.ts`):
```typescript
import { act } from '@testing-library/react'
import { useErsatztvStore } from './ersatztvStore'

vi.mock('@/services/ersatztvApi', () => ({
  fetchErsatzTVChannels: vi.fn(),
  fetchErsatzTVProgrammes: vi.fn(),
  fetchErsatzTVCurrentProgramme: vi.fn(),
}))

describe('ersatztvStore', () => {
  beforeEach(() => {
    useErsatztvStore.setState({
      channels: [],
      selectedChannel: null,
      programmes: [],
      loading: false,
      error: null,
    })
  })

  it('loads channels successfully', async () => {
    const mockChannels = [{ id: 'ch1', name: 'Test', streamUrl: 'http://test' }]
    vi.mocked(fetchErsatzTVChannels).mockResolvedValue(mockChannels)

    await act(async () => {
      await useErsatztvStore.getState().loadChannels()
    })

    expect(useErsatztvStore.getState().channels).toEqual(mockChannels)
    expect(useErsatztvStore.getState().loading).toBe(false)
  })

  it('sets error on channel load failure', async () => {
    vi.mocked(fetchErsatzTVChannels).mockRejectedValue(new Error('Network error'))

    await act(async () => {
      await useErsatztvStore.getState().loadChannels()
    })

    expect(useErsatztvStore.getState().error).toBe('Network error')
  })

  it('selects channel and updates state', () => {
    const channel = { id: 'ch1', name: 'Test' } as ErsatzTVChannel

    act(() => {
      useErsatztvStore.getState().selectChannel(channel)
    })

    expect(useErsatztvStore.getState().selectedChannel).toEqual(channel)
  })
})
```

### Anti-Patterns to Avoid

- **DO NOT use default export** - use named export for store and API functions
- **DO NOT call API directly in components** - use store actions
- **DO NOT store token in state** - read from localStorage per request
- **DO NOT duplicate fetchWithAuth logic** - import from existing api.ts
- **DO NOT use `any` type** - define proper interfaces

### References

- [Source: frontend/src/stores/authStore.ts] - Existing store pattern
- [Source: frontend/src/stores/channelStore.ts] - Channel store pattern
- [Source: frontend/src/services/api.ts] - Existing API service pattern with fetchWithAuth
- [Source: backend/app/routers/ersatztv.py] - API endpoint definitions
- [Source: backend/app/models/ersatztv.py] - Backend response models

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

