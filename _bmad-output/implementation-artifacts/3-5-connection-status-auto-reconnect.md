# Story 3.5: Connection Status & Auto-Reconnect

Status: review

## Story

As a viewer,
I want to know my connection status and auto-reconnect if dropped,
So that I don't miss channel changes.

## Acceptance Criteria

1. **Given** I am connected via WebSocket
   **When** the connection is healthy
   **Then** ConnectionStatus shows "Connected" indicator (green)

2. **Given** my WebSocket disconnects unexpectedly
   **When** the disconnect is detected
   **Then** ConnectionStatus shows "Reconnecting..." (yellow)
   **And** useWebSocket attempts reconnection with exponential backoff
   **And** reconnection succeeds within 5 seconds (NFR6)

3. **Given** I successfully reconnect
   **When** connection_ack is received
   **Then** channelStore syncs with current channel
   **And** VideoPlayer updates if channel changed while disconnected

4. **Given** the connection fails repeatedly
   **When** max retries are exceeded
   **Then** ConnectionStatus shows "Disconnected" (red)
   **And** a "Reconnect" button is available

5. **Given** I am in "Disconnected" state
   **When** I click "Reconnect"
   **Then** connection attempt restarts

## Tasks / Subtasks

- [x] Task 1: Create ConnectionStatus Component (AC: #1, #2, #4)
  - [x] Create `frontend/src/components/ConnectionStatus.tsx`
  - [x] Display connection state with colored indicator
  - [x] Show "Connected" (green), "Reconnecting..." (yellow), "Disconnected" (red)
  - [x] Add manual "Reconnect" button for failed state

- [x] Task 2: Add Auto-Reconnect to useWebSocket (AC: #2, #3)
  - [x] Implement exponential backoff (1s, 2s, 4s, 8s, max 10s)
  - [x] Auto-reconnect on unexpected disconnect
  - [x] Don't reconnect on intentional close (logout)
  - [x] Limit max reconnection attempts (5-10)

- [x] Task 3: Expose Reconnect Function (AC: #5)
  - [x] Return `reconnect` function from useWebSocket
  - [x] Reset retry count on manual reconnect
  - [x] Wire to ConnectionStatus button

- [x] Task 4: Handle Reconnection Channel Sync (AC: #3)
  - [x] On reconnect, receive fresh connection_ack
  - [x] Update channelStore with current channel
  - [x] VideoPlayer reacts to store change automatically

- [x] Task 5: Track Connection State (AC: #1, #2, #4)
  - [x] Add connection state to hook: 'connected' | 'connecting' | 'reconnecting' | 'disconnected'
  - [x] Update state on WebSocket events
  - [x] Distinguish 'connecting' (initial) from 'reconnecting' (after drop)

- [x] Task 6: Testing
  - [x] Test ConnectionStatus displays correct states
  - [x] Test auto-reconnect triggers on disconnect
  - [x] Test exponential backoff timing
  - [x] Test manual reconnect button works
  - [x] Test channel syncs after reconnect

## Dev Notes

### Architecture Compliance

**Files to create:**
- `frontend/src/components/ConnectionStatus.tsx`

**Files to modify:**
- `frontend/src/hooks/useWebSocket.ts` - Add reconnect logic

### ConnectionStatus Component

```typescript
// frontend/src/components/ConnectionStatus.tsx
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type ConnectionState = 'connected' | 'connecting' | 'reconnecting' | 'disconnected'

interface ConnectionStatusProps {
  status: ConnectionState
  onReconnect?: () => void
}

export function ConnectionStatus({ status, onReconnect }: ConnectionStatusProps) {
  const statusConfig = {
    connected: {
      color: 'bg-green-500',
      text: 'Connected',
      pulse: false,
    },
    connecting: {
      color: 'bg-yellow-500',
      text: 'Connecting...',
      pulse: true,
    },
    reconnecting: {
      color: 'bg-yellow-500',
      text: 'Reconnecting...',
      pulse: true,
    },
    disconnected: {
      color: 'bg-red-500',
      text: 'Disconnected',
      pulse: false,
    },
  }

  const config = statusConfig[status]

  return (
    <div className="flex items-center gap-2 p-4 border-b">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'h-3 w-3 rounded-full',
            config.color,
            config.pulse && 'animate-pulse'
          )}
        />
        <span className="text-sm font-medium">{config.text}</span>
      </div>

      {status === 'disconnected' && onReconnect && (
        <Button
          variant="outline"
          size="sm"
          onClick={onReconnect}
          className="ml-auto"
        >
          Reconnect
        </Button>
      )}
    </div>
  )
}
```

### Enhanced useWebSocket with Reconnect

```typescript
// frontend/src/hooks/useWebSocket.ts
import { useEffect, useRef, useCallback, useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useChannelStore } from '@/stores/channelStore'

type ConnectionStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected'

interface UseWebSocketReturn {
  status: ConnectionStatus
  reconnect: () => void
}

const MAX_RETRIES = 5
const INITIAL_BACKOFF = 1000 // 1 second
const MAX_BACKOFF = 10000 // 10 seconds

export function useWebSocket(): UseWebSocketReturn {
  const token = useAuthStore((s) => s.token)
  const setCurrentChannel = useChannelStore((s) => s.setCurrentChannel)

  const wsRef = useRef<WebSocket | null>(null)
  const pingIntervalRef = useRef<number | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const retryCountRef = useRef(0)
  const intentionalCloseRef = useRef(false)

  const [status, setStatus] = useState<ConnectionStatus>('disconnected')

  const getBackoffDelay = useCallback(() => {
    const delay = Math.min(
      INITIAL_BACKOFF * Math.pow(2, retryCountRef.current),
      MAX_BACKOFF
    )
    return delay
  }, [])

  const clearTimers = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current)
      pingIntervalRef.current = null
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
  }, [])

  const connect = useCallback((isReconnect = false) => {
    if (!token) return

    // Close existing connection if any
    if (wsRef.current) {
      intentionalCloseRef.current = true
      wsRef.current.close()
    }

    setStatus(isReconnect ? 'reconnecting' : 'connecting')

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${wsProtocol}//${window.location.host}/api/ws?token=${token}`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    intentionalCloseRef.current = false

    ws.onopen = () => {
      console.log('WebSocket connected')
      setStatus('connected')
      retryCountRef.current = 0

      // Start ping interval
      pingIntervalRef.current = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }))
        }
      }, 30000)
    }

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
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
      clearTimers()
      wsRef.current = null

      // Don't reconnect if intentionally closed (logout)
      if (intentionalCloseRef.current) {
        setStatus('disconnected')
        return
      }

      // Token expired - don't reconnect, redirect to login
      if (event.code === 4001) {
        setStatus('disconnected')
        // Auth error handling could go here
        return
      }

      // Attempt reconnection if we haven't exceeded retries
      if (retryCountRef.current < MAX_RETRIES) {
        const delay = getBackoffDelay()
        console.log(`Reconnecting in ${delay}ms (attempt ${retryCountRef.current + 1}/${MAX_RETRIES})`)
        setStatus('reconnecting')

        reconnectTimeoutRef.current = window.setTimeout(() => {
          retryCountRef.current++
          connect(true)
        }, delay)
      } else {
        console.log('Max reconnection attempts reached')
        setStatus('disconnected')
      }
    }
  }, [token, clearTimers, getBackoffDelay])

  const handleMessage = useCallback((message: { type: string; channel?: any; currentChannel?: any }) => {
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
        break

      default:
        console.log('Unknown message type:', message.type)
    }
  }, [setCurrentChannel])

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true
    clearTimers()
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setStatus('disconnected')
  }, [clearTimers])

  const reconnect = useCallback(() => {
    retryCountRef.current = 0
    connect(true)
  }, [connect])

  // Connect on mount
  useEffect(() => {
    if (token) {
      connect()
    }
    return () => disconnect()
  }, [token, connect, disconnect])

  return { status, reconnect }
}
```

### Integration in MainView

```typescript
// frontend/src/components/MainView.tsx
import { useWebSocket } from '@/hooks/useWebSocket'
import { ConnectionStatus } from './ConnectionStatus'
import { VideoPlayer } from './VideoPlayer'
import { ChannelList } from './ChannelList'

