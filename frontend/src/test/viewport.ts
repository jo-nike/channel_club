import { vi } from 'vitest'

export interface Viewport {
  width: number
  height?: number
  pointer?: 'fine' | 'coarse'
}

type Listener = () => void

/**
 * Answers media queries the way a browser would at `viewport`: width, height,
 * orientation and pointer features joined with `and`. Anything else (such as
 * prefers-reduced-motion) doesn't match. `resize` moves to another viewport
 * and notifies the queries whose answer changed.
 */
export function mockViewport(initial: Viewport) {
  let viewport = initial
  const listeners = new Map<string, Set<Listener>>()

  const matches = (query: string) => {
    const { width, height = 900, pointer = 'fine' } = viewport
    return query.split(/\s+and\s+/).every((part) => {
      const feature = /^\(\s*([\w-]+)\s*:\s*([\w-]+?)(px)?\s*\)$/.exec(part.trim())
      if (!feature) return false
      const [, name, value] = feature
      switch (name) {
        case 'min-width': return width >= Number(value)
        case 'max-width': return width <= Number(value)
        case 'min-height': return height >= Number(value)
        case 'max-height': return height <= Number(value)
        case 'orientation': return value === (width > height ? 'landscape' : 'portrait')
        case 'pointer': return value === pointer
        default: return false
      }
    })
  }

  const matchMedia = vi.fn((query: string) => ({
    get matches() { return matches(query) },
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: (_type: string, listener: Listener) => {
      if (!listeners.has(query)) listeners.set(query, new Set())
      listeners.get(query)!.add(listener)
    },
    removeEventListener: (_type: string, listener: Listener) => {
      listeners.get(query)?.delete(listener)
    },
    dispatchEvent: vi.fn(),
  }))

  window.matchMedia = matchMedia as unknown as typeof window.matchMedia

  return {
    matchMedia,
    resize(next: Viewport) {
      const before = new Map([...listeners.keys()].map((query) => [query, matches(query)]))
      viewport = next
      for (const [query, was] of before) {
        if (matches(query) !== was) listeners.get(query)?.forEach((listener) => listener())
      }
    },
  }
}
