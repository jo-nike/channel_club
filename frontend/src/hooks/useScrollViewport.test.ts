import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useScrollViewport } from './useScrollViewport'

// Animation frames run only when a test flushes them
let frames: Map<number, FrameRequestCallback>
let nextFrame: number
function flushFrames() {
  const pending = [...frames.values()]
  frames.clear()
  pending.forEach((callback) => callback(performance.now()))
}

// Resize callbacks run only when a test triggers them
let resizeCallbacks: ResizeObserverCallback[]
class CapturingResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallbacks.push(callback)
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
function triggerResize() {
  resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver))
}

function scroller(size: { width: number; height: number }) {
  const element = document.createElement('div')
  Object.defineProperty(element, 'clientWidth', { configurable: true, get: () => size.width })
  Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => size.height })
  return element
}

function scrollTo(element: HTMLElement, left: number, top: number) {
  element.scrollLeft = left
  element.scrollTop = top
  element.dispatchEvent(new Event('scroll'))
}

describe('useScrollViewport', () => {
  beforeEach(() => {
    frames = new Map()
    nextFrame = 0
    resizeCallbacks = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback)
      return nextFrame
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)))
    vi.stubGlobal('ResizeObserver', CapturingResizeObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('measures the scroller when it mounts, without waiting for a frame', () => {
    const element = scroller({ width: 1200, height: 500 })
    element.scrollLeft = 40
    element.scrollTop = 64
    const { result } = renderHook(() => useScrollViewport({ current: element }))

    expect(result.current).toEqual({ scrollLeft: 40, scrollTop: 64, width: 1200, height: 500 })
  })

  it('updates once a frame, however many scroll events arrive in it', () => {
    const element = scroller({ width: 1200, height: 500 })
    let renders = 0
    const { result } = renderHook(() => {
      renders++
      return useScrollViewport({ current: element })
    })
    const rendersAfterMount = renders

    act(() => {
      scrollTo(element, 100, 0)
      scrollTo(element, 250, 30)
      scrollTo(element, 400, 64)
    })

    // Nothing until the frame runs, and only one frame asked for
    expect(result.current.scrollLeft).toBe(0)
    expect(renders).toBe(rendersAfterMount)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)

    act(() => flushFrames())

    expect(result.current).toEqual({ scrollLeft: 400, scrollTop: 64, width: 1200, height: 500 })

    // The next scroll asks for a new frame
    act(() => scrollTo(element, 500, 64))
    act(() => flushFrames())
    expect(result.current.scrollLeft).toBe(500)
  })

  it("doesn't re-render when a frame finds nothing changed", () => {
    const element = scroller({ width: 1200, height: 500 })
    let renders = 0
    renderHook(() => {
      renders++
      return useScrollViewport({ current: element })
    })
    const rendersAfterMount = renders

    act(() => element.dispatchEvent(new Event('scroll')))
    act(() => flushFrames())

    expect(renders).toBe(rendersAfterMount)
  })

  it('follows a resize on the next frame', () => {
    const size = { width: 1200, height: 500 }
    const element = scroller(size)
    const { result } = renderHook(() => useScrollViewport({ current: element }))

    size.height = 800
    act(() => triggerResize())
    expect(result.current.height).toBe(500)

    act(() => flushFrames())
    expect(result.current.height).toBe(800)
  })

  it('stops listening and drops a pending frame on unmount', () => {
    const element = scroller({ width: 1200, height: 500 })
    const { unmount } = renderHook(() => useScrollViewport({ current: element }))

    act(() => scrollTo(element, 100, 0))
    unmount()

    expect(frames.size).toBe(0)
    scrollTo(element, 200, 0)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
  })

  it('attaches once enabled, as when the scroller mounts after loading', () => {
    const element = scroller({ width: 1200, height: 500 })
    element.scrollTop = 128
    const { result, rerender } = renderHook(({ enabled }) => useScrollViewport({ current: element }, enabled), {
      initialProps: { enabled: false },
    })

    // Until then, an estimate no bigger than the window
    expect(result.current).toEqual({ scrollLeft: 0, scrollTop: 0, width: window.innerWidth, height: window.innerHeight })
    scrollTo(element, 100, 128)
    expect(requestAnimationFrame).not.toHaveBeenCalled()

    rerender({ enabled: true })
    expect(result.current).toEqual({ scrollLeft: 100, scrollTop: 128, width: 1200, height: 500 })
  })
})
