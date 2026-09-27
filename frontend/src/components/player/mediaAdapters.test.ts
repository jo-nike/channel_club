import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@/test/utils'
import { useLiveAdapter, useVidstackAdapter } from './mediaAdapters'

// Vidstack's hooks read the nearest MediaPlayer; this stands in for its state,
// its remote control and the player itself, whose state is read directly and
// which dispatches its media events
const vidstack = vi.hoisted(() => {
  const harness = {
    state: {} as Record<string, unknown>,
    remote: {
      togglePaused: vi.fn(),
      unmute: vi.fn(),
      mute: vi.fn(),
      changeVolume: vi.fn(),
      seekToLiveEdge: vi.fn(),
      seek: vi.fn(),
      play: vi.fn(),
    },
    events: new EventTarget(),
    provider: { setCurrentTime: vi.fn<(time: number) => void>() },
    player: {
      get state() {
        return harness.state
      },
      get provider() {
        return harness.provider
      },
      listen: (type: string, handler: () => void) => {
        harness.events.addEventListener(type, handler)
        return () => harness.events.removeEventListener(type, handler)
      },
    },
  }
  return harness
})
vi.mock('@vidstack/react', () => ({
  useMediaState: (prop: string) => vidstack.state[prop],
  useMediaRemote: () => vidstack.remote,
  useMediaPlayer: () => vidstack.player,
}))

describe('useLiveAdapter', () => {
  let video: HTMLVideoElement

  beforeEach(() => {
    video = document.body.appendChild(document.createElement('video'))
  })

  afterEach(() => {
    video.remove()
    vi.restoreAllMocks()
  })

  const renderAdapter = () => renderHook(() => useLiveAdapter({ current: video }))
  const fire = (type: string) =>
    act(() => {
      video.dispatchEvent(new Event(type))
    })

  it('starts paused, unmuted, not ready, as an MPEG-TS stream', () => {
    const { result } = renderAdapter()

    expect(result.current).toMatchObject({
      isPlaying: false,
      elementMuted: false,
      canPlay: false,
      streamType: 'mpegts',
    })
  })

  it.each(['play', 'playing'])('is playing after %s, and not after pause', (event) => {
    const { result } = renderAdapter()

    fire(event)
    expect(result.current.isPlaying).toBe(true)

    fire('pause')
    expect(result.current.isPlaying).toBe(false)
  })

  it('can play once the element says so', () => {
    const { result } = renderAdapter()

    fire('canplay')

    expect(result.current.canPlay).toBe(true)
  })

  it("follows the element's own mute, whoever set it", () => {
    const { result } = renderAdapter()

    act(() => {
      video.muted = true
    })
    expect(result.current.elementMuted).toBe(true)

    act(() => {
      video.muted = false
    })
    expect(result.current.elementMuted).toBe(false)
  })

  it('unmuteElement unmutes only the element', () => {
    const { result } = renderAdapter()
    video.muted = true

    act(() => result.current.unmuteElement())

    expect(video.muted).toBe(false)
  })

  it('togglePaused plays a paused element and pauses a playing one', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const { result } = renderAdapter()

    result.current.togglePaused()
    expect(play).toHaveBeenCalledTimes(1)
    expect(pause).not.toHaveBeenCalled()

    vi.spyOn(video, 'paused', 'get').mockReturnValue(false)
    result.current.togglePaused()
    expect(pause).toHaveBeenCalledTimes(1)
  })

  // vitest fails a run on an unhandled rejection
  it('a refused play is not an unhandled rejection', async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValue(new DOMException('refused', 'NotAllowedError'))
    const { result } = renderAdapter()

    result.current.togglePaused()
    await act(async () => {})

    expect(play).toHaveBeenCalledTimes(1)
  })

  it('stops listening when it unmounts', () => {
    const { result, unmount } = renderAdapter()
    unmount()

    fire('playing')

    expect(result.current.isPlaying).toBe(false)
  })

  describe('behind live', () => {
    // jsdom buffers nothing and keeps the picture at 0s; these stand in
    let bufferedEnd: number | null
    let currentTime: number

    beforeEach(() => {
      vi.useFakeTimers()
      bufferedEnd = null
      currentTime = 0
      Object.defineProperty(video, 'buffered', {
        configurable: true,
        get: (): TimeRanges => ({
          length: bufferedEnd === null ? 0 : 1,
          start: () => 0,
          end: () => bufferedEnd ?? 0,
        }),
      })
      Object.defineProperty(video, 'currentTime', {
        configurable: true,
        get: () => currentTime,
        set: (time: number) => {
          currentTime = time
        },
      })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    const tick = () =>
      act(() => {
        vi.advanceTimersByTime(1000)
      })

    it('is at the live edge until the picture is more than 10s short of the buffered end', () => {
      const { result } = renderAdapter()
      expect(result.current.isBehindLive).toBe(false)

      currentTime = 20
      bufferedEnd = 30
      tick()
      expect(result.current.isBehindLive).toBe(false)

      bufferedEnd = 31
      tick()
      expect(result.current.isBehindLive).toBe(true)
    })

    it('jumpToLive lands 3s short of the buffered end and plays a paused element', () => {
      const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
      bufferedEnd = 60
      currentTime = 20
      const { result } = renderAdapter()
      tick()
      expect(result.current.isBehindLive).toBe(true)

      act(() => result.current.jumpToLive())

      expect(currentTime).toBe(57)
      expect(play).toHaveBeenCalledTimes(1)
      // The seek measures again at once
      fire('seeked')
      expect(result.current.isBehindLive).toBe(false)
    })

    it('jumpToLive never seeks back, and leaves a playing element playing', () => {
      const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
      vi.spyOn(video, 'paused', 'get').mockReturnValue(false)
      bufferedEnd = 10
      currentTime = 9
      const { result } = renderAdapter()

      act(() => result.current.jumpToLive())

      expect(currentTime).toBe(9)
      expect(play).not.toHaveBeenCalled()
    })
  })
})

