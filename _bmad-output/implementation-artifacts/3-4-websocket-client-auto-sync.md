# Story 3.4: WebSocket Client & Auto-Sync

Status: review

## Story

As a viewer,
I want my player to automatically switch channels,
So that I stay in sync with what the admin selects.

## Acceptance Criteria

1. **Given** I am logged in and the app loads
   **When** the main view mounts
   **Then** useWebSocket hook connects to `/api/ws` with my JWT
   **And** on connection_ack, channelStore updates with currentChannel
   **And** VideoPlayer loads that stream

2. **Given** I am watching a stream
   **When** the admin changes the channel
   **Then** I receive a channel_update message
   **And** channelStore updates automatically
   **And** VideoPlayer switches to the new stream seamlessly

3. **Given** the WebSocket receives an invalid message
   **When** the message is parsed
   **Then** the error is logged but app doesn't crash

4. **Given** the app is loading
   **When** WebSocket connection is establishing
   **Then** I see a "Connecting..." indicator

## Tasks / Subtasks

- [x] Task 1: Create useWebSocket Hook (AC: #1, #2, #3)
  - [x] Create `frontend/src/hooks/useWebSocket.ts`
  - [x] Connect to `/api/ws?token=<jwt>` on mount
  - [x] Handle `connection_ack` message
  - [x] Handle `channel_update` message
  - [x] Parse messages safely with error handling
  - [x] Update channelStore on messages

- [x] Task 2: Integrate Hook with Main View (AC: #1, #4)
  - [x] Call useWebSocket in MainView or App component
  - [x] Pass JWT from authStore
  - [x] Show connecting state during handshake

- [x] Task 3: Handle connection_ack (AC: #1)
  - [x] Extract currentChannel from ack message
  - [x] Update channelStore.currentChannel
  - [x] Handle null currentChannel (no selection yet)

- [x] Task 4: Handle channel_update (AC: #2)
  - [x] Listen for channel_update message type
  - [x] Extract channel from message payload
  - [x] Update channelStore.currentChannel
  - [x] VideoPlayer will re-render automatically

- [x] Task 5: Implement Ping for Keep-Alive (AC: connection maintenance)
  - [x] Send ping every 30 seconds
  - [x] Handle pong response (optional logging)

- [x] Task 6: Testing
  - [x] Test WebSocket connects on mount
  - [x] Test channelStore updates on connection_ack
  - [x] Test channelStore updates on channel_update
  - [x] Test invalid message handling
  - [x] Test VideoPlayer responds to store changes

## Dev Notes

### Architecture Compliance

**Files to create:**
- `frontend/src/hooks/useWebSocket.ts` - WebSocket connection hook

**Files to modify:**
- `frontend/src/App.tsx` or `MainView.tsx` - Integrate hook

### useWebSocket Hook

```typescript
// frontend/src/hooks/useWebSocket.ts
import { useEffect, useRef, useCallback, useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useChannelStore } from '@/stores/channelStore'

interface WebSocketMessage {
  type: string
  channel?: Channel
  currentChannel?: Channel | null
}

interface Channel {
  channelId: string
  name: string
  streamUrl: string
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export function useWebSocket() {
  const token = useAuthStore((s) => s.token)
  const setCurrentChannel = useChannelStore((s) => s.setCurrentChannel)
  const wsRef = useRef<WebSocket | null>(null)
  const pingIntervalRef = useRef<number | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')

  const connect = useCallback(() => {
    if (!token || wsRef.current?.readyState === WebSocket.OPEN) return

    setStatus('connecting')

    // Construct WebSocket URL
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${wsProtocol}//${window.location.host}/api/ws?token=${token}`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('WebSocket connected')
      setStatus('connected')

      // Start ping interval
      pingIntervalRef.current = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }))
        }
      }, 30000)
    }

    ws.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data)
        handleMessage(message)
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error)
      }
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }

    ws.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason)
      setStatus('disconnected')

      // Clear ping interval
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current)
        pingIntervalRef.current = null
      }
    }
  }, [token])

  const handleMessage = useCallback((message: WebSocketMessage) => {
    switch (message.type) {
      case 'connection_ack':
        console.log('Connection acknowledged, current channel:', message.currentChannel)
        setCurrentChannel(message.currentChannel ?? null)
        break

      case 'channel_update':
        console.log('Channel update received:', message.channel)
        if (message.channel) {
          setCurrentChannel(message.channel)
        }
        break

      case 'pong':
        // Ping acknowledged, connection healthy
        break

      default:
        console.log('Unknown message type:', message.type)
    }
  }, [setCurrentChannel])

  const disconnect = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current)
      pingIntervalRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setStatus('disconnected')
  }, [])

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect()
    return () => disconnect()
  }, [connect, disconnect])

  // Reconnect if token changes
  useEffect(() => {
    if (token && wsRef.current?.readyState !== WebSocket.OPEN) {
      connect()
    }
  }, [token, connect])

  return { status, connect, disconnect }
}
```

### Integration in App/MainView

```typescript
// frontend/src/components/MainView.tsx
import { useWebSocket } from '@/hooks/useWebSocket'
import { VideoPlayer } from './VideoPlayer'
import { ChannelList } from './ChannelList'
import { ConnectionStatus } from './ConnectionStatus'

