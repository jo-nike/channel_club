import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNowPlaying } from './useNowPlaying'
import { useChannelStore } from '@/stores/channelStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore } from '@/stores/tvStore'
import type { UnifiedChannel } from '@/types'

vi.mock('@/services/api', () => ({ fetchNowPlaying: vi.fn(() => new Promise(() => {})) }))

const cinema: UnifiedChannel = { id: 'e', name: 'Cinema', number: 1, streamUrl: '/e', type: 'ersatztv' }
const live: UnifiedChannel = { id: 'live-channel-0', name: 'Sports', number: 0, streamUrl: '/a', type: 'live' }

const ms = (iso: string) => new Date(iso).getTime()

describe('useNowPlaying', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'))
    useErsatztvStore.setState({ programmesByChannel: { e: [
      { id: 'p1', channelId: 'e', title: 'First', start: '2026-09-06T11:00:00Z', stop: '2026-09-06T12:00:10Z' },
      { id: 'p2', channelId: 'e', title: 'Second', start: '2026-09-06T12:00:10Z', stop: '2026-09-06T13:00:00Z' },
    ] } })
    useTVStore.setState({ liveEPG: null })
    useChannelStore.setState({ currentChannel: null })
  })

  afterEach(() => {
    vi.useRealTimers()
    useErsatztvStore.setState({ programmesByChannel: {} })
    useTVStore.setState({ liveEPG: null })
    useChannelStore.setState({ currentChannel: null })
  })

  it('finds the ErsatzTV programme on air and moves on with the programme clock', async () => {
    const { result } = renderHook(() => useNowPlaying(cinema))
    expect(result.current).toEqual({
      title: 'First',
      startMs: ms('2026-09-06T11:00:00Z'),
      endMs: ms('2026-09-06T12:00:10Z'),
      timeLeft: '1m left',
      progress: expect.closeTo((3600 / 3610) * 100),
      isLive: false,
      hasLiveChannel: false,
    })

    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(result.current).toMatchObject({
      title: 'Second',
      startMs: ms('2026-09-06T12:00:10Z'),
      endMs: ms('2026-09-06T13:00:00Z'),
      timeLeft: '1h left',
    })
    // 20s into a 59m50s programme
    expect(result.current.progress).toBeCloseTo((20 / 3590) * 100)
  })

  it('is empty for an ErsatzTV channel with no schedule or a gap in it', () => {
    const { result: unknown, unmount } = renderHook(() => useNowPlaying({ ...cinema, id: 'other' }))
    expect(unknown.current).toMatchObject({ title: null, startMs: null, endMs: null, timeLeft: null, progress: null })
    // The shared clock reads the time when its first subscriber arrives
    unmount()

    vi.setSystemTime(new Date('2026-09-06T14:00:00Z'))
    const { result: gap } = renderHook(() => useNowPlaying(cinema))
    expect(gap.current).toMatchObject({ title: null, timeLeft: null, progress: null, isLive: false })
  })

  it("takes the live slot's programme from the live guide", () => {
    useChannelStore.setState({ currentChannel: { id: 'a', name: 'Sports', streamUrl: '/a', guideId: 'g' } })
    const { result } = renderHook(() => useNowPlaying(live))
    expect(result.current).toMatchObject({ title: null, timeLeft: null, isLive: true, hasLiveChannel: true })

    act(() => useTVStore.setState({ liveEPG: { channelId: 'a', currentProgram: {
      title: 'Big Game', startTime: '2026-09-06T11:00:00Z', endTime: '2026-09-06T13:05:00Z',
    } } }))
    expect(result.current).toEqual({
      title: 'Big Game',
      startMs: ms('2026-09-06T11:00:00Z'),
      endMs: ms('2026-09-06T13:05:00Z'),
      timeLeft: '1h 5m left',
      progress: expect.closeTo(48),
      isLive: true,
      hasLiveChannel: true,
    })
  })

  it('says Ending... once a live programme has run past its end', () => {
    useTVStore.setState({ liveEPG: { channelId: 'a', currentProgram: {
      title: 'Overtime', startTime: '2026-09-06T10:00:00Z', endTime: '2026-09-06T11:59:00Z',
    } } })
    const { result } = renderHook(() => useNowPlaying(live))
    expect(result.current).toMatchObject({ title: 'Overtime', timeLeft: 'Ending...', progress: 100 })
  })

  it('reports live TV being on while watching another channel', () => {
    const { result } = renderHook(() => useNowPlaying(cinema))
    expect(result.current.hasLiveChannel).toBe(false)

    act(() => useChannelStore.setState({ currentChannel: { id: 'a', name: 'Sports', streamUrl: '/a', guideId: 'g' } }))
    expect(result.current).toMatchObject({ title: 'First', isLive: false, hasLiveChannel: true })
  })

  it('is empty with no channel', () => {
    useTVStore.setState({ liveEPG: { channelId: 'a', currentProgram: {
      title: 'Big Game', startTime: '2026-09-06T11:00:00Z', endTime: '2026-09-06T13:00:00Z',
    } } })
    const { result } = renderHook(() => useNowPlaying(null))
    expect(result.current).toEqual({
      title: null, startMs: null, endMs: null, timeLeft: null, progress: null, isLive: false, hasLiveChannel: false,
    })
  })
})
