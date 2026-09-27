import { afterEach, describe, expect, it, vi } from 'vitest'
import { prefersReducedMotion, scrollBehavior } from './motion'

const originalMatchMedia = window.matchMedia

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

describe('motion', () => {
  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })

  it('reports reduced motion from the prefers-reduced-motion query', () => {
    mockReducedMotion(true)
    expect(prefersReducedMotion()).toBe(true)

    mockReducedMotion(false)
    expect(prefersReducedMotion()).toBe(false)
  })

  it("jumps ('auto') under reduced motion", () => {
    mockReducedMotion(true)
    expect(scrollBehavior()).toBe('auto')
  })

  it("scrolls smoothly otherwise", () => {
    mockReducedMotion(false)
    expect(scrollBehavior()).toBe('smooth')
  })
})
