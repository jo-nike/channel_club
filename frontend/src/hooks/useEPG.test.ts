import { renderHook, waitFor } from '@testing-library/react'
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import { useEPG } from './useEPG'
import { useChannelStore } from '@/stores/channelStore'
import * as api from '@/services/api'

vi.mock('@/services/api', () => ({
  fetchNowPlaying: vi.fn(),
}))

describe('useEPG', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChannelStore.setState({
      channels: [],
      currentChannel: null,
      isLoading: false,
      error: null,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('when no channel is selected', () => {
    test('returns null epg and not loading', () => {
      const { result } = renderHook(() => useEPG())

      expect(result.current.epg).toBeNull()
      expect(result.current.isLoading).toBe(false)
    })

    test('does not call fetchNowPlaying', () => {
      renderHook(() => useEPG())

      expect(api.fetchNowPlaying).not.toHaveBeenCalled()
    })
  })

  describe('when channel is selected', () => {
    beforeEach(() => {
      useChannelStore.setState({
        currentChannel: { id: '123', name: 'Test Channel', streamUrl: 'http://test.com/stream', guideId: '1' },
      })
    })

    test('fetches EPG data for current channel', async () => {
      const mockEPG = {
        channelId: '123',
        currentProgram: {
          title: 'Test Show',
          startTime: '2025-01-01T10:00:00Z',
          endTime: '2025-01-01T11:00:00Z',
        },
      }
      vi.mocked(api.fetchNowPlaying).mockResolvedValue(mockEPG)

      const { result } = renderHook(() => useEPG())

      expect(result.current.isLoading).toBe(true)

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(api.fetchNowPlaying).toHaveBeenCalledWith('1')
      expect(result.current.epg).toEqual(mockEPG)
    })

    test('sets isLoading to true while fetching', async () => {
      vi.mocked(api.fetchNowPlaying).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ channelId: '123', currentProgram: null }), 100))
      )

      const { result } = renderHook(() => useEPG())

      expect(result.current.isLoading).toBe(true)

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
    })

    test('handles API errors gracefully by setting epg to null', async () => {
      vi.mocked(api.fetchNowPlaying).mockRejectedValue(new Error('Failed to fetch EPG'))

      const { result } = renderHook(() => useEPG())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.epg).toBeNull()
    })

    test('does not show error toast on EPG failure (silent fail)', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(api.fetchNowPlaying).mockRejectedValue(new Error('Failed to fetch EPG'))

      const { result } = renderHook(() => useEPG())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Should fail silently (no console.error from the hook itself)
      expect(result.current.epg).toBeNull()
      consoleSpy.mockRestore()
    })
  })

  describe('when channel changes', () => {
    test('re-fetches EPG data for new channel', async () => {
      const mockEPG1 = {
        channelId: '123',
        currentProgram: { title: 'Show 1', startTime: '2025-01-01T10:00:00Z', endTime: '2025-01-01T11:00:00Z' },
      }
      const mockEPG2 = {
        channelId: '456',
        currentProgram: { title: 'Show 2', startTime: '2025-01-01T10:00:00Z', endTime: '2025-01-01T11:00:00Z' },
      }

      vi.mocked(api.fetchNowPlaying).mockResolvedValueOnce(mockEPG1).mockResolvedValueOnce(mockEPG2)

      useChannelStore.setState({
        currentChannel: { id: '123', name: 'Channel 1', streamUrl: 'http://test.com/1', guideId: '1' },
      })

      const { result, rerender } = renderHook(() => useEPG())

      await waitFor(() => {
        expect(result.current.epg?.channelId).toBe('123')
      })

      // Change channel
      useChannelStore.setState({
        currentChannel: { id: '456', name: 'Channel 2', streamUrl: 'http://test.com/2', guideId: '2' },
      })

      rerender()

      await waitFor(() => {
        expect(result.current.epg?.channelId).toBe('456')
      })

      expect(api.fetchNowPlaying).toHaveBeenCalledTimes(2)
      expect(api.fetchNowPlaying).toHaveBeenNthCalledWith(1, '1')
      expect(api.fetchNowPlaying).toHaveBeenNthCalledWith(2, '2')
    })

    test('clears EPG when channel is deselected', async () => {
      const mockEPG = {
        channelId: '123',
        currentProgram: { title: 'Test Show', startTime: '2025-01-01T10:00:00Z', endTime: '2025-01-01T11:00:00Z' },
      }
      vi.mocked(api.fetchNowPlaying).mockResolvedValue(mockEPG)

      useChannelStore.setState({
        currentChannel: { id: '123', name: 'Test Channel', streamUrl: 'http://test.com/stream', guideId: '1' },
      })

      const { result, rerender } = renderHook(() => useEPG())

      await waitFor(() => {
        expect(result.current.epg).not.toBeNull()
      })

      // Deselect channel
      useChannelStore.setState({ currentChannel: null })
      rerender()

      await waitFor(() => {
        expect(result.current.epg).toBeNull()
      })
    })
  })

  describe('handling null/empty EPG data', () => {
    test('handles null currentProgram gracefully', async () => {
      const mockEPG = {
        channelId: '123',
        currentProgram: null,
      }
      vi.mocked(api.fetchNowPlaying).mockResolvedValue(mockEPG)

      useChannelStore.setState({
        currentChannel: { id: '123', name: 'Test Channel', streamUrl: 'http://test.com/stream', guideId: '1' },
      })

      const { result } = renderHook(() => useEPG())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.epg).toEqual(mockEPG)
      expect(result.current.epg?.currentProgram).toBeNull()
    })
  })

  describe('request cancellation', () => {
    test('cancels pending request when channel changes', async () => {
      let resolveFirst: (value: unknown) => void
      const firstPromise = new Promise((resolve) => {
        resolveFirst = resolve
      })

      const mockEPG2 = {
        channelId: '456',
        currentProgram: { title: 'Show 2', startTime: '2025-01-01T10:00:00Z', endTime: '2025-01-01T11:00:00Z' },
      }

      vi.mocked(api.fetchNowPlaying)
        .mockImplementationOnce(() => firstPromise as Promise<never>)
        .mockResolvedValueOnce(mockEPG2)

      useChannelStore.setState({
        currentChannel: { id: '123', name: 'Channel 1', streamUrl: 'http://test.com/1', guideId: '1' },
      })

      const { result, rerender } = renderHook(() => useEPG())

      // Change channel before first request resolves
      useChannelStore.setState({
        currentChannel: { id: '456', name: 'Channel 2', streamUrl: 'http://test.com/2', guideId: '2' },
      })
      rerender()

      // Resolve first request (should be ignored due to cancellation)
      resolveFirst!({
        channelId: '123',
        currentProgram: { title: 'Show 1', startTime: '2025-01-01T10:00:00Z', endTime: '2025-01-01T11:00:00Z' },
      })

      await waitFor(() => {
        expect(result.current.epg?.channelId).toBe('456')
      })

      // Should show channel 2's EPG, not channel 1's
      expect(result.current.epg?.currentProgram?.title).toBe('Show 2')
    })
  })
})
