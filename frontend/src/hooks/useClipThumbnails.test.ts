import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@/test/utils'
import { useClipThumbnails } from './useClipThumbnails'

let decoder: HTMLVideoElement
let drawn = 0

beforeEach(() => {
  vi.useFakeTimers()
  drawn = 0
  const create = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
    const element = create(tag, options)
    if (tag === 'video') decoder = element as HTMLVideoElement
    return element
  })
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => `data:frame-${drawn++}`)
})

afterEach(() => {
  cleanup() // Unmount while load() is still mocked.
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function fire(event: string) {
  await act(async () => { decoder.dispatchEvent(new Event(event)) })
}

describe('useClipThumbnails', () => {
  it('fills the fixed slots one by one as each frame is drawn', async () => {
    const { result } = renderHook(() => useClipThumbnails('/clip.mp4', 60))
    expect(result.current).toEqual({ frames: Array(10).fill(null), loading: true })
    expect(decoder.getAttribute('src')).toBe('/clip.mp4')
    await fire('loadeddata')
    expect(decoder.currentTime).toBe(3)
    await fire('seeked')
    expect(result.current.frames[0]).toBe('data:frame-0')
    expect(result.current.frames.slice(1)).toEqual(Array(9).fill(null))
    expect(result.current.loading).toBe(true)
    await fire('seeked')
    expect(result.current.frames.slice(0, 3)).toEqual(['data:frame-0', 'data:frame-1', null])
    for (let i = 2; i < 10; i++) await fire('seeked')
    expect(result.current.frames).toEqual(Array.from({ length: 10 }, (_, i) => `data:frame-${i}`))
    expect(result.current.loading).toBe(false)
  })

  it('leaves a slot empty when its seek times out and still draws the next frame', async () => {
    const { result } = renderHook(() => useClipThumbnails('/clip.mp4', 60))
    await fire('loadeddata')
    await fire('seeked')
    expect(decoder.currentTime).toBe(9)
    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
    expect(result.current.frames[1]).toBeNull()
    expect(decoder.currentTime).toBe(15)
    await fire('seeked')
    expect(result.current.frames.slice(0, 3)).toEqual(['data:frame-0', null, 'data:frame-1'])
    expect(result.current.loading).toBe(true)
  })

  it('waits up to 8 seconds for a slow seek', async () => {
    const { result } = renderHook(() => useClipThumbnails('/clip.mp4', 60))
    await fire('loadeddata')
    await act(async () => { await vi.advanceTimersByTimeAsync(7900) })
    await fire('seeked')
    expect(result.current.frames[0]).toBe('data:frame-0')
  })

  it('stops loading with empty slots when the capture never loads', async () => {
    const { result } = renderHook(() => useClipThumbnails('/clip.mp4', 60))
    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
    expect(result.current).toEqual({ frames: Array(10).fill(null), loading: false })
  })

  it('aborts generation and releases the decoder on unmount', async () => {
    const { result, unmount } = renderHook(() => useClipThumbnails('/clip.mp4', 60))
    await fire('loadeddata')
    await fire('seeked')
    const time = decoder.currentTime
    unmount()
    expect(decoder.hasAttribute('src')).toBe(false)
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled()
    await fire('seeked')
    await act(async () => { await vi.advanceTimersByTimeAsync(80000) })
    expect(decoder.currentTime).toBe(time)
    expect(drawn).toBe(1)
    expect(result.current.frames[0]).toBe('data:frame-0')
  })
})
