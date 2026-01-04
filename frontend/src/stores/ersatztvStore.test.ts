import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import { useErsatztvStore } from './ersatztvStore'
import type { ErsatzTVChannel } from '@/types'

// Mock the API service
vi.mock('@/services/ersatztvApi', () => ({
  fetchErsatzTVChannels: vi.fn(),
  fetchErsatzTVProgrammes: vi.fn(),
  fetchErsatzTVCurrentProgramme: vi.fn(),
}))

// Import mocked functions
import {
  fetchErsatzTVChannels,
  fetchErsatzTVProgrammes,
  fetchErsatzTVCurrentProgramme,
} from '@/services/ersatztvApi'

describe('ersatztvStore', () => {
  const mockChannel: ErsatzTVChannel = {
    id: 'ch1',
    name: 'Test Channel',
    streamUrl: 'http://test/stream',
    logoUrl: 'http://test/logo',
    number: 1,
    group: 'Movies',
  }

  const mockChannels: ErsatzTVChannel[] = [
    mockChannel,
    {
      id: 'ch2',
      name: 'Another Channel',
      streamUrl: 'http://test/stream2',
      logoUrl: 'http://test/logo2',
      number: 2,
      group: 'Series',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state
    useErsatztvStore.setState({
      channels: [],
      selectedChannel: null,
      programmes: [],
      currentProgramme: null,
      nextProgramme: null,
      loading: false,
      error: null,
    })
  })

  describe('initial state', () => {
    it('has correct initial values', () => {
      const state = useErsatztvStore.getState()
      expect(state.channels).toEqual([])
      expect(state.selectedChannel).toBeNull()
      expect(state.programmes).toEqual([])
      expect(state.currentProgramme).toBeNull()
      expect(state.nextProgramme).toBeNull()
      expect(state.loading).toBe(false)
      expect(state.error).toBeNull()
    })
  })

  describe('loadChannels', () => {
    it('loads channels successfully', async () => {
      vi.mocked(fetchErsatzTVChannels).mockResolvedValue(mockChannels)

      await act(async () => {
        await useErsatztvStore.getState().loadChannels()
      })

      const state = useErsatztvStore.getState()
      expect(state.channels).toEqual(mockChannels)
      expect(state.loading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('sets loading state during fetch', async () => {
      let resolvePromise: (value: ErsatzTVChannel[]) => void
      const promise = new Promise<ErsatzTVChannel[]>((resolve) => {
        resolvePromise = resolve
      })
      vi.mocked(fetchErsatzTVChannels).mockReturnValue(promise)

      const loadPromise = useErsatztvStore.getState().loadChannels()

      // Check loading is true while fetching
      expect(useErsatztvStore.getState().loading).toBe(true)

      await act(async () => {
        resolvePromise!(mockChannels)
        await loadPromise
      })

      expect(useErsatztvStore.getState().loading).toBe(false)
    })

    it('sets error on channel load failure', async () => {
      vi.mocked(fetchErsatzTVChannels).mockRejectedValue(
        new Error('Network error')
      )

      await act(async () => {
        await useErsatztvStore.getState().loadChannels()
      })

      const state = useErsatztvStore.getState()
      expect(state.error).toBe('Network error')
      expect(state.loading).toBe(false)
      expect(state.channels).toEqual([])
    })

    it('clears previous error on new load', async () => {
      // Set initial error state
      useErsatztvStore.setState({ error: 'Previous error' })

      vi.mocked(fetchErsatzTVChannels).mockResolvedValue(mockChannels)

      await act(async () => {
        await useErsatztvStore.getState().loadChannels()
      })

      expect(useErsatztvStore.getState().error).toBeNull()
    })
  })

  describe('selectChannel', () => {
    it('selects channel and updates state', async () => {
      vi.mocked(fetchErsatzTVCurrentProgramme).mockResolvedValue({
        channelId: 'ch1',
        current: null,
        nextUp: null,
      })

      act(() => {
        useErsatztvStore.getState().selectChannel(mockChannel)
      })

      expect(useErsatztvStore.getState().selectedChannel).toEqual(mockChannel)
    })

    it('auto-loads current programme on channel select', async () => {
      const mockCurrentResponse = {
        channelId: 'ch1',
        current: {
          id: 'prog1',
          channelId: 'ch1',
          title: 'Current Movie',
          start: '2024-01-01T10:00:00Z',
          stop: '2024-01-01T12:00:00Z',
        },
        nextUp: {
          id: 'prog2',
          channelId: 'ch1',
          title: 'Next Movie',
          start: '2024-01-01T12:00:00Z',
          stop: '2024-01-01T14:00:00Z',
        },
      }
      vi.mocked(fetchErsatzTVCurrentProgramme).mockResolvedValue(
        mockCurrentResponse
      )

      await act(async () => {
        useErsatztvStore.getState().selectChannel(mockChannel)
        // Wait for the async loadCurrentProgramme to complete
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(fetchErsatzTVCurrentProgramme).toHaveBeenCalledWith('ch1')
    })
  })

  describe('loadProgrammes', () => {
    it('loads programmes for a channel', async () => {
      const mockProgrammes = [
        {
          id: 'prog1',
          channelId: 'ch1',
          title: 'Movie 1',
          start: '2024-01-01T10:00:00Z',
          stop: '2024-01-01T12:00:00Z',
        },
        {
          id: 'prog2',
          channelId: 'ch1',
          title: 'Movie 2',
          start: '2024-01-01T12:00:00Z',
          stop: '2024-01-01T14:00:00Z',
        },
      ]
      vi.mocked(fetchErsatzTVProgrammes).mockResolvedValue({
        channelId: 'ch1',
        programmes: mockProgrammes,
      })

      await act(async () => {
        await useErsatztvStore.getState().loadProgrammes('ch1', 6)
      })

      const state = useErsatztvStore.getState()
      expect(state.programmes).toEqual(mockProgrammes)
      expect(state.loading).toBe(false)
      expect(fetchErsatzTVProgrammes).toHaveBeenCalledWith('ch1', 6)
    })

    it('uses default hours when not specified', async () => {
      vi.mocked(fetchErsatzTVProgrammes).mockResolvedValue({
        channelId: 'ch1',
        programmes: [],
      })

      await act(async () => {
        await useErsatztvStore.getState().loadProgrammes('ch1')
      })

      expect(fetchErsatzTVProgrammes).toHaveBeenCalledWith('ch1', 6)
    })

    it('sets error on programme load failure', async () => {
      vi.mocked(fetchErsatzTVProgrammes).mockRejectedValue(
        new Error('Failed to load')
      )

      await act(async () => {
        await useErsatztvStore.getState().loadProgrammes('ch1')
      })

      expect(useErsatztvStore.getState().error).toBe('Failed to load')
    })
  })

  describe('loadCurrentProgramme', () => {
    it('loads current and next programme', async () => {
      const mockCurrent = {
        id: 'prog1',
        channelId: 'ch1',
        title: 'Current',
        start: '2024-01-01T10:00:00Z',
        stop: '2024-01-01T12:00:00Z',
      }
      const mockNext = {
        id: 'prog2',
        channelId: 'ch1',
        title: 'Next',
        start: '2024-01-01T12:00:00Z',
        stop: '2024-01-01T14:00:00Z',
      }
      vi.mocked(fetchErsatzTVCurrentProgramme).mockResolvedValue({
        channelId: 'ch1',
        current: mockCurrent,
        nextUp: mockNext,
      })

      await act(async () => {
        await useErsatztvStore.getState().loadCurrentProgramme('ch1')
      })

      const state = useErsatztvStore.getState()
      expect(state.currentProgramme).toEqual(mockCurrent)
      expect(state.nextProgramme).toEqual(mockNext)
    })

    it('silently fails and clears programme on error', async () => {
      // Set initial programme state
      useErsatztvStore.setState({
        currentProgramme: {
          id: 'old',
          channelId: 'ch1',
          title: 'Old',
          start: '',
          stop: '',
        },
        nextProgramme: {
          id: 'old2',
          channelId: 'ch1',
          title: 'Old Next',
          start: '',
          stop: '',
        },
      })

      vi.mocked(fetchErsatzTVCurrentProgramme).mockRejectedValue(
        new Error('Network error')
      )

      await act(async () => {
        await useErsatztvStore.getState().loadCurrentProgramme('ch1')
      })

      const state = useErsatztvStore.getState()
      expect(state.currentProgramme).toBeNull()
      expect(state.nextProgramme).toBeNull()
      // Should not set error - silent fail
      expect(state.error).toBeNull()
    })
  })

  describe('clearError', () => {
    it('clears error state', () => {
      useErsatztvStore.setState({ error: 'Some error' })

      act(() => {
        useErsatztvStore.getState().clearError()
      })

      expect(useErsatztvStore.getState().error).toBeNull()
    })
  })
})
