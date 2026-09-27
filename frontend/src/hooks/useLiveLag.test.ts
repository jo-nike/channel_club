import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@/test/utils'
import type { MediaPlayerInstance } from '@vidstack/react'
import { measureLiveLag, measureVidstackLiveLag, useLiveLag, useVidstackLiveLag } from './useLiveLag'

// A TimeRanges with the given [start, end] ranges, in order
const timeRanges = (ranges: Array<[number, number]>): TimeRanges => ({
  length: ranges.length,
  start: (index: number) => ranges[index][0],
  end: (index: number) => ranges[index][1],
})

describe('measureLiveLag', () => {
  let video: HTMLVideoElement

  beforeEach(() => {
    video = document.createElement('video')
  })

  const setMedia = (ranges: Array<[number, number]>, currentTime: number) => {
    Object.defineProperty(video, 'buffered', { configurable: true, get: () => timeRanges(ranges) })
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => currentTime })
  }

  it('is null while nothing is buffered', () => {
    setMedia([], 0)

    expect(measureLiveLag(video)).toBeNull()
  })

  it('is the distance from the picture to the end of the last buffered range', () => {
    // An earlier range (before a seek) doesn't count
    setMedia(
      [
        [0, 4],
        [10, 42.5],
      ],
      30
    )

    expect(measureLiveLag(video)).toBe(12.5)
  })

  it('is never negative', () => {
    setMedia([[0, 10]], 10.2)

    expect(measureLiveLag(video)).toBe(0)
  })
})

describe('useLiveLag', () => {
  let video: HTMLVideoElement
  let ranges: Array<[number, number]>
  let currentTime: number

  beforeEach(() => {
    vi.useFakeTimers()
    video = document.body.appendChild(document.createElement('video'))
    ranges = []
    currentTime = 0
    Object.defineProperty(video, 'buffered', { configurable: true, get: () => timeRanges(ranges) })
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => currentTime })
  })

  afterEach(() => {
    vi.useRealTimers()
    video.remove()
  })

  const renderLag = () => renderHook(() => useLiveLag({ current: video }))
  const tick = () =>
    act(() => {
      vi.advanceTimersByTime(1000)
    })

  it('is null until the first measurement, and while nothing is buffered', () => {
    const { result } = renderLag()
    expect(result.current).toBeNull()

    tick()

    expect(result.current).toBeNull()
  })

  it('measures every second, in whole seconds', () => {
    ranges = [[0, 3.4]]
    const { result } = renderLag()

    tick()
    expect(result.current).toBe(3)

    // Paused: the picture stands still while the buffer keeps growing
    ranges = [[0, 25.6]]
    act(() => {
      vi.advanceTimersByTime(999)
    })
    expect(result.current).toBe(3)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(26)
  })

  it('measures again at once after a seek', () => {
    ranges = [[0, 30]]
    const { result } = renderLag()
    tick()
    expect(result.current).toBe(30)

    currentTime = 27
    act(() => {
      video.dispatchEvent(new Event('seeked'))
    })

    expect(result.current).toBe(3)
  })

  it('stops measuring when it unmounts', () => {
    ranges = [[0, 5]]
    const { result, unmount } = renderLag()
    tick()
    unmount()

    ranges = [[0, 50]]
    tick()
    video.dispatchEvent(new Event('seeked'))

    expect(result.current).toBe(5)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('measureVidstackLiveLag', () => {
  const live = { live: true, canPlay: true, currentTime: 100, liveSyncPosition: 130.4 }

  it("is the distance from the picture to hls.js's live position", () => {
    expect(measureVidstackLiveLag(live)).toBeCloseTo(30.4)
  })

  it('is never negative', () => {
    expect(measureVidstackLiveLag({ ...live, currentTime: 131 })).toBe(0)
  })

  it.each([
    [{ live: false }],
    [{ canPlay: false }],
    // hls.js has no live position yet, or there is no hls.js (native HLS)
    [{ liveSyncPosition: null }],
    [{ liveSyncPosition: Infinity }],
  ])('is null when the live position is unknown: %o', (state) => {
    expect(measureVidstackLiveLag({ ...live, ...state })).toBeNull()
  })
})

describe('useVidstackLiveLag', () => {
  // The MediaPlayer: its state, read directly, and its media events
  let state: { live: boolean; canPlay: boolean; currentTime: number; liveSyncPosition: number | null }
  let events: EventTarget
  let player: MediaPlayerInstance

  beforeEach(() => {
    vi.useFakeTimers()
    state = { live: true, canPlay: true, currentTime: 100, liveSyncPosition: 100 }
    events = new EventTarget()
    const fake = {
      get state() {
        return state
      },
      listen: (type: string, handler: () => void) => {
        events.addEventListener(type, handler)
        return () => events.removeEventListener(type, handler)
      },
    }
    player = fake as unknown as MediaPlayerInstance
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const renderLag = () => renderHook(() => useVidstackLiveLag(player))
  const tick = () =>
    act(() => {
      vi.advanceTimersByTime(1000)
    })

  it('is null without a player', () => {
    const { result } = renderHook(() => useVidstackLiveLag(null))

    tick()

    expect(result.current).toBeNull()
  })

  it('measures every second, in whole seconds', () => {
    const { result } = renderLag()
    expect(result.current).toBeNull()

    tick()
    expect(result.current).toBe(0)

    // Paused: the picture stands still while hls.js's live position moves on
    state = { ...state, liveSyncPosition: 125.6 }
    tick()
    expect(result.current).toBe(26)
  })

  it('measures again at once after a seek', () => {
    state = { ...state, liveSyncPosition: 160 }
    const { result } = renderLag()
    tick()
    expect(result.current).toBe(60)

    state = { ...state, currentTime: 160 }
    act(() => {
      events.dispatchEvent(new Event('seeked'))
    })

    expect(result.current).toBe(0)
  })

  it('stops measuring when it unmounts', () => {
    state = { ...state, liveSyncPosition: 105 }
    const { result, unmount } = renderLag()
    tick()
    unmount()

    state = { ...state, liveSyncPosition: 150 }
    events.dispatchEvent(new Event('seeked'))

    expect(result.current).toBe(5)
    expect(vi.getTimerCount()).toBe(0)
  })
})
