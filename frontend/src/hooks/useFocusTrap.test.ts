import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFocusTrap } from './useFocusTrap'

describe('useFocusTrap', () => {
  let container: HTMLDivElement
  let button1: HTMLButtonElement
  let button2: HTMLButtonElement
  let button3: HTMLButtonElement
  let outsideButton: HTMLButtonElement

  beforeEach(() => {
    // Create container with focusable elements
    container = document.createElement('div')
    button1 = document.createElement('button')
    button1.textContent = 'Button 1'
    button2 = document.createElement('button')
    button2.textContent = 'Button 2'
    button3 = document.createElement('button')
    button3.textContent = 'Button 3'

    container.appendChild(button1)
    container.appendChild(button2)
    container.appendChild(button3)

    // Create outside element
    outsideButton = document.createElement('button')
    outsideButton.textContent = 'Outside'

    document.body.appendChild(container)
    document.body.appendChild(outsideButton)
  })

  afterEach(() => {
    document.body.removeChild(container)
    document.body.removeChild(outsideButton)
  })

  const fireTabKey = (element: HTMLElement, shiftKey = false) => {
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey,
      bubbles: true,
    })
    element.dispatchEvent(event)
    return event
  }

  it('focuses first element when trap is enabled', () => {
    outsideButton.focus()
    expect(document.activeElement).toBe(outsideButton)

    renderHook(() =>
      useFocusTrap({ current: container }, { enabled: true })
    )

    expect(document.activeElement).toBe(button1)
  })

  it('does not focus first element when disabled', () => {
    outsideButton.focus()
    expect(document.activeElement).toBe(outsideButton)

    renderHook(() =>
      useFocusTrap({ current: container }, { enabled: false })
    )

    expect(document.activeElement).toBe(outsideButton)
  })

  it('wraps focus from last to first on Tab', () => {
    renderHook(() =>
      useFocusTrap({ current: container }, { enabled: true })
    )

    button3.focus()
    expect(document.activeElement).toBe(button3)

    fireTabKey(container)

    // Focus should wrap to first element
    expect(document.activeElement).toBe(button1)
  })

  it('wraps focus from first to last on Shift+Tab', () => {
    renderHook(() =>
      useFocusTrap({ current: container }, { enabled: true })
    )

    button1.focus()
    expect(document.activeElement).toBe(button1)

    fireTabKey(container, true)

    // Focus should wrap to last element
    expect(document.activeElement).toBe(button3)
  })

  it('restores focus on unmount when restoreFocus is true', () => {
    outsideButton.focus()
    expect(document.activeElement).toBe(outsideButton)

    const { unmount } = renderHook(() =>
      useFocusTrap({ current: container }, { enabled: true, restoreFocus: true })
    )

    expect(document.activeElement).toBe(button1)

    unmount()

    expect(document.activeElement).toBe(outsideButton)
  })

  it('does not restore focus when restoreFocus is false', () => {
    outsideButton.focus()
    expect(document.activeElement).toBe(outsideButton)

    const { unmount } = renderHook(() =>
      useFocusTrap({ current: container }, { enabled: true, restoreFocus: false })
    )

    expect(document.activeElement).toBe(button1)

    unmount()

    // Focus is not restored - stays on button1 or body
    expect(document.activeElement).not.toBe(outsideButton)
  })

  it('handles containers with no focusable elements', () => {
    const emptyContainer = document.createElement('div')
    document.body.appendChild(emptyContainer)

    // Should not throw
    renderHook(() =>
      useFocusTrap({ current: emptyContainer }, { enabled: true })
    )

    document.body.removeChild(emptyContainer)
  })

  it('handles null container ref', () => {
    // Should not throw
    renderHook(() =>
      useFocusTrap({ current: null }, { enabled: true })
    )
  })

  it('responds to enabled prop changes', () => {
    outsideButton.focus()

    const { rerender } = renderHook(
      ({ enabled }) => useFocusTrap({ current: container }, { enabled }),
      { initialProps: { enabled: false } }
    )

    expect(document.activeElement).toBe(outsideButton)

    rerender({ enabled: true })

    expect(document.activeElement).toBe(button1)
  })
})
