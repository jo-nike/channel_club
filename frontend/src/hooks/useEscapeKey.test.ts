import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@/test/utils'
import { useEscapeKey } from './useEscapeKey'

describe('useEscapeKey', () => {
  const fireKeyEvent = (key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true })
    window.dispatchEvent(event)
  }

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('calls onEscape when Escape key is pressed', () => {
    const onEscape = vi.fn()
    renderHook(() => useEscapeKey({ onEscape }))

    fireKeyEvent('Escape')

    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('passes the keydown event to onEscape', () => {
    const onEscape = vi.fn()
    renderHook(() => useEscapeKey({ onEscape }))
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    event.preventDefault()

    window.dispatchEvent(event)

    expect(onEscape).toHaveBeenCalledWith(event)
    expect(onEscape.mock.calls[0][0].defaultPrevented).toBe(true)
  })

  it('does not call onEscape for other keys', () => {
    const onEscape = vi.fn()
    renderHook(() => useEscapeKey({ onEscape }))

    fireKeyEvent('Enter')
    fireKeyEvent('Space')
    fireKeyEvent('ArrowUp')

    expect(onEscape).not.toHaveBeenCalled()
  })

  it('does not call onEscape when disabled', () => {
    const onEscape = vi.fn()
    renderHook(() => useEscapeKey({ onEscape, enabled: false }))

    fireKeyEvent('Escape')

    expect(onEscape).not.toHaveBeenCalled()
  })

  it('calls onEscape when enabled is true', () => {
    const onEscape = vi.fn()
    renderHook(() => useEscapeKey({ onEscape, enabled: true }))

    fireKeyEvent('Escape')

    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('responds to enabled prop changes', () => {
    const onEscape = vi.fn()
    const { rerender } = renderHook(
      ({ enabled }) => useEscapeKey({ onEscape, enabled }),
      { initialProps: { enabled: true } }
    )

    fireKeyEvent('Escape')
    expect(onEscape).toHaveBeenCalledTimes(1)

    rerender({ enabled: false })

    fireKeyEvent('Escape')
    expect(onEscape).toHaveBeenCalledTimes(1) // Still 1, not called again

    rerender({ enabled: true })

    fireKeyEvent('Escape')
    expect(onEscape).toHaveBeenCalledTimes(2)
  })

  it('cleans up event listener on unmount', () => {
    const onEscape = vi.fn()
    const { unmount } = renderHook(() => useEscapeKey({ onEscape }))

    unmount()

    fireKeyEvent('Escape')

    expect(onEscape).not.toHaveBeenCalled()
  })
})
