import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNowPlaying } from './useNowPlaying'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore } from '@/stores/tvStore'
import type { UnifiedChannel } from '@/types'

const cinema: UnifiedChannel = { id: 'e', name: 'Cinema', number: 1, streamUrl: '/e', type: 'ersatztv' }
const live: UnifiedChannel = { id: 'live-channel-0', name: 'Sports', number: 0, streamUrl: '/a', type: 'live' }

describe('useNowPlaying', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'))
    useErsatztvStore.setState({ programmesByChannel: { e: [
      { channelId: 'e', title: 'First', start: '2026-09-06T11:00:00Z', stop: '2026-09-06T12:00:10Z' },
      { channelId: 'e', title: 'Second', start: '2026-09-06T12:00:10Z', stop: '2026-09-06T13:00:00Z' },
    ] } })
    useTVStore.setState({ liveEPG: null })
  })

  afterEach(() => {
    vi.useRealTimers()
    useErsatztvStore.setState({ programmesByChannel: {} })
    useTVStore.setState({ liveEPG: null })
  })

  it('finds the ErsatzTV programme on air and moves on with the programme clock', async () => {
    const { result } = renderHook(() => useNowPlaying(cinema))
    expect(result.current.title).toBe('First')

    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(result.current.title).toBe('Second')
  })

  it('is null for an ErsatzTV channel with no schedule or a gap in it', () => {
    const { result: unknown, unmount } = renderHook(() => useNowPlaying({ ...cinema, id: 'other' }))
    expect(unknown.current.title).toBeNull()
    // The shared clock reads the time when its first subscriber arrives
    unmount()

    vi.setSystemTime(new Date('2026-09-06T14:00:00Z'))
    const { result: gap } = renderHook(() => useNowPlaying(cinema))
    expect(gap.current.title).toBeNull()
  })

  it("takes the live slot's title from the live guide", () => {
    const { result } = renderHook(() => useNowPlaying(live))
    expect(result.current.title).toBeNull()

    act(() => useTVStore.setState({ liveEPG: { channelId: 'a', currentProgram: {
      title: 'Big Game', startTime: '2026-09-06T11:00:00Z', endTime: '2026-09-06T13:00:00Z',
    } } }))
    expect(result.current.title).toBe('Big Game')
  })

  it('is null with no channel', () => {
    useTVStore.setState({ liveEPG: { channelId: 'a', currentProgram: {
      title: 'Big Game', startTime: '2026-09-06T11:00:00Z', endTime: '2026-09-06T13:00:00Z',
    } } })
    const { result } = renderHook(() => useNowPlaying(null))
    expect(result.current.title).toBeNull()
  })
})