export function MainView() {
  const { status } = useWebSocket()

  return (
    <div className="flex h-screen">
      <main className="flex-1">
        <VideoPlayer />
      </main>
      <aside className="w-80 border-l">
        <ConnectionStatus status={status} />
        <ChannelList />
      </aside>
    </div>
  )
}
```

### Message Type Handling

```typescript
// Message types from server
interface ConnectionAck {
  type: 'connection_ack'
  currentChannel: Channel | null
}

interface ChannelUpdate {
  type: 'channel_update'
  channel: Channel
}

interface Pong {
  type: 'pong'
}

type ServerMessage = ConnectionAck | ChannelUpdate | Pong
```

### VideoPlayer Auto-Update

VideoPlayer already watches channelStore, so it updates automatically:

```typescript
// frontend/src/components/VideoPlayer.tsx
export function VideoPlayer() {
  const currentChannel = useChannelStore((s) => s.currentChannel)

  // When currentChannel changes via WebSocket,
  // the component re-renders and plays the new stream

  if (!currentChannel) {
    return <VideoPlayerPlaceholder />
  }

  return (
    <video src={currentChannel.streamUrl} autoPlay />
  )
}
```

### WebSocket URL Construction

```typescript
// Handle both development and production
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const wsUrl = `${wsProtocol}//${window.location.host}/api/ws?token=${token}`

// In development with Vite proxy:
// ws://localhost:5173/api/ws?token=...
// Vite proxies to backend WebSocket

// In production:
// wss://iptv.domain.com/api/ws?token=...
```

### Vite Proxy Configuration

```typescript
// vite.config.ts - ensure WebSocket proxying works
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        ws: true, // Enable WebSocket proxying
      },
    },
  },
})
```

### Project Structure Notes

**Alignment with architecture:**
- Hook in `hooks/` directory
- Updates Zustand store
- Reactive VideoPlayer via store subscription
- JSON message parsing

### Dependencies from Previous Stories

- Story 3.2: WebSocket server sending messages
- Story 3.3: channelStore with currentChannel
- Story 2.3: VideoPlayer watching currentChannel

### Error Handling

```typescript
// Safe message parsing
ws.onmessage = (event) => {
  try {
    const message = JSON.parse(event.data)
    handleMessage(message)
  } catch (error) {
    // Log but don't crash - server might send malformed data
    console.error('Failed to parse WebSocket message:', error)
  }
}

// Safe message handling
const handleMessage = (message: WebSocketMessage) => {
  // Type guard for unknown message types
  if (!message || typeof message.type !== 'string') {
    console.warn('Invalid message format:', message)
    return
  }
  // ... handle known types
}
```

### Keep-Alive with Ping

```typescript
// Send ping every 30 seconds to keep connection alive
// This prevents WebSocket timeout on some proxies/firewalls

