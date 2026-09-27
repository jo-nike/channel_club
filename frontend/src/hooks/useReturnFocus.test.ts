import { describe, it, expect, afterEach } from 'vitest'
import { renderHook } from '@/test/utils'
import { useReturnFocus } from './useReturnFocus'

function button(label: string): HTMLButtonElement {
  const el = document.createElement('button')
  el.textContent = label
  document.body.appendChild(el)
  return el
}

describe('useReturnFocus', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('returns focus on close to what had it when the dialog opened', () => {
    const opener = button('Opener')
    const inside = button('Inside')
    const { result } = renderHook(() => useReturnFocus())

    opener.focus()
    result.current.onOpenAutoFocus()
    inside.focus()
    const event = new Event('focusScope.autoFocusOnUnmount', { cancelable: true })
    result.current.onCloseAutoFocus(event)

    expect(event.defaultPrevented).toBe(true)
    expect(opener).toHaveFocus()
  })

  it('falls back when the opener has left the page', () => {
    const opener = button('Menu item')
    const fallback = button('Menu trigger')
    const { result } = renderHook(() => useReturnFocus({ current: fallback }))

    opener.focus()
    result.current.onOpenAutoFocus()
    opener.remove()
    result.current.onCloseAutoFocus(new Event('close', { cancelable: true }))

    expect(fallback).toHaveFocus()
  })

  it('falls back when nothing had focus as the dialog opened', () => {
    const fallback = button('Menu trigger')
    const { result } = renderHook(() => useReturnFocus({ current: fallback }))

    ;(document.activeElement as HTMLElement | null)?.blur()
    result.current.onOpenAutoFocus()
    result.current.onCloseAutoFocus(new Event('close', { cancelable: true }))

    expect(fallback).toHaveFocus()
  })

  it('returns focus only once: a later close does not steal it back', () => {
    const opener = button('Opener')
    const elsewhere = button('Elsewhere')
    const { result } = renderHook(() => useReturnFocus())

    opener.focus()
    result.current.onOpenAutoFocus()
    result.current.onCloseAutoFocus(new Event('close', { cancelable: true }))
    elsewhere.focus()
    result.current.onCloseAutoFocus(new Event('close', { cancelable: true }))

    expect(elsewhere).toHaveFocus()
  })
})
