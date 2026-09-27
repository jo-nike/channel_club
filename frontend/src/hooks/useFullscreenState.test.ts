import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFullscreenState } from './useFullscreenState'

const setFullscreenElement = (key: 'fullscreenElement' | 'webkitFullscreenElement', element: Element | null) => {
  Object.defineProperty(document, key, { configurable: true, value: element })
}

const refTo = (element: HTMLElement | null) => ({ current: element })

describe('useFullscreenState', () => {
  afterEach(() => {
    setFullscreenElement('fullscreenElement', null)
    setFullscreenElement('webkitFullscreenElement', null)
  })

  it('is false when nothing is fullscreen', () => {
    const { result } = renderHook(() => useFullscreenState(refTo(document.createElement('div'))))

    expect(result.current).toBe(false)
  })

  it('is true when the container becomes the fullscreen element', () => {
    const container = document.createElement('div')
    const ref = refTo(container)
    const { result } = renderHook(() => useFullscreenState(ref))

    act(() => {
      setFullscreenElement('fullscreenElement', container)
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    expect(result.current).toBe(true)

    act(() => {
      setFullscreenElement('fullscreenElement', null)
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    expect(result.current).toBe(false)
  })

  it('is false when another element is fullscreen', () => {
    const ref = refTo(document.createElement('div'))
    const { result } = renderHook(() => useFullscreenState(ref))

    act(() => {
      setFullscreenElement('fullscreenElement', document.createElement('div'))
      document.dispatchEvent(new Event('fullscreenchange'))
    })

    expect(result.current).toBe(false)
  })

  it('reacts to the webkit event and element (Safari)', () => {
    const container = document.createElement('div')
    const ref = refTo(container)
    const { result } = renderHook(() => useFullscreenState(ref))

    act(() => {
      setFullscreenElement('webkitFullscreenElement', container)
      document.dispatchEvent(new Event('webkitfullscreenchange'))
    })

    expect(result.current).toBe(true)
  })

  it('is false without a container, even with nothing fullscreen', () => {
    const { result: noRef } = renderHook(() => useFullscreenState())
    const { result: emptyRef } = renderHook(() => useFullscreenState(refTo(null)))

    expect(noRef.current).toBe(false)
    expect(emptyRef.current).toBe(false)
  })
})
