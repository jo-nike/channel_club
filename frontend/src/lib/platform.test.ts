import { describe, it, expect, vi, afterEach } from 'vitest'
import { isStandalone } from './platform'

describe('isStandalone', () => {
  const originalMatchMedia = window.matchMedia

  afterEach(() => {
    window.matchMedia = originalMatchMedia
    Reflect.deleteProperty(navigator, 'standalone')
  })

  it('is false in a browser tab', () => {
    expect(isStandalone()).toBe(false)
  })

  it('is true in standalone display mode', () => {
    window.matchMedia = vi.fn((query: string) => ({
      ...originalMatchMedia(query),
      matches: query === '(display-mode: standalone)',
    }))
    expect(isStandalone()).toBe(true)
  })

  it("is true when iOS Safari says it was opened from the home screen", () => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
    expect(isStandalone()).toBe(true)
  })
})