export function MainView() {
  const { status, reconnect } = useWebSocket()

  return (
    <div className="flex h-screen">
      <main className="flex-1">
        <VideoPlayer />
      </main>
      <aside className="w-80 border-l flex flex-col">
        <ConnectionStatus status={status} onReconnect={reconnect} />
        <div className="flex-1 overflow-auto">
          <ChannelList />
        </div>
      </aside>
    </div>
  )
}
```

### Exponential Backoff Logic

```typescript
// Backoff sequence: 1s, 2s, 4s, 8s, 10s (capped), 10s...
const INITIAL_BACKOFF = 1000
const MAX_BACKOFF = 10000

function getBackoffDelay(retryCount: number): number {
  return Math.min(INITIAL_BACKOFF * Math.pow(2, retryCount), MAX_BACKOFF)
}

// Example sequence:
// Retry 0: 1000ms (1s)
// Retry 1: 2000ms (2s)
// Retry 2: 4000ms (4s)
// Retry 3: 8000ms (8s)
// Retry 4: 10000ms (10s, capped)
```

### Visual Design

```
┌───────────────────────────────────┐
│ ● Connected                       │  ← Green dot
└───────────────────────────────────┘

┌───────────────────────────────────┐
│ ◐ Reconnecting...                 │  ← Yellow pulsing dot
└───────────────────────────────────┘

