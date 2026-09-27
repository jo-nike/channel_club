import { describe, it, expect, afterEach } from 'vitest'
import { renderHook } from '@/test/utils'
import { useVisualViewportHeight } from './useVisualViewportHeight'

// jsdom has no visualViewport: a stand-in with a height that tests can move
class FakeVisualViewport extends EventTarget {
  height = 844

  resizeTo(height: number) {
    this.height = height
    this.dispatchEvent(new Event('resize'))
  }
}

const appHeight = () => document.documentElement.style.getPropertyValue('--app-height')

function installViewport(): FakeVisualViewport {
  const viewport = new FakeVisualViewport()
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
  return viewport
}

describe('useVisualViewportHeight', () => {
  afterEach(() => {
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
    document.documentElement.style.removeProperty('--app-height')
  })

  it('writes the visual viewport height to --app-height while active', () => {
    installViewport()
    renderHook(() => useVisualViewportHeight(true))
    expect(appHeight()).toBe('844px')
  })

  it('follows the visual viewport as the keyboard opens and closes', () => {
    const viewport = installViewport()
    renderHook(() => useVisualViewportHeight(true))

    viewport.resizeTo(508)
    expect(appHeight()).toBe('508px')

    viewport.resizeTo(844)
    expect(appHeight()).toBe('844px')
  })

  it('updates when the browser pans the page to the focused field', () => {
    const viewport = installViewport()
    renderHook(() => useVisualViewportHeight(true))

    viewport.height = 480
    viewport.dispatchEvent(new Event('scroll'))
    expect(appHeight()).toBe('480px')
  })

  it('writes nothing while inactive', () => {
    const viewport = installViewport()
    renderHook(() => useVisualViewportHeight(false))

    viewport.resizeTo(508)
    expect(appHeight()).toBe('')
  })

  it('removes the variable and stops following once inactive again', () => {
    const viewport = installViewport()
    const { rerender } = renderHook(({ active }) => useVisualViewportHeight(active), {
      initialProps: { active: true },
    })
    viewport.resizeTo(508)

    rerender({ active: false })
    expect(appHeight()).toBe('')

    viewport.resizeTo(400)
    expect(appHeight()).toBe('')
  })

  it('removes the variable on unmount', () => {
    installViewport()
    const { unmount } = renderHook(() => useVisualViewportHeight(true))

    unmount()
    expect(appHeight()).toBe('')
  })

  it('does nothing where the browser has no visual viewport', () => {
    renderHook(() => useVisualViewportHeight(true))
    expect(appHeight()).toBe('')
  })
})