describe('useVidstackAdapter', () => {
  beforeEach(() => {
    vidstack.state = { paused: true, muted: false, canPlay: false, volume: 1, live: false, liveSyncPosition: null }
    Object.values(vidstack.remote).forEach((fn) => fn.mockClear())
    vidstack.provider.setCurrentTime.mockClear()
  })

  it('starts paused, unmuted, not ready, as an HLS stream', () => {
    const { result } = renderHook(() => useVidstackAdapter())

    expect(result.current).toMatchObject({
      isPlaying: false,
      elementMuted: false,
      canPlay: false,
      streamType: 'hls',
    })
  })

  it("follows the player's paused, muted and can-play state", () => {
    const { result, rerender } = renderHook(() => useVidstackAdapter())

    vidstack.state = { paused: false, muted: true, canPlay: true, volume: 1 }
    rerender()

    expect(result.current).toMatchObject({ isPlaying: true, elementMuted: true, canPlay: true })
  })

  it('togglePaused asks the player to toggle', () => {
    const { result } = renderHook(() => useVidstackAdapter())

    result.current.togglePaused()

    expect(vidstack.remote.togglePaused).toHaveBeenCalledTimes(1)
  })

  it('unmuteElement asks the player to unmute and never touches the volume', () => {
    const { result } = renderHook(() => useVidstackAdapter())

    result.current.unmuteElement()

    expect(vidstack.remote.unmute).toHaveBeenCalledTimes(1)
    expect(vidstack.remote.changeVolume).not.toHaveBeenCalled()
  })

  describe('behind live', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    const tick = () =>
      act(() => {
        vi.advanceTimersByTime(1000)
      })
    // An ErsatzTV playlist is a plain sliding window: Vidstack sees it as
    // live without DVR, so it can't seek and its liveEdge is always true.
    // hls.js's live position moves on while the paused picture stands still.
    const pausedOnLive = (behind: number) => ({
      paused: true,
      canPlay: true,
      live: true,
      streamType: 'live',
      canSeek: false,
      liveEdge: true,
      currentTime: 100,
      liveSyncPosition: 100 + behind,
    })

    it("is behind once the picture is more than 10s short of hls.js's live position, whatever Vidstack's liveEdge says", () => {
      vidstack.state = pausedOnLive(10)
      const { result } = renderHook(() => useVidstackAdapter())
      tick()
      expect(result.current.isBehindLive).toBe(false)

      vidstack.state = pausedOnLive(60)
      tick()
      expect(result.current.isBehindLive).toBe(true)
    })

    it.each([
      // A stream Vidstack doesn't see as live has no edge to be behind
      [{ live: false }],
      [{ canPlay: false }],
      // Before hls.js has a live position, and with no hls.js (native HLS)
      [{ liveSyncPosition: null }],
      [{ liveSyncPosition: Infinity }],
    ])('says nothing when the live position is unknown: %o', (state) => {
      vidstack.state = { ...pausedOnLive(60), ...state }
      const { result } = renderHook(() => useVidstackAdapter())

      tick()

      expect(result.current.isBehindLive).toBe(false)
    })

    it("jumpToLive moves the picture to hls.js's live position and plays it; a seek measures again at once", () => {
      vidstack.state = pausedOnLive(60)
      const { result } = renderHook(() => useVidstackAdapter())
      tick()
      expect(result.current.isBehindLive).toBe(true)

      act(() => result.current.jumpToLive())

      expect(vidstack.provider.setCurrentTime).toHaveBeenCalledExactlyOnceWith(160)
      expect(vidstack.remote.play).toHaveBeenCalledTimes(1)
      // Vidstack's own seeks are no-ops on this stream, so they aren't the way
      expect(vidstack.remote.seekToLiveEdge).not.toHaveBeenCalled()
      expect(vidstack.remote.seek).not.toHaveBeenCalled()

      vidstack.state = { ...vidstack.state, paused: false, currentTime: 160 }
      act(() => {
        vidstack.events.dispatchEvent(new Event('seeked'))
      })
      expect(result.current.isBehindLive).toBe(false)
    })

    it('jumpToLive never seeks back or without a live position, and leaves a playing picture playing', () => {
      vidstack.state = { ...pausedOnLive(0), paused: false, currentTime: 101, liveSyncPosition: 100 }
      const { result, rerender } = renderHook(() => useVidstackAdapter())

      result.current.jumpToLive()
      vidstack.state = { ...vidstack.state, liveSyncPosition: null }
      rerender()
      result.current.jumpToLive()

      expect(vidstack.provider.setCurrentTime).not.toHaveBeenCalled()
      expect(vidstack.remote.play).not.toHaveBeenCalled()
    })

    it('stops measuring when it unmounts', () => {
      vidstack.state = pausedOnLive(60)
      const { unmount } = renderHook(() => useVidstackAdapter())
      unmount()

      expect(vi.getTimerCount()).toBe(0)
    })
  })

  it('stays the same object until the player state changes', () => {
    const { result, rerender } = renderHook(() => useVidstackAdapter())
    const first = result.current

    rerender()
    expect(result.current).toBe(first)

    vidstack.state = { ...vidstack.state, paused: false }
    rerender()
    expect(result.current).not.toBe(first)
    expect(result.current.togglePaused).toBe(first.togglePaused)
  })
})
