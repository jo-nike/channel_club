import { afterEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@/test/utils'
import { mockViewport } from '@/test/viewport'
import { useLayoutMode } from './useLayoutMode'

describe('useLayoutMode', () => {
  const originalMatchMedia = window.matchMedia
  afterEach(() => { window.matchMedia = originalMatchMedia })

  it.each([
    { width: 390, height: 844, pointer: 'coarse', mode: 'phone' },
    { width: 768, height: 1024, pointer: 'coarse', mode: 'phone' },
    // A tablet upright stacks like a phone, up to 1023px wide
    { width: 820, height: 1180, pointer: 'coarse', mode: 'phone' },
    { width: 1023, height: 1366, pointer: 'coarse', mode: 'phone' },
    { width: 1024, height: 1366, pointer: 'coarse', mode: 'desktop' },
    // A mouse window of the same shape keeps the width's answer
    { width: 820, height: 1180, pointer: 'fine', mode: 'tablet' },
    { width: 769, height: 1024, pointer: 'fine', mode: 'tablet' },
    { width: 900, height: 700, pointer: 'fine', mode: 'tablet' },
    { width: 1023, height: 768, pointer: 'fine', mode: 'tablet' },
    { width: 1024, height: 768, pointer: 'fine', mode: 'desktop' },
    { width: 1440, height: 900, pointer: 'fine', mode: 'desktop' },
    // A tablet on its side gets the tablet layout up to a 1366px iPad Pro
    { width: 1024, height: 768, pointer: 'coarse', mode: 'tablet' },
    { width: 1180, height: 820, pointer: 'coarse', mode: 'tablet' },
    { width: 1366, height: 1024, pointer: 'coarse', mode: 'tablet' },
    { width: 1440, height: 900, pointer: 'coarse', mode: 'desktop' },
  ] as const)('is $mode at $width x $height with a $pointer pointer', ({ width, height, pointer, mode }) => {
    mockViewport({ width, height, pointer })
    const { result } = renderHook(() => useLayoutMode())
    expect(result.current).toBe(mode)
  })

  it('turns a tablet from the stacked layout upright to the tablet layout sideways', () => {
    const viewport = mockViewport({ width: 820, height: 1180, pointer: 'coarse' })
    const { result } = renderHook(() => useLayoutMode())
    expect(result.current).toBe('phone')

    act(() => viewport.resize({ width: 1180, height: 820, pointer: 'coarse' }))
    expect(result.current).toBe('tablet')
  })

  // webOS pointer mode can report a coarse pointer
  it('keeps a TV on the desktop layout', () => {
    localStorage.setItem('tv-mode', 'true')
    try {
      mockViewport({ width: 1280, height: 720, pointer: 'coarse' })
      const { result } = renderHook(() => useLayoutMode())
      expect(result.current).toBe('desktop')
    } finally {
      localStorage.removeItem('tv-mode')
    }
  })

  it('follows the window as it is resized', () => {
    const viewport = mockViewport({ width: 1440 })
    const { result } = renderHook(() => useLayoutMode())
    expect(result.current).toBe('desktop')

    act(() => viewport.resize({ width: 900 }))
    expect(result.current).toBe('tablet')

    act(() => viewport.resize({ width: 390 }))
    expect(result.current).toBe('phone')

    act(() => viewport.resize({ width: 1280 }))
    expect(result.current).toBe('desktop')
  })
})
