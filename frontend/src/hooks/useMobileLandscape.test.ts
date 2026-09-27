import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@/test/utils'
import { useMobileLandscape } from './useMobileLandscape'

interface Viewport {
  width: number
  height: number
  pointer: 'coarse' | 'fine'
}

// Evaluates the simple `(feature: value) and (feature: value)` queries the
// hook uses against a simulated viewport, so the tests exercise the query
// itself rather than a canned true/false.
function evaluate(query: string, vp: Viewport): boolean {
  return query.split(/\s+and\s+/).every((term) => {
    const match = /^\(\s*([a-z-]+)\s*:\s*([a-z0-9]+?)(px)?\s*\)$/.exec(term.trim())
    if (!match) throw new Error(`Unsupported media query term: ${term}`)
    const [, feature, value] = match
    switch (feature) {
      case 'pointer':
        return vp.pointer === value
      case 'orientation':
        return (vp.width > vp.height ? 'landscape' : 'portrait') === value
      case 'max-height':
        return vp.height <= Number(value)
      case 'max-width':
        return vp.width <= Number(value)
      default:
        throw new Error(`Unsupported media feature: ${feature}`)
    }
  })
}

function installViewport(initial: Viewport) {
  let viewport = initial
  const listeners = new Set<() => void>()

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return evaluate(query, viewport)
      },
      media: query,
      addEventListener: (_event: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_event: string, cb: () => void) => listeners.delete(cb),
    })),
  })

  return {
    resize(next: Viewport) {
      viewport = next
      listeners.forEach((cb) => cb())
    },
  }
}

describe('useMobileLandscape', () => {
  const originalMatchMedia = window.matchMedia

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: originalMatchMedia,
    })
  })

  it('is true for a standard phone in landscape (844x390)', () => {
    installViewport({ width: 844, height: 390, pointer: 'coarse' })
    const { result } = renderHook(() => useMobileLandscape())
    expect(result.current).toBe(true)
  })

  it('is true for a Plus/Pro Max phone wider than the old 926px cut-off (932x430)', () => {
    installViewport({ width: 932, height: 430, pointer: 'coarse' })
    const { result } = renderHook(() => useMobileLandscape())
    expect(result.current).toBe(true)
  })

  it('is true for the widest Pro Max in landscape (956x440)', () => {
    installViewport({ width: 956, height: 440, pointer: 'coarse' })
    const { result } = renderHook(() => useMobileLandscape())
    expect(result.current).toBe(true)
  })

  it('is false for a tablet in landscape (1024x768)', () => {
    installViewport({ width: 1024, height: 768, pointer: 'coarse' })
    const { result } = renderHook(() => useMobileLandscape())
    expect(result.current).toBe(false)
  })

  it('is false for a phone in portrait (390x844)', () => {
    installViewport({ width: 390, height: 844, pointer: 'coarse' })
    const { result } = renderHook(() => useMobileLandscape())
    expect(result.current).toBe(false)
  })

  it('is false for a short desktop window with a mouse (900x450)', () => {
    installViewport({ width: 900, height: 450, pointer: 'fine' })
    const { result } = renderHook(() => useMobileLandscape())
    expect(result.current).toBe(false)
  })

  it('follows the phone as it rotates', () => {
    const device = installViewport({ width: 430, height: 932, pointer: 'coarse' })
    const { result } = renderHook(() => useMobileLandscape())
    expect(result.current).toBe(false)

    act(() => device.resize({ width: 932, height: 430, pointer: 'coarse' }))
    expect(result.current).toBe(true)

    act(() => device.resize({ width: 430, height: 932, pointer: 'coarse' }))
    expect(result.current).toBe(false)
  })
})
