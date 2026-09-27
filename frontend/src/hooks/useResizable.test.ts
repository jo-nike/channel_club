import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@/test/utils'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useResizable } from './useResizable'

describe('useResizable', () => {
  // jsdom has no layout: give the container a 1000px height
  const container = document.createElement('div')
  Object.defineProperty(container, 'clientHeight', { value: 1000 })
  const containerRef = { current: container }

  afterEach(() => {
    vi.clearAllMocks()
  })

  function setup(initialHeightPercent = 50) {
    const onHeightChange = vi.fn()
    const hook = renderHook(() =>
      useResizable({
        initialHeightPercent,
        minHeightPercent: 30,
        maxHeightPercent: 75,
        containerRef,
        onHeightChange,
      })
    )
    return { ...hook, onHeightChange }
  }

  const setPointerCapture = vi.fn()

  function pointerDown(result: { current: ReturnType<typeof useResizable> }, clientY: number, pointerId = 1) {
    const event = {
      clientY,
      pointerId,
      preventDefault: vi.fn(),
      currentTarget: { setPointerCapture },
    } as unknown as ReactPointerEvent
    act(() => {
      result.current.handlePointerDown(event)
    })
    return event
  }

  function pointer(type: 'pointermove' | 'pointerup' | 'pointercancel', clientY: number, pointerId = 1) {
    act(() => {
      document.dispatchEvent(new PointerEvent(type, { clientY, pointerId, bubbles: true }))
    })
  }

  function key(result: { current: ReturnType<typeof useResizable> }, name: string) {
    const event = { key: name, preventDefault: vi.fn() } as unknown as KeyboardEvent
    act(() => {
      result.current.handleKeyDown(event)
    })
    return event
  }

  it('raises the guide by 10% when dragged up 100px on a 1000px container, capturing the pointer', () => {
    const { result, onHeightChange } = setup()

    const down = pointerDown(result, 500, 7)
    expect(down.preventDefault).toHaveBeenCalled()
    expect(setPointerCapture).toHaveBeenCalledWith(7)
    expect(result.current.isDragging).toBe(true)

    pointer('pointermove', 400, 7)
    expect(result.current.heightPercent).toBe(60)
    expect(onHeightChange).toHaveBeenLastCalledWith(60)

    pointer('pointerup', 400, 7)
    expect(result.current.isDragging).toBe(false)
  })

  it('keeps a drag within the limits', () => {
    const { result, onHeightChange } = setup()

    pointerDown(result, 500)
    pointer('pointermove', 0)
    expect(result.current.heightPercent).toBe(75)
    pointer('pointermove', 1000)
    expect(result.current.heightPercent).toBe(30)
    expect(onHeightChange).toHaveBeenLastCalledWith(30)
  })

  it('ends the drag on pointercancel, so later moves do nothing', () => {
    const { result, onHeightChange } = setup()

    pointerDown(result, 500)
    pointer('pointercancel', 500)
    expect(result.current.isDragging).toBe(false)

    pointer('pointermove', 100)
    expect(result.current.heightPercent).toBe(50)
    expect(onHeightChange).not.toHaveBeenCalled()
  })

  it('ignores a second pointer while one is dragging', () => {
    const { result } = setup()

    pointerDown(result, 500, 1)
    pointer('pointermove', 100, 2)
    pointer('pointerup', 100, 2)
    expect(result.current.heightPercent).toBe(50)
    expect(result.current.isDragging).toBe(true)

    pointer('pointermove', 450, 1)
    expect(result.current.heightPercent).toBe(55)
  })

  it('steps 5% with ArrowUp and ArrowDown, within the limits', () => {
    const { result, onHeightChange } = setup()

    const up = key(result, 'ArrowUp')
    expect(up.preventDefault).toHaveBeenCalled()
    expect(result.current.heightPercent).toBe(55)
    expect(onHeightChange).toHaveBeenLastCalledWith(55)

    key(result, 'ArrowDown')
    key(result, 'ArrowDown')
    expect(result.current.heightPercent).toBe(45)

    for (let i = 0; i < 10; i++) key(result, 'ArrowUp')
    expect(result.current.heightPercent).toBe(75)
    for (let i = 0; i < 20; i++) key(result, 'ArrowDown')
    expect(result.current.heightPercent).toBe(30)
  })

  it('jumps to the limits with Home and End', () => {
    const { result } = setup()

    key(result, 'End')
    expect(result.current.heightPercent).toBe(75)
    key(result, 'Home')
    expect(result.current.heightPercent).toBe(30)
  })

  it('leaves other keys alone', () => {
    const { result, onHeightChange } = setup()

    for (const name of ['Tab', 'Enter', ' ', 'ArrowLeft']) {
      expect(key(result, name).preventDefault).not.toHaveBeenCalled()
    }
    expect(result.current.heightPercent).toBe(50)
    expect(onHeightChange).not.toHaveBeenCalled()
  })
})
