import { createElement } from 'react'
import { ChatPanel } from '@/components/ChatPanel'
import { render, screen, fireEvent, waitFor, renderHook, act } from '@/test/utils'
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import { toast } from 'sonner'
import { useWebSocket } from './useWebSocket'
import { useChannelStore } from '@/stores/channelStore'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { useTVStore, LIVE_CHANNEL_ID } from '@/stores/tvStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { usePresenceStore } from '@/stores/presenceStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchNowPlaying } from '@/services/api'
import type { PresenceEntry, UnifiedChannel } from '@/types'

// Mock useChatEnabled hook
vi.mock('./useChatEnabled', () => ({
  useChatEnabled: vi.fn(() => true),
}))

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: vi.fn(),
}))

// Selecting channel 0 from the toast's Watch action loads its EPG, and a
// live switch loads the channel's schedule
vi.mock('@/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api')>()),
  fetchNowPlaying: vi.fn(),
  fetchLiveProgrammes: vi.fn(async () => ({ channelId: '', programmes: [] })),
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
      username: null,
      isAuthenticated: true,
    })
    useChannelStore.setState({
      channels: [],
      currentChannel: null,
      lastChange: null,
      isLoading: false,
      error: null,
    })
    useTVStore.setState({ selectedChannel: null })
    useUIStore.setState({
      notificationsEnabled: false,
      hideMyActivity: false,
    })
    useChatStore.setState({
      messages: [],
      isOpen: false,
      unreadCount: 0,
      nickname: null,
      me: null,
      revertNickname: null,
      nicknameRejection: null,
    })
    usePresenceStore.setState({ entries: [] })
    useSettingsStore.setState({ userChannelSelection: false, presenceVisible: false })
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

    // Opens the first socket, drops it, then fails every fast retry so the hook reaches the slow-retry phase
    const exhaustFastRetries = () => {
      const MAX_RETRIES = 5
      act(() => {
        MockWebSocket.instances[0].simulateOpen()
      })
      act(() => {
        MockWebSocket.instances[0].simulateClose(1006, 'Abnormal closure')
      })
      for (let i = 0; i < MAX_RETRIES; i++) {
        const delay = Math.min(1000 * Math.pow(2, i), 10000)
        act(() => {
          vi.advanceTimersByTime(delay)
        })
        expect(MockWebSocket.instances).toHaveLength(i + 2)
        act(() => {
          MockWebSocket.instances[i + 1].simulateClose(1006, 'Connection failed')
        })
      }
      expect(MockWebSocket.instances).toHaveLength(MAX_RETRIES + 1)
    }

    test('keeps retrying every 30s after the fast retries run out', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const { result } = renderHook(() => useWebSocket())

      exhaustFastRetries()
      expect(result.current.status).toBe('disconnected')

      // No slow retry before 30s
      act(() => {
        vi.advanceTimersByTime(29999)
      })
      expect(MockWebSocket.instances).toHaveLength(6)
      expect(result.current.status).toBe('disconnected')

      // Slow retry at exactly 30s (jitter is 0)
      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(MockWebSocket.instances).toHaveLength(7)
      expect(result.current.status).toBe('reconnecting')

      // A failed slow attempt schedules another slow attempt, not a fast one
      act(() => {
        MockWebSocket.instances[6].simulateClose(1006, 'Connection failed')
      })
      expect(result.current.status).toBe('disconnected')
      act(() => {
        vi.advanceTimersByTime(29999)
      })
      expect(MockWebSocket.instances).toHaveLength(7)
      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(MockWebSocket.instances).toHaveLength(8)

      // Success resets to the fast backoff
      act(() => {
        MockWebSocket.instances[7].simulateOpen()
      })
      expect(result.current.status).toBe('connected')
      act(() => {
        MockWebSocket.instances[7].simulateClose(1006, 'Abnormal closure')
      })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(MockWebSocket.instances).toHaveLength(9)
    })

    test('adds up to 5s of jitter to the slow retry', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.999)
      renderHook(() => useWebSocket())

      exhaustFastRetries()

      act(() => {
        vi.advanceTimersByTime(34990)
      })
      expect(MockWebSocket.instances).toHaveLength(6)
      act(() => {
        vi.advanceTimersByTime(10)
      })
      expect(MockWebSocket.instances).toHaveLength(7)
    })

    test('stops slow retries after an auth error (code 4001)', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0)
      renderHook(() => useWebSocket())

      exhaustFastRetries()
      act(() => {
        vi.advanceTimersByTime(30000)
      })
      expect(MockWebSocket.instances).toHaveLength(7)

      // The slow attempt is rejected because the token expired
      act(() => {
        MockWebSocket.instances[6].simulateClose(4001, 'Token expired')
      })

      act(() => {
        vi.advanceTimersByTime(120000)
      })
      expect(MockWebSocket.instances).toHaveLength(7)
    })

    test('unmount cancels the pending slow retry', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const { unmount } = renderHook(() => useWebSocket())

      exhaustFastRetries()
      unmount()

      act(() => {
        vi.advanceTimersByTime(120000)
      })
      expect(MockWebSocket.instances).toHaveLength(6)
    })

    test('a token change cancels the pending slow retry', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0)
      renderHook(() => useWebSocket())

      exhaustFastRetries()

      // New token: disconnect() clears the slow timer and a fresh connection starts at once
      act(() => {
        useAuthStore.setState({ token: 'refreshed-jwt-token' })
      })
      expect(MockWebSocket.instances).toHaveLength(7)
      expect(MockWebSocket.instances[6].url).toContain('token=refreshed-jwt-token')

      act(() => {
        MockWebSocket.instances[6].simulateOpen()
      })
      act(() => {
        vi.advanceTimersByTime(120000)
      })
      expect(MockWebSocket.instances).toHaveLength(7)
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
    const ersatzChannel: UnifiedChannel = {
      id: 'ersatz-1',
      name: 'PopCorn Movies',
      number: 1,
      streamUrl: 'http://ersatz/1',
      type: 'ersatztv',
    }
    const liveSlot: UnifiedChannel = {
      id: LIVE_CHANNEL_ID,
      name: 'Live',
      number: 0,
      streamUrl: '',
      type: 'live',
    }
    const espn = { id: '2', name: 'ESPN', streamUrl: 'http://stream.url/espn', guideId: 'espn.guide' }

    function connect() {
      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]
      act(() => {
        ws.simulateOpen()
      })
      return ws
    }

    function lastToastOptions() {
      const call = vi.mocked(toast).mock.calls.at(-1)
      return call?.[1] as { id?: string; duration?: number; action?: { label: string; onClick: () => void } }
    }

    beforeEach(() => {
      useUIStore.setState({ notificationsEnabled: true })
      useTVStore.setState({ selectedChannel: ersatzChannel })
      vi.mocked(fetchNowPlaying).mockReset()
      vi.mocked(fetchNowPlaying).mockResolvedValue({ channelId: 'espn.guide', currentProgram: null })
    })

    test('does not show toast on channel_update when notifications disabled', () => {
      useUIStore.setState({ notificationsEnabled: false })
      const ws = connect()

      act(() => {
        ws.simulateMessage({ type: 'channel_update', channel: espn, changedBy: 'alice' })
      })

      expect(toast).not.toHaveBeenCalled()
    })

    test('names who put the channel on, with a Watch action, for a viewer on another channel', () => {
      const ws = connect()

      act(() => {
        ws.simulateMessage({ type: 'channel_update', channel: espn, changedBy: 'alice' })
      })

      expect(toast).toHaveBeenCalledTimes(1)
      expect(vi.mocked(toast).mock.calls[0][0]).toBe('alice put on ESPN')
      const options = lastToastOptions()
      expect(options.id).toBe('live-channel-change')
      expect(options.duration).toBe(5000)
      expect(options.action?.label).toBe('Watch')
    })

    test('Watch tunes the viewer to channel 0', () => {
      const ws = connect()

      act(() => {
        ws.simulateMessage({ type: 'channel_update', channel: espn, changedBy: 'alice' })
      })
      act(() => {
        lastToastOptions().action?.onClick()
      })

      const selected = useTVStore.getState().selectedChannel
      expect(selected?.id).toBe(LIVE_CHANNEL_ID)
      expect(selected?.type).toBe('live')
      expect(selected?.name).toBe('ESPN')
      expect(fetchNowPlaying).toHaveBeenCalledWith('espn.guide', 'ESPN')
    })

    test('Watch selects the first unified channel even when ErsatzTV channels are loaded', () => {
      useErsatztvStore.setState({
        channels: [{ id: 'ersatz-1', name: 'PopCorn Movies', streamUrl: '', logoUrl: '', number: 1, group: '' }],
      })
      const ws = connect()

      act(() => {
        ws.simulateMessage({ type: 'channel_update', channel: espn, changedBy: 'alice' })
      })
      act(() => {
        lastToastOptions().action?.onClick()
      })

      expect(useTVStore.getState().selectedChannel?.id).toBe(useTVStore.getState().getUnifiedChannels()[0].id)
      expect(useTVStore.getState().selectedChannel?.type).toBe('live')
      useErsatztvStore.setState({ channels: [] })
    })

    test('does not show a toast to a viewer already on channel 0', () => {
      useTVStore.setState({ selectedChannel: liveSlot })
      const ws = connect()

      act(() => {
        ws.simulateMessage({ type: 'channel_update', channel: espn, changedBy: 'alice' })
      })

      expect(toast).not.toHaveBeenCalled()
    })

    test('does not show a toast to the person who made the change', () => {
      useAuthStore.setState({ username: 'alice' })
      const ws = connect()

      act(() => {
        ws.simulateMessage({ type: 'channel_update', channel: espn, changedBy: 'alice' })
      })

      expect(toast).not.toHaveBeenCalled()
    })

    test('falls back to unattributed copy, still with Watch, when changedBy is missing', () => {
      const ws = connect()

      act(() => {
        ws.simulateMessage({ type: 'channel_update', channel: espn })
      })

      expect(vi.mocked(toast).mock.calls[0][0]).toBe('Live channel set to ESPN')
      expect(lastToastOptions().id).toBe('live-channel-change')
      expect(lastToastOptions().action?.label).toBe('Watch')
    })

    test('names who stopped live TV, without an action', () => {
      const ws = connect()

      act(() => {
        ws.simulateMessage({ type: 'channel_update', channel: null, changedBy: 'alice' })
      })

      expect(toast).toHaveBeenCalledWith('alice stopped live TV', { id: 'live-channel-change', duration: 5000 })
    })

    test('a stop replacing a visible put-on toast clears its Watch action', () => {
      const ws = connect()

      act(() => {
        ws.simulateMessage({ type: 'channel_update', channel: espn, changedBy: 'alice' })
        ws.simulateMessage({ type: 'channel_update', channel: null, changedBy: 'alice' })
      })

      const calls = vi.mocked(toast).mock.calls
      expect(calls.map((c) => c[0])).toEqual(['alice put on ESPN', 'alice stopped live TV'])
      const clearOptions = calls[1][1] as { id: string; action?: unknown }
      expect(clearOptions.id).toBe('live-channel-change')
      // Sonner spreads the update over the existing toast, so the key must be
      // present (as undefined) to remove the earlier Watch button.
      expect(Object.hasOwn(clearOptions, 'action')).toBe(true)
      expect(clearOptions.action).toBeUndefined()
    })

    test('shows nothing for an unattributed clear', () => {
      const ws = connect()

      act(() => {
        ws.simulateMessage({ type: 'channel_update', channel: null })
      })

      expect(toast).not.toHaveBeenCalled()
    })

    test('rapid switches reuse one toast id so they replace each other', () => {
      const ws = connect()

      act(() => {
        ws.simulateMessage({ type: 'channel_update', channel: espn, changedBy: 'alice' })
        ws.simulateMessage({
          type: 'channel_update',
          channel: { id: '3', name: 'TSN', streamUrl: 'http://stream.url/tsn' },
          changedBy: 'bob',
        })
      })

      const calls = vi.mocked(toast).mock.calls
      expect(calls.map((c) => c[0])).toEqual(['alice put on ESPN', 'bob put on TSN'])
      expect(calls.map((c) => (c[1] as { id: string }).id)).toEqual(['live-channel-change', 'live-channel-change'])
    })

    test('stores the last change even when pop-ups are off', () => {
      useUIStore.setState({ notificationsEnabled: false })
      vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
      const ws = connect()

      act(() => {
        ws.simulateMessage({ type: 'channel_update', channel: espn, changedBy: 'alice' })
      })

      expect(useChannelStore.getState().lastChange).toEqual({
        by: 'alice',
        at: 1_700_000_000_000,
        channelName: 'ESPN',
      })

      act(() => {
        ws.simulateMessage({ type: 'channel_update', channel: null })
      })

      expect(useChannelStore.getState().lastChange).toEqual({
        by: null,
        at: 1_700_000_000_000,
        channelName: null,
      })
    })

    test('respects notification preference change during session', () => {
      useUIStore.setState({ notificationsEnabled: false })
      const ws = connect()

      // First update with notifications disabled
      act(() => {
        ws.simulateMessage({
          type: 'channel_update',
          channel: { id: '1', name: 'Channel 1', streamUrl: 'http://stream.url/1' },
          changedBy: 'alice',
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
          changedBy: 'alice',
        })
      })

      expect(vi.mocked(toast).mock.calls[0][0]).toBe('alice put on Channel 2')
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

    test('passes the sender userId through to the store', () => {
      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
        ws.simulateMessage({
          type: 'chat_message',
          messageId: 'msg-1',
          username: 'TestUser',
          userId: 'u_0123456789abcdef',
          content: 'Hello world!',
          timestamp: '2026-01-08T12:00:00Z',
        })
      })

      expect(useChatStore.getState().messages[0].userId).toBe('u_0123456789abcdef')
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

      expect(JSON.parse(ws.send.mock.calls.at(-1)![0])).toMatchObject({ type: 'chat_message', content: 'Hello everyone!', clientMessageId: expect.any(String) })
    })

    test('sends the clientMessageId it is given, so a retry keeps its id', () => {
      const { result } = renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]
      act(() => ws.simulateOpen())

      act(() => {
        result.current.sendChatMessage('Hello again', 'retry-id-1')
      })

      expect(JSON.parse(ws.send.mock.calls.at(-1)![0])).toEqual({ type: 'chat_message', content: 'Hello again', clientMessageId: 'retry-id-1' })
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
    beforeEach(() => {
      localStorage.clear()
    })

    test('sends the stored nickname after connection_ack, not on open', () => {
      localStorage.setItem('chat_nickname:testuser', 'TestNick')

      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
      })

      expect(ws.send).not.toHaveBeenCalledWith(expect.stringContaining('set_nickname'))

      act(() => {
        ws.simulateMessage({ type: 'connection_ack', currentChannel: null, you: { username: 'testuser' } })
      })

      expect(useChatStore.getState().me).toEqual({ username: 'testuser' })
      expect(useChatStore.getState().nickname).toBe('TestNick')
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'set_nickname',
          nickname: 'TestNick',
        })
      )
    })

    test('records the userId from connection_ack', () => {
      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
        ws.simulateMessage({
          type: 'connection_ack',
          currentChannel: null,
          you: { username: 'testuser', userId: 'u_0123456789abcdef' },
        })
      })

      expect(useChatStore.getState().me).toEqual({ username: 'testuser', userId: 'u_0123456789abcdef' })
    })

    test('nickname_taken puts back the name the server still uses and records the refusal', () => {
      localStorage.setItem('chat_nickname:testuser', 'Jon')

      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
        ws.simulateMessage({ type: 'connection_ack', currentChannel: null, you: { username: 'testuser' } })
      })
      expect(useChatStore.getState().nickname).toBe('Jon')

      act(() => {
        ws.simulateMessage({ type: 'error', code: 'nickname_taken', nickname: 'Jon' })
      })

      // The server kept the sign-in name for this new socket
      expect(useChatStore.getState().nickname).toBeNull()
      expect(localStorage.getItem('chat_nickname:testuser')).toBeNull()
      expect(useChatStore.getState().nicknameRejection).toEqual({ nickname: 'Jon' })
    })

    test('other server errors leave the nickname alone', () => {
      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
        ws.simulateMessage({ type: 'connection_ack', currentChannel: null, you: { username: 'testuser' } })
        useChatStore.getState().setNickname('TestNick')
        ws.simulateMessage({ type: 'error', code: 'invalid_message' })
      })

      expect(useChatStore.getState().nickname).toBe('TestNick')
      expect(useChatStore.getState().nicknameRejection).toBeNull()
    })

    test('does not send set_nickname after connection_ack when that user has none stored', () => {
      // Someone else's nickname on the same browser must not be used
      localStorage.setItem('chat_nickname:someoneelse', 'OtherNick')
      useChatStore.setState({ nickname: 'OtherNick', me: { username: 'someoneelse' } })

      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
        ws.simulateMessage({ type: 'connection_ack', currentChannel: null, you: { username: 'testuser' } })
      })

      expect(useChatStore.getState().me).toEqual({ username: 'testuser' })
      expect(useChatStore.getState().nickname).toBeNull()
      expect(ws.send).not.toHaveBeenCalledWith(expect.stringContaining('set_nickname'))
    })

    test('resets the chat identity on sign-out, although the view holding the socket unmounts', () => {
      // Like App.tsx: the view that owns the socket only renders while signed in,
      // so it unmounts in the same update that clears the token
      function SocketOwner() {
        useWebSocket()
        return null
      }
      function SignedInOnly() {
        const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
        return isAuthenticated ? createElement(SocketOwner) : null
      }
      render(createElement(SignedInOnly))
      const ws = MockWebSocket.instances[0]

      act(() => {
        ws.simulateOpen()
        ws.simulateMessage({ type: 'connection_ack', currentChannel: null, you: { username: 'testuser' } })
      })
      act(() => {
        useChatStore.getState().setNickname('TestNick')
      })
      expect(useChatStore.getState().me).toEqual({ username: 'testuser' })

      act(() => {
        useAuthStore.getState().logout()
      })

      expect(useChatStore.getState().me).toBeNull()
      expect(useChatStore.getState().nickname).toBeNull()
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

  describe('presence', () => {
    const jon: PresenceEntry = {
      userId: 'u_0123456789abcdef',
      displayName: 'Jon',
      channelId: '12',
      channelName: 'TSN 1',
      programme: 'Hockey Night',
      view: 'live',
      since: '2026-09-27T01:00:00+00:00',
    }
    const mia: PresenceEntry = {
      userId: 'u_fedcba9876543210',
      displayName: 'Mia',
      channelId: null,
      channelName: null,
      programme: null,
      view: null,
      since: null,
    }

    function connect() {
      const hook = renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]
      act(() => ws.simulateOpen())
      return { ...hook, ws }
    }

    test('fills the presence store from the snapshot in connection_ack', () => {
      const { ws } = connect()

      act(() => ws.simulateMessage({ type: 'connection_ack', currentChannel: null, presence: [jon, mia] }))

      expect(usePresenceStore.getState().entries).toEqual([jon, mia])
    })

    test('presence_update replaces who is here', () => {
      const { ws } = connect()
      act(() => ws.simulateMessage({ type: 'connection_ack', currentChannel: null, presence: [jon, mia] }))

      act(() => ws.simulateMessage({ type: 'presence_update', presence: [mia] }))

      expect(usePresenceStore.getState().entries).toEqual([mia])
    })

    test('presence_update with nobody here empties the list', () => {
      const { ws } = connect()
      act(() => ws.simulateMessage({ type: 'presence_update', presence: [jon] }))

      act(() => ws.simulateMessage({ type: 'presence_update', presence: [] }))

      expect(usePresenceStore.getState().entries).toEqual([])
    })

    test('an ack from an older server without presence leaves the list alone', () => {
      usePresenceStore.setState({ entries: [jon] })
      const { ws } = connect()

      act(() => ws.simulateMessage({ type: 'connection_ack', currentChannel: null }))

      expect(usePresenceStore.getState().entries).toEqual([jon])
    })

    test('ignores a presence_update from a socket that has been replaced', () => {
      const { result, ws: oldSocket } = connect()
      act(() => result.current.reconnect())
      const newSocket = MockWebSocket.instances[1]
      act(() => newSocket.simulateOpen())
      act(() => newSocket.simulateMessage({ type: 'presence_update', presence: [mia] }))

      act(() => oldSocket.simulateMessage({ type: 'presence_update', presence: [jon] }))

      expect(usePresenceStore.getState().entries).toEqual([mia])
    })

    test('takes the admin presence setting from connection_ack and follows settings_update', () => {
      const { ws } = connect()

      act(() => ws.simulateMessage({
        type: 'connection_ack',
        currentChannel: null,
        settings: { userChannelSelection: false, presenceVisible: true },
      }))
      expect(useSettingsStore.getState().presenceVisible).toBe(true)

      act(() => ws.simulateMessage({
        type: 'settings_update',
        settings: { userChannelSelection: true, presenceVisible: false },
      }))
      expect(useSettingsStore.getState().presenceVisible).toBe(false)
      expect(useSettingsStore.getState().userChannelSelection).toBe(true)
    })

    test('treats settings from an older server without the presence setting as off', () => {
      useSettingsStore.setState({ presenceVisible: true })
      const { ws } = connect()

      act(() => ws.simulateMessage({ type: 'settings_update', settings: { userChannelSelection: false } }))

      expect(useSettingsStore.getState().presenceVisible).toBe(false)
    })

    const presencePrefs = (ws: MockWebSocket) =>
      ws.send.mock.calls
        .map(([data]) => JSON.parse(data as string) as { type: string; hideActivity?: boolean })
        .filter((message) => message.type === 'set_presence_prefs')

    test('tells the server to hide after connection_ack, not on open', () => {
      useUIStore.setState({ hideMyActivity: true })
      const { ws } = connect()
      expect(presencePrefs(ws)).toEqual([])

      act(() => ws.simulateMessage({ type: 'connection_ack', currentChannel: null, presence: [] }))

      expect(presencePrefs(ws)).toEqual([{ type: 'set_presence_prefs', hideActivity: true }])
    })

    test('sends nothing after connection_ack for someone who shares (the server default)', () => {
      const { ws } = connect()

      act(() => ws.simulateMessage({ type: 'connection_ack', currentChannel: null, presence: [] }))

      expect(presencePrefs(ws)).toEqual([])
    })

    test('sends the preference whenever it changes', () => {
      const { ws } = connect()
      act(() => ws.simulateMessage({ type: 'connection_ack', currentChannel: null, presence: [] }))

      act(() => useUIStore.getState().setHideMyActivity(true))
      act(() => useUIStore.getState().setHideMyActivity(false))

      expect(presencePrefs(ws)).toEqual([
        { type: 'set_presence_prefs', hideActivity: true },
        { type: 'set_presence_prefs', hideActivity: false },
      ])
    })

    test('keeps a change made while offline and sends it with the next connection_ack', () => {
      renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]

      act(() => useUIStore.getState().setHideMyActivity(true))
      expect(ws.send).not.toHaveBeenCalled()

      act(() => ws.simulateOpen())
      act(() => ws.simulateMessage({ type: 'connection_ack', currentChannel: null, presence: [] }))

      expect(presencePrefs(ws)).toEqual([{ type: 'set_presence_prefs', hideActivity: true }])
    })

    test('hides again on every reconnect', () => {
      useUIStore.setState({ hideMyActivity: true })
      const { result, ws: first } = connect()
      act(() => first.simulateMessage({ type: 'connection_ack', currentChannel: null, presence: [] }))

      act(() => result.current.reconnect())
      const second = MockWebSocket.instances[1]
      act(() => second.simulateOpen())
      act(() => second.simulateMessage({ type: 'connection_ack', currentChannel: null, presence: [] }))

      expect(presencePrefs(second)).toEqual([{ type: 'set_presence_prefs', hideActivity: true }])
    })

    test('forgets who is here on sign-out or unmount', () => {
      const { ws, unmount } = connect()
      act(() => ws.simulateMessage({ type: 'presence_update', presence: [jon, mia] }))

      unmount()

      expect(usePresenceStore.getState().entries).toEqual([])
    })
  })

  describe('focus recovery', () => {
    test('reconnects on window focus when the socket is closed', () => {
      vi.useFakeTimers()
      const { result, unmount } = renderHook(() => useWebSocket())
      act(() => MockWebSocket.instances[0].simulateOpen())
      // Exhaust the fast retries so only the 30s slow timer is pending
      act(() => MockWebSocket.instances[0].simulateClose(1006))
      for (let attempt = 1; attempt <= 5; attempt++) {
        act(() => vi.advanceTimersByTime(10000))
        act(() => MockWebSocket.instances.at(-1)!.simulateClose(1006))
      }
      expect(result.current.status).toBe('disconnected')
      expect(MockWebSocket.instances).toHaveLength(6)

      act(() => window.dispatchEvent(new Event('focus')))
      expect(MockWebSocket.instances).toHaveLength(7)
      expect(result.current.status).toBe('reconnecting')
      unmount()
      vi.useRealTimers()
    })

    test('does not reconnect on window focus while the socket is open', () => {
      const { result } = renderHook(() => useWebSocket())
      const ws = MockWebSocket.instances[0]
      act(() => ws.simulateOpen())

      act(() => window.dispatchEvent(new Event('focus')))

      expect(MockWebSocket.instances).toHaveLength(1)
      expect(ws.close).not.toHaveBeenCalled()
      expect(result.current.status).toBe('connected')
    })

    test('does not reconnect on window focus while a connection attempt is in progress', () => {
      renderHook(() => useWebSocket())

      act(() => window.dispatchEvent(new Event('focus')))

      expect(MockWebSocket.instances).toHaveLength(1)
      expect(MockWebSocket.instances[0].close).not.toHaveBeenCalled()
    })

    test('stops listening for focus after unmount', () => {
      const { unmount } = renderHook(() => useWebSocket())
      act(() => MockWebSocket.instances[0].simulateOpen())
      // The token is still valid, so only a removed listener keeps focus from reconnecting
      unmount()

      act(() => window.dispatchEvent(new Event('focus')))

      expect(MockWebSocket.instances).toHaveLength(1)
    })
  })

  test('FE-10 online recovery reconnects after exhausting retries but never after expiry', async () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() => useWebSocket())
    for (let attempt = 0; attempt <= 5; attempt++) {
      act(() => MockWebSocket.instances.at(-1)!.simulateClose(1006))
      await act(() => vi.advanceTimersByTimeAsync(11000))
    }
    expect(result.current.status).toBe('disconnected')
    expect(MockWebSocket.instances).toHaveLength(6)
    act(() => window.dispatchEvent(new Event('online')))
    expect(MockWebSocket.instances).toHaveLength(7)
    act(() => MockWebSocket.instances.at(-1)!.simulateOpen())
    expect(result.current.status).toBe('connected')
    act(() => MockWebSocket.instances.at(-1)!.simulateClose(4001))
    act(() => window.dispatchEvent(new Event('online')))
    await act(() => vi.advanceTimersByTimeAsync(120000))
    expect(MockWebSocket.instances).toHaveLength(7)
    unmount()
    vi.useRealTimers()
  })


  test.each([0, 2, 3])('FE-11 reports no send for readyState %s', async (readyState) => {
    const { result } = renderHook(() => useWebSocket())
    MockWebSocket.instances.at(-1)!.readyState = readyState
    await expect(result.current.sendChatMessage('retained draft')).resolves.toBe('not-sent')
    expect(MockWebSocket.instances.at(-1)!.send).not.toHaveBeenCalled()
  })
  test('FE-11 acknowledges only the matching pending ID once', async () => {
    const { result } = renderHook(() => useWebSocket())
    const socket = MockWebSocket.instances.at(-1)!
    act(() => socket.simulateOpen())
    const completed = vi.fn()
    const sending = result.current.sendChatMessage('message').then(completed)
    const { clientMessageId } = JSON.parse(socket.send.mock.calls.at(-1)![0])
    act(() => socket.simulateMessage({ type: 'chat_ack', clientMessageId: 'different', accepted: true, messageId: 'server-id' }))
    await Promise.resolve()
    expect(completed).not.toHaveBeenCalled()
    act(() => socket.simulateMessage({ type: 'chat_ack', clientMessageId, accepted: true, messageId: 'server-id' }))
    await sending
    act(() => socket.simulateMessage({ type: 'chat_ack', clientMessageId, accepted: true, messageId: 'server-id' }))
    expect(completed).toHaveBeenCalledExactlyOnceWith('acknowledged')
    socket.send.mockImplementationOnce(() => { throw new Error('connection lost') })
    await expect(result.current.sendChatMessage('retained')).resolves.toBe('not-sent')
  })
  test.each(['disconnect', 'timeout', 'replace'])('FE-11 reports unconfirmed delivery on %s and ignores late ACK', async (action) => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() => useWebSocket())
    const socket = MockWebSocket.instances.at(-1)!
    act(() => socket.simulateOpen())
    const completed = vi.fn()
    const sending = result.current.sendChatMessage('pending').then(completed)
    const { clientMessageId } = JSON.parse(socket.send.mock.calls.at(-1)![0])
    if (action === 'timeout') await act(() => vi.advanceTimersByTimeAsync(10000))
    else if (action === 'replace') act(() => result.current.reconnect())
    else act(() => socket.simulateClose(1006))
    await sending
    act(() => socket.simulateMessage({ type: 'chat_ack', clientMessageId, accepted: true, messageId: 'server-id' }))
    expect(completed).toHaveBeenCalledExactlyOnceWith('unconfirmed')
    unmount()
    vi.useRealTimers()
  })
  test('FE-11 routed chat keeps a disconnected draft until the replacement socket acknowledges it', async () => {
    Element.prototype.scrollIntoView = vi.fn() // jsdom has no layout scrolling implementation
    useChatStore.setState({ isOpen: true, nickname: 'Synthetic sender' })
    function ChatHarness() {
      const { sendChatMessage, status } = useWebSocket()
      return createElement(ChatPanel, { onSendMessage: sendChatMessage, status })
    }
    render(createElement(ChatHarness))
    const first = MockWebSocket.instances.at(-1)!
    act(() => first.simulateOpen())
    const input = screen.getByPlaceholderText('Message the club…')
    fireEvent.change(input, { target: { value: 'Keep until acknowledged' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const oldId = JSON.parse(first.send.mock.calls.at(-1)![0]).clientMessageId
    expect(input).toHaveValue('Keep until acknowledged')
    act(() => first.simulateClose(1006))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Couldn't confirm it was sent."))
    act(() => window.dispatchEvent(new Event('online')))
    const replacement = MockWebSocket.instances.at(-1)!
    act(() => replacement.simulateOpen())
    fireEvent.keyDown(input, { key: 'Enter' })
    const newId = JSON.parse(replacement.send.mock.calls.at(-1)![0]).clientMessageId
    act(() => first.simulateMessage({ type: 'chat_ack', clientMessageId: oldId, accepted: true, messageId: 'old-server-id' }))
    expect(input).toHaveValue('Keep until acknowledged')
    act(() => replacement.simulateMessage({ type: 'chat_ack', clientMessageId: newId, accepted: true, messageId: 'new-server-id' }))
    await waitFor(() => expect(input).toHaveValue(''))
    expect(screen.getByRole('status')).toHaveTextContent('Message sent')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

})
