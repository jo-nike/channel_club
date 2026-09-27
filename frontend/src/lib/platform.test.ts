import { describe, it, expect, vi, afterEach } from 'vitest'
import { isIOS, isStandalone } from './platform'

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

describe('isIOS', () => {
  const IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  // iPadOS Safari asks for the desktop site, so it looks like a Mac
  const MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
  const ANDROID =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'

  function device(userAgent: string, maxTouchPoints: number) {
    Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true })
    Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true })
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'userAgent')
    Reflect.deleteProperty(navigator, 'maxTouchPoints')
  })

  it('is true on an iPhone', () => {
    device(IPHONE, 5)
    expect(isIOS()).toBe(true)
  })

  it('is true on an iPad that reports a Macintosh user agent with a touch screen', () => {
    device(MAC, 5)
    expect(isIOS()).toBe(true)
  })

  it('is false on a Mac without a touch screen', () => {
    device(MAC, 0)
    expect(isIOS()).toBe(false)
  })

  it('is false on Android', () => {
    device(ANDROID, 5)
    expect(isIOS()).toBe(false)
  })
})