const PING_INTERVAL = 30000

ws.onopen = () => {
  pingIntervalRef.current = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }))
    }
  }, PING_INTERVAL)
}

// Clear on close
ws.onclose = () => {
  if (pingIntervalRef.current) {
    clearInterval(pingIntervalRef.current)
  }
}
```

### Anti-Patterns to Avoid

- Do NOT create new WebSocket on every render (use ref)
- Do NOT forget to close WebSocket on unmount
- Do NOT crash on invalid messages
- Do NOT hardcode WebSocket URL (use window.location)
- Do NOT forget to clear intervals on disconnect

### Testing Strategy

```typescript
// frontend/src/hooks/useWebSocket.test.ts
import { renderHook, act } from '@testing-library/react'
import { useWebSocket } from './useWebSocket'
import { useChannelStore } from '@/stores/channelStore'
import { useAuthStore } from '@/stores/authStore'

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  readyState = WebSocket.CONNECTING

  constructor() {
    MockWebSocket.instances.push(this)
  }

  send = vi.fn()
  close = vi.fn()

  // Simulate server messages
  simulateMessage(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  simulateOpen() {
    this.readyState = WebSocket.OPEN
    this.onopen?.()
  }
}

global.WebSocket = MockWebSocket as any

describe('useWebSocket', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    useAuthStore.setState({ token: 'test-token' })
    useChannelStore.setState({ currentChannel: null })
  })

  test('connects on mount', () => {
    renderHook(() => useWebSocket())
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  test('updates store on connection_ack', () => {
    renderHook(() => useWebSocket())
    const ws = MockWebSocket.instances[0]
    ws.simulateOpen()

    act(() => {
      ws.simulateMessage({
        type: 'connection_ack',
        currentChannel: { channelId: '1', name: 'TSN', streamUrl: '...' }
      })
    })

    expect(useChannelStore.getState().currentChannel?.channelId).toBe('1')
  })

  test('updates store on channel_update', () => {
    renderHook(() => useWebSocket())
    const ws = MockWebSocket.instances[0]
    ws.simulateOpen()

    act(() => {
      ws.simulateMessage({
        type: 'channel_update',
        channel: { channelId: '2', name: 'ESPN', streamUrl: '...' }
      })
    })

    expect(useChannelStore.getState().currentChannel?.channelId).toBe('2')
  })
})
```

### References

- [Source: _bmad-output/architecture.md#WebSocket-Message-Types]
- [Source: _bmad-output/architecture.md#Data-Flow]
- [Source: _bmad-output/epics.md#Story-3.4]
- [Source: _bmad-output/project-context.md#TypeScript/React-Rules]

## Dev Agent Record

### Agent Model Used

claude-opus-4-5-20251101

### Debug Log References

N/A - No significant debugging issues encountered.

### Completion Notes List

- Created `useWebSocket` hook with full WebSocket lifecycle management (connect, disconnect, message handling)
- Implemented `connection_ack` handler to sync initial channel state from server
- Implemented `channel_update` handler to receive real-time channel changes
- Added 30-second ping/pong keep-alive to maintain connection through proxies/firewalls
- Integrated hook into MainView component with connection status indicator
- Added Vite proxy configuration for WebSocket support in development
- Created comprehensive test suite with 14 tests covering all acceptance criteria
- All tests pass successfully

### File List

**Created:**
- `frontend/src/hooks/useWebSocket.ts` - WebSocket connection hook
- `frontend/src/hooks/useWebSocket.test.ts` - Tests for useWebSocket hook

**Modified:**
- `frontend/src/components/MainView.tsx` - Integrated useWebSocket hook and connection status
- `frontend/vite.config.ts` - Added WebSocket proxy configuration

## Change Log

| Date | Change |
|------|--------|
| 2025-12-26 | Implemented WebSocket client with auto-sync functionality |
