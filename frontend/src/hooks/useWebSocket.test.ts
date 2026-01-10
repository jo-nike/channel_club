import { renderHook, act } from '@/test/utils'
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import { toast } from 'sonner'
import { useWebSocket } from './useWebSocket'
import { useChannelStore } from '@/stores/channelStore'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'

// Mock useChatEnabled hook
vi.mock('./useChatEnabled', () => ({
  useChatEnabled: vi.fn(() => true),
}))

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: vi.fn(),
}))

// Mock WebSocket - simple version without auto-open
class MockWebSocket {
  static instances: MockWebSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number; reason: string }) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  readyState = 0 // WebSocket.CONNECTING

  url: string

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = 3 // WebSocket.CLOSED
    this.onclose?.({ code: 1000, reason: 'Normal closure' })
  })

  // Test helpers
  simulateMessage(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  simulateOpen() {
    this.readyState = 1 // WebSocket.OPEN
    this.onopen?.()
  }

  simulateClose(code = 1000, reason = 'Normal closure') {
    this.readyState = 3 // WebSocket.CLOSED
    this.onclose?.({ code, reason })
  }
}

// Define WebSocket constants if not present
if (typeof WebSocket === 'undefined') {
  (global as Record<string, unknown>).WebSocket = {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
  }
}

describe('useWebSocket', () => {
  const originalWebSocket = global.WebSocket

  beforeEach(() => {
    MockWebSocket.instances = []
    // Override WebSocket but keep constants
    global.WebSocket = Object.assign(MockWebSocket, {
      CONNECTING: 0,
      OPEN: 1,
      CLOSING: 2,
      CLOSED: 3,
    }) as unknown as typeof WebSocket

    // Reset stores directly using setState
    useAuthStore.setState({
      token: 'test-jwt-token',
      role: 'viewer',
      isAuthenticated: true,
    })
    useChannelStore.setState({
      channels: [],
      currentChannel: null,
      isLoading: false,
      error: null,
    })
    useUIStore.setState({
      notificationsEnabled: false,
    })
    useChatStore.setState({
      messages: [],
      isOpen: false,
      unreadCount: 0,
    })
    vi.mocked(toast).mockClear()
  })

  afterEach(() => {
    global.WebSocket = originalWebSocket
    vi.restoreAllMocks()
    useAuthStore.setState({
      token: null,
      role: null,
      isAuthenticated: false,
    })
  })

  describe('connection', () => {
    test('connects to WebSocket on mount when token exists', () => {
      renderHook(() => useWebSocket())

      expect(MockWebSocket.instances).toHaveLength(1)
      expect(MockWebSocket.instances[0].url).toContain('/api/ws')
      expect(MockWebSocket.instances[0].url).toContain('token=test-jwt-token')
    })

    test('does not connect when no token exists', () => {
      useAuthStore.setState({ token: null, role: null, isAuthenticated: false })

      renderHook(() => useWebSocket())

      expect(MockWebSocket.instances).toHaveLength(0)
    })

    test('returns connecting status initially', () => {
      const { result } = renderHook(() => useWebSocket())

      expect(result.current.status).toBe('connecting')
    })

    test('returns connected status after connection opens', () => {
      const { result } = renderHook(() => useWebSocket())

      act(() => {
        MockWebSocket.instances[0].simulateOpen()
      })

      expect(result.current.status).toBe('connected')
    })

    test('returns reconnecting status after connection closes unexpectedly', () => {
      const { result } = renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
      })

      expect(result.current.status).toBe('connected')

      // Unexpected close triggers reconnecting (not disconnected)
      act(() => {
        ws.simulateClose(1006, 'Abnormal closure')
      })

      expect(result.current.status).toBe('reconnecting')
    })

    test('disconnects on unmount', () => {
      const { unmount } = renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
      })

      unmount()

      expect(ws.close).toHaveBeenCalled()
    })
  })

  describe('connection_ack handling', () => {
    test('updates channelStore on connection_ack with channel', () => {
      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
        ws.simulateMessage({
          type: 'connection_ack',
          currentChannel: { id: '1', name: 'TSN', streamUrl: 'http://stream.url/tsn' },
        })
      })

      expect(useChannelStore.getState().currentChannel).toEqual({
        id: '1',
        name: 'TSN',
        streamUrl: 'http://stream.url/tsn',
      })
    })

    test('sets currentChannel to null on connection_ack with no channel', () => {
      // Set a previous channel first
      useChannelStore.setState({ currentChannel: { id: '1', name: 'Old', streamUrl: 'old.url' } })

      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
        ws.simulateMessage({
          type: 'connection_ack',
          currentChannel: null,
        })
      })

      expect(useChannelStore.getState().currentChannel).toBeNull()
    })
  })

  describe('channel_update handling', () => {
    test('updates channelStore on channel_update', () => {
      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
        ws.simulateMessage({
          type: 'channel_update',
          channel: { id: '2', name: 'ESPN', streamUrl: 'http://stream.url/espn' },
        })
      })

      expect(useChannelStore.getState().currentChannel).toEqual({
        id: '2',
        name: 'ESPN',
        streamUrl: 'http://stream.url/espn',
      })
    })
  })

  describe('error handling', () => {
    test('handles invalid JSON gracefully without crashing', () => {
      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
        // Send invalid JSON
        ws.onmessage?.({ data: 'not valid json {{{' })
      })

      // Should not throw and store should be unchanged
      expect(useChannelStore.getState().currentChannel).toBeNull()
    })

    test('handles unknown message types gracefully', () => {
      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
        ws.simulateMessage({ type: 'unknown_type', data: 'something' })
      })

      // Should not throw and store should be unchanged
      expect(useChannelStore.getState().currentChannel).toBeNull()
    })
  })

  describe('ping/pong keep-alive', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    test('sends ping every 30 seconds after connection', () => {
      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
      })

      expect(ws.send).not.toHaveBeenCalled()

      // Advance 30 seconds
      act(() => {
        vi.advanceTimersByTime(30000)
      })

      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping' }))
    })

    test('stops ping on disconnect', () => {
      const { unmount } = renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
      })

      unmount()

      // Clear the mock to check if any new pings are sent
      ws.send.mockClear()

      // Advance 30 seconds - no ping should be sent
      act(() => {
        vi.advanceTimersByTime(30000)
      })

      expect(ws.send).not.toHaveBeenCalled()
    })

    test('handles pong response gracefully', () => {
      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
        ws.simulateMessage({ type: 'pong' })
      })

      // Should not throw and store should be unchanged
      expect(useChannelStore.getState().currentChannel).toBeNull()
    })
  })

  describe('auto-reconnect', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    test('returns reconnecting status when connection drops unexpectedly', () => {
      const { result } = renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
      })

      expect(result.current.status).toBe('connected')

      // Simulate unexpected close (not code 1000)
      act(() => {
        ws.simulateClose(1006, 'Abnormal closure')
      })

      expect(result.current.status).toBe('reconnecting')
    })

    test('attempts reconnection with exponential backoff', () => {
      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
      })

      // Simulate disconnect
      act(() => {
        ws.simulateClose(1006, 'Abnormal closure')
      })

      expect(MockWebSocket.instances).toHaveLength(1)

      // After 1 second (first backoff), new connection should be created
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(MockWebSocket.instances).toHaveLength(2)
    })

    test('exponential backoff increases delay', () => {
      renderHook(() => useWebSocket())

      // First connection and disconnect
      act(() => {
        MockWebSocket.instances[0].simulateOpen()
      })
      act(() => {
        MockWebSocket.instances[0].simulateClose(1006, 'Abnormal closure')
      })

      // First retry at 1s (retryCount=0, delay=1000ms)
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(MockWebSocket.instances).toHaveLength(2)

      // Second connection fails immediately (no open)
      act(() => {
        MockWebSocket.instances[1].simulateClose(1006, 'Connection failed')
      })

      // Second retry should be at 2s (retryCount=1, delay=2000ms)
      // After 1s, still waiting (no new connection yet)
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(MockWebSocket.instances).toHaveLength(2)

      // After another 1s (total 2s), new connection
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(MockWebSocket.instances).toHaveLength(3)
    })

    test('stops reconnecting after max retries', async () => {
      const { result } = renderHook(() => useWebSocket())
      const MAX_RETRIES = 5

      // Initial connection that opens successfully then drops
      act(() => {
        MockWebSocket.instances[0].simulateOpen()
      })
      act(() => {
        MockWebSocket.instances[0].simulateClose(1006, 'Abnormal closure')
      })

      // Now simulate MAX_RETRIES failed reconnection attempts
      // Each reconnect attempt fails immediately (connection closes without opening)
      for (let i = 0; i < MAX_RETRIES; i++) {
        // Advance timer to trigger reconnect
        const delay = Math.min(1000 * Math.pow(2, i), 10000)
        act(() => {
          vi.advanceTimersByTime(delay)
        })

        // New connection created but fails immediately (simulating network failure)
        const wsIdx = i + 1
        expect(MockWebSocket.instances).toHaveLength(wsIdx + 1)

        // Close without ever opening - simulates failed connection attempt
        act(() => {
          MockWebSocket.instances[wsIdx].simulateClose(1006, 'Connection failed')
        })
      }

      // After max retries (5), status should be disconnected (no more reconnects)
      expect(result.current.status).toBe('disconnected')
      expect(MockWebSocket.instances).toHaveLength(MAX_RETRIES + 1)
    })

    test('does not reconnect on intentional close (logout)', () => {
      const { unmount } = renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
      })

      // Intentional disconnect via unmount (simulates logout)
      // This sets intentionalCloseRef = true and calls close()
      unmount()

      // Advance time - no reconnection should happen
      act(() => {
        vi.advanceTimersByTime(5000)
      })

      // Only one WebSocket should exist (no reconnection attempts)
      expect(MockWebSocket.instances).toHaveLength(1)
    })

    test('does not reconnect on auth error (code 4001)', () => {
      const { result } = renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
        ws.simulateClose(4001, 'Token expired')
      })

      expect(result.current.status).toBe('disconnected')

      // Advance time - no reconnection should happen
      act(() => {
        vi.advanceTimersByTime(5000)
      })

      expect(MockWebSocket.instances).toHaveLength(1)
    })

    test('resets retry count after successful connection', () => {
      renderHook(() => useWebSocket())

      // First connection and disconnect
      act(() => {
        MockWebSocket.instances[0].simulateOpen()
        MockWebSocket.instances[0].simulateClose(1006, 'Abnormal closure')
      })

      // First retry at 1s
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      // Successful reconnection
      act(() => {
        MockWebSocket.instances[1].simulateOpen()
      })

      // Disconnect again
      act(() => {
        MockWebSocket.instances[1].simulateClose(1006, 'Abnormal closure')
      })

      // Should retry at 1s again (reset to initial backoff)
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(MockWebSocket.instances).toHaveLength(3)
    })

    test('syncs channel state after reconnection', () => {
      renderHook(() => useWebSocket())

      // First connection with channel
      act(() => {
        MockWebSocket.instances[0].simulateOpen()
        MockWebSocket.instances[0].simulateMessage({
          type: 'connection_ack',
          currentChannel: { id: '1', name: 'TSN', streamUrl: 'http://stream.url/tsn' },
        })
      })

      // Disconnect
      act(() => {
        MockWebSocket.instances[0].simulateClose(1006, 'Abnormal closure')
      })

      // Reconnect
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      // New connection with different channel
      act(() => {
        MockWebSocket.instances[1].simulateOpen()
        MockWebSocket.instances[1].simulateMessage({
          type: 'connection_ack',
          currentChannel: { id: '2', name: 'ESPN', streamUrl: 'http://stream.url/espn' },
        })
      })

      // Channel should be updated to new value
      expect(useChannelStore.getState().currentChannel).toEqual({
        id: '2',
        name: 'ESPN',
        streamUrl: 'http://stream.url/espn',
      })
    })
  })

  describe('manual reconnect', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    test('exposes reconnect function', () => {
      const { result } = renderHook(() => useWebSocket())

      expect(typeof result.current.reconnect).toBe('function')
    })

    test('manual reconnect resets retry count', () => {
      const { result } = renderHook(() => useWebSocket())
      const MAX_RETRIES = 5

      // Initial connection opens then drops
      act(() => {
        MockWebSocket.instances[0].simulateOpen()
      })
      act(() => {
        MockWebSocket.instances[0].simulateClose(1006, 'Abnormal closure')
      })

      // Exhaust all retries with failed connections (never open)
      for (let i = 0; i < MAX_RETRIES; i++) {
        const delay = Math.min(1000 * Math.pow(2, i), 10000)
        act(() => {
          vi.advanceTimersByTime(delay)
        })
        // Close without opening - simulates failed connection
        act(() => {
          MockWebSocket.instances[i + 1].simulateClose(1006, 'Connection failed')
        })
      }

      expect(result.current.status).toBe('disconnected')
      const countBeforeManualReconnect = MockWebSocket.instances.length

      // Manual reconnect
      act(() => {
        result.current.reconnect()
      })

      // New connection should be created
      expect(MockWebSocket.instances).toHaveLength(countBeforeManualReconnect + 1)
      expect(result.current.status).toBe('reconnecting')
    })

    test('reconnect button works when disconnected', () => {
      const { result } = renderHook(() => useWebSocket())
      const MAX_RETRIES = 5

      // Initial connection opens then drops
      act(() => {
        MockWebSocket.instances[0].simulateOpen()
      })
      act(() => {
        MockWebSocket.instances[0].simulateClose(1006, 'Abnormal closure')
      })

      // Exhaust all retries with failed connections (never open)
      for (let i = 0; i < MAX_RETRIES; i++) {
        const delay = Math.min(1000 * Math.pow(2, i), 10000)
        act(() => {
          vi.advanceTimersByTime(delay)
        })
        // Close without opening - simulates failed connection
        act(() => {
          MockWebSocket.instances[i + 1].simulateClose(1006, 'Connection failed')
        })
      }

      expect(result.current.status).toBe('disconnected')

      // Click reconnect
      act(() => {
        result.current.reconnect()
      })

      expect(result.current.status).toBe('reconnecting')
    })
  })

  describe('connection state tracking', () => {
    test('distinguishes connecting from reconnecting state', () => {
      const { result } = renderHook(() => useWebSocket())

      // Initial connection should be 'connecting'
      expect(result.current.status).toBe('connecting')

      act(() => {
        MockWebSocket.instances[0].simulateOpen()
      })

      expect(result.current.status).toBe('connected')

      // After disconnect, should be 'reconnecting' not 'connecting'
      act(() => {
        MockWebSocket.instances[0].simulateClose(1006, 'Abnormal closure')
      })

      expect(result.current.status).toBe('reconnecting')
    })
  })

  describe('view parameter', () => {
    test('includes view=live by default when no options passed', () => {
      renderHook(() => useWebSocket())

      expect(MockWebSocket.instances[0].url).toContain('view=live')
    })

    test('includes view=live when view option is live', () => {
      renderHook(() => useWebSocket({ view: 'live' }))

      expect(MockWebSocket.instances[0].url).toContain('view=live')
    })

    test('includes view=ersatztv when view option is ersatztv', () => {
      renderHook(() => useWebSocket({ view: 'ersatztv' }))

      expect(MockWebSocket.instances[0].url).toContain('view=ersatztv')
    })

    test('constructs correct URL with token and view parameters', () => {
      renderHook(() => useWebSocket({ view: 'ersatztv' }))

      const url = MockWebSocket.instances[0].url
      expect(url).toContain('token=test-jwt-token')
      expect(url).toContain('view=ersatztv')
      expect(url).toContain('/api/ws')
    })
  })

  describe('channel change notifications', () => {
    test('does not show toast on channel_update when notifications disabled', () => {
      useUIStore.setState({ notificationsEnabled: false })
      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
        ws.simulateMessage({
          type: 'channel_update',
          channel: { id: '2', name: 'ESPN', streamUrl: 'http://stream.url/espn' },
        })
      })

      expect(toast).not.toHaveBeenCalled()
    })

    test('shows toast on channel_update when notifications enabled', () => {
      useUIStore.setState({ notificationsEnabled: true })
      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
        ws.simulateMessage({
          type: 'channel_update',
          channel: { id: '2', name: 'ESPN', streamUrl: 'http://stream.url/espn' },
        })
      })

      expect(toast).toHaveBeenCalledWith('Live channel set to: ESPN', { id: 'channel-update-2', duration: 5000 })
    })

    test('toast includes channel name in message', () => {
      useUIStore.setState({ notificationsEnabled: true })
      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
        ws.simulateMessage({
          type: 'channel_update',
          channel: { id: '3', name: 'TSN Sports Network', streamUrl: 'http://stream.url/tsn' },
        })
      })

      expect(toast).toHaveBeenCalledWith('Live channel set to: TSN Sports Network', { id: 'channel-update-3', duration: 5000 })
    })

    test('respects notification preference change during session', () => {
      useUIStore.setState({ notificationsEnabled: false })
      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
      })

      // First update with notifications disabled
      act(() => {
        ws.simulateMessage({
          type: 'channel_update',
          channel: { id: '1', name: 'Channel 1', streamUrl: 'http://stream.url/1' },
        })
      })

      expect(toast).not.toHaveBeenCalled()

      // Enable notifications
      act(() => {
        useUIStore.setState({ notificationsEnabled: true })
      })

      // Second update with notifications enabled
      act(() => {
        ws.simulateMessage({
          type: 'channel_update',
          channel: { id: '2', name: 'Channel 2', streamUrl: 'http://stream.url/2' },
        })
      })

      expect(toast).toHaveBeenCalledWith('Live channel set to: Channel 2', { id: 'channel-update-2', duration: 5000 })
    })
  })

  describe('chat_message handling', () => {
    test('adds chat message to store on chat_message event', () => {
      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
        ws.simulateMessage({
          type: 'chat_message',
          messageId: 'msg-1',
          username: 'TestUser',
          content: 'Hello world!',
          timestamp: '2026-01-08T12:00:00Z',
        })
      })

      const messages = useChatStore.getState().messages
      expect(messages).toHaveLength(1)
      expect(messages[0]).toEqual({
        messageId: 'msg-1',
        username: 'TestUser',
        content: 'Hello world!',
        timestamp: '2026-01-08T12:00:00Z',
      })
    })

    test('ignores chat_message when missing required fields', () => {
      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
        ws.simulateMessage({
          type: 'chat_message',
          messageId: 'msg-1',
          // Missing username, content, timestamp
        })
      })

      expect(useChatStore.getState().messages).toHaveLength(0)
    })
  })

  describe('chat_history handling', () => {
    test('sets chat messages on chat_history event', () => {
      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
        ws.simulateMessage({
          type: 'chat_history',
          messages: [
            { messageId: 'msg-1', username: 'User1', content: 'First', timestamp: '2026-01-08T11:00:00Z' },
            { messageId: 'msg-2', username: 'User2', content: 'Second', timestamp: '2026-01-08T11:05:00Z' },
          ],
        })
      })

      const messages = useChatStore.getState().messages
      expect(messages).toHaveLength(2)
      expect(messages[0].messageId).toBe('msg-1')
      expect(messages[1].messageId).toBe('msg-2')
    })

    test('ignores chat_history when messages array is missing', () => {
      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
        ws.simulateMessage({
          type: 'chat_history',
          // Missing messages array
        })
      })

      expect(useChatStore.getState().messages).toHaveLength(0)
    })
  })

  describe('sendChatMessage', () => {
    test('sends chat message when connected', () => {
      const { result } = renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
      })

      act(() => {
        result.current.sendChatMessage('Hello everyone!')
      })

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'chat_message',
          content: 'Hello everyone!',
        })
      )
    })

    test('does not send when not connected', () => {
      const { result } = renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      // Don't open the connection

      act(() => {
        result.current.sendChatMessage('Hello everyone!')
      })

      expect(ws.send).not.toHaveBeenCalled()
    })
  })

  describe('nickname handling', () => {
    test('sends set_nickname on connect when nickname is set', () => {
      useChatStore.setState({ nickname: 'TestNick' })

      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
      })

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'set_nickname',
          nickname: 'TestNick',
        })
      )
    })

    test('does not send set_nickname on connect when nickname is null', () => {
      useChatStore.setState({ nickname: null })

      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
      })

      // Should not have sent set_nickname (no calls at all since ping hasn't fired)
      expect(ws.send).not.toHaveBeenCalledWith(
        expect.stringContaining('set_nickname')
      )
    })

    test('sendSetNickname sends nickname to server when connected', () => {
      const { result } = renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
      })

      ws.send.mockClear() // Clear any previous calls

      act(() => {
        result.current.sendSetNickname('NewNick')
      })

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'set_nickname',
          nickname: 'NewNick',
        })
      )
    })

    test('sendSetNickname does not send when not connected', () => {
      const { result } = renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      // Don't open the connection

      act(() => {
        result.current.sendSetNickname('NewNick')
      })

      expect(ws.send).not.toHaveBeenCalled()
    })
  })
})
