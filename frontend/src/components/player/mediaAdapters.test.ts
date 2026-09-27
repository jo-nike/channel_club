import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@/test/utils'
import { useLiveAdapter } from './mediaAdapters'

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
})