┌───────────────────────────────────┐
│ ● Disconnected      [Reconnect]   │  ← Red dot with button
└───────────────────────────────────┘
```

### 10-Foot UI Considerations

- Status indicator visible from distance (min 8px dot)
- Reconnect button meets 44px touch target
- Clear color coding (green/yellow/red)
- Text size adequate for reading from 10 feet

### NFR6 Compliance

NFR6: WebSocket auto-reconnects within 5 seconds of connection loss

With exponential backoff starting at 1 second:
- First reconnect attempt: 1s → well under 5s ✓
- If first fails: 2s → still under 5s ✓

The 5-second requirement refers to the first reconnection being attempted and potentially succeeding within 5 seconds, not guaranteed success.

### Project Structure Notes

**Alignment with architecture:**
- Component in components/ with named export
- Hook in hooks/ with camelCase
- Uses existing channelStore
- Follows shadcn/ui patterns

### Dependencies from Previous Stories

- Story 3.4: useWebSocket hook (extend it)
- Story 3.3: channelStore (already exists)
- shadcn Button component

### Anti-Patterns to Avoid

- Do NOT reconnect on intentional logout
- Do NOT reconnect forever (limit attempts)
- Do NOT block UI during reconnection
- Do NOT forget to clear timeouts on unmount
- Do NOT reconnect on auth failure (code 4001)

### Testing Strategy

```typescript
// frontend/src/components/ConnectionStatus.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { ConnectionStatus } from './ConnectionStatus'

describe('ConnectionStatus', () => {
  test('shows Connected in green', () => {
    render(<ConnectionStatus status="connected" />)
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.queryByText('Reconnect')).not.toBeInTheDocument()
  })

  test('shows Reconnecting with pulse', () => {
    render(<ConnectionStatus status="reconnecting" />)
    expect(screen.getByText('Reconnecting...')).toBeInTheDocument()
  })

  test('shows Disconnected with reconnect button', () => {
    const onReconnect = vi.fn()
    render(<ConnectionStatus status="disconnected" onReconnect={onReconnect} />)

    expect(screen.getByText('Disconnected')).toBeInTheDocument()

    const button = screen.getByText('Reconnect')
    fireEvent.click(button)
    expect(onReconnect).toHaveBeenCalled()
  })
})

// frontend/src/hooks/useWebSocket.test.ts
describe('useWebSocket reconnection', () => {
  test('attempts reconnect with backoff', async () => {
    vi.useFakeTimers()

    renderHook(() => useWebSocket())
    const ws = MockWebSocket.instances[0]
    ws.simulateOpen()

    // Simulate disconnect
    act(() => {
      ws.simulateClose({ code: 1006 })
    })

    // Should be reconnecting
    expect(hookResult.status).toBe('reconnecting')

    // Advance timer for first backoff (1s)
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    // New WebSocket should be created
    expect(MockWebSocket.instances).toHaveLength(2)

    vi.useRealTimers()
  })

  test('stops reconnecting after max retries', async () => {
    vi.useFakeTimers()

    renderHook(() => useWebSocket())

    // Simulate 5 failed connections
    for (let i = 0; i < 5; i++) {
      const ws = MockWebSocket.instances[i]
      ws.simulateOpen()
      act(() => ws.simulateClose({ code: 1006 }))
      act(() => vi.advanceTimersByTime(getBackoffDelay(i)))
    }

    // After 5 retries, should be disconnected
    expect(hookResult.status).toBe('disconnected')

    vi.useRealTimers()
  })
})
```

### References

- [Source: _bmad-output/architecture.md#NFR6-Reliability]
- [Source: _bmad-output/architecture.md#WebSocket-Protocol]
- [Source: _bmad-output/epics.md#Story-3.5]
- [Source: _bmad-output/project-context.md#TypeScript/React-Rules]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

### Completion Notes List

- Implemented ConnectionStatus component with green/yellow/red status indicators and manual reconnect button
- Enhanced useWebSocket hook with auto-reconnect functionality using exponential backoff (1s, 2s, 4s, 8s, max 10s)
- Added connection state tracking: 'connected' | 'connecting' | 'reconnecting' | 'disconnected'
- Exposed reconnect function that resets retry count for manual reconnection
- Integrated ConnectionStatus component into MainView header
- Created comprehensive test suite (33 tests passing) covering all acceptance criteria
- Connection properly distinguishes between 'connecting' (initial) and 'reconnecting' (after drop)
- No reconnection on intentional close (logout) or auth error (code 4001)
- Retry count resets after successful connection

### File List

**New files:**
- frontend/src/components/ConnectionStatus.tsx
- frontend/src/components/ConnectionStatus.test.tsx

**Modified files:**
- frontend/src/hooks/useWebSocket.ts
- frontend/src/hooks/useWebSocket.test.ts
- frontend/src/components/MainView.tsx

## Change Log

- 2025-12-26: Implemented Story 3.5 - Connection Status & Auto-Reconnect (Claude Opus 4.5)
