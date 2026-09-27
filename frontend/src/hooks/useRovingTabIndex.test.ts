import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@/test/utils'
import { useRovingTabIndex } from './useRovingTabIndex'
import type { KeyboardEvent } from 'react'

describe('useRovingTabIndex', () => {
  const mockItems = [
    { id: '1', name: 'Channel 1' },
    { id: '2', name: 'Channel 2' },
    { id: '3', name: 'Channel 3' },
  ]

  const createKeyboardEvent = (key: string): KeyboardEvent => {
    return {
      key,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes with focusedIndex of 0', () => {
    const { result } = renderHook(() =>
      useRovingTabIndex({ items: mockItems })
    )

    expect(result.current.focusedIndex).toBe(0)
  })

  it('starts the tab stop on initialIndex, and moves on from there', () => {
    const { result } = renderHook(() =>
      useRovingTabIndex({ items: mockItems, initialIndex: 1 })
    )

    expect(result.current.focusedIndex).toBe(1)
    expect(result.current.getTabIndex(1)).toBe(0)
    expect(result.current.getTabIndex(0)).toBe(-1)

    act(() => {
      result.current.handleKeyDown(createKeyboardEvent('ArrowDown'))
    })

    expect(result.current.focusedIndex).toBe(2)
  })

  it('moves focus down on ArrowDown', () => {
    const { result } = renderHook(() =>
      useRovingTabIndex({ items: mockItems })
    )

    act(() => {
      result.current.handleKeyDown(createKeyboardEvent('ArrowDown'))
    })

    expect(result.current.focusedIndex).toBe(1)
  })

  it('moves focus up on ArrowUp', () => {
    const { result } = renderHook(() =>
      useRovingTabIndex({ items: mockItems })
    )

    // First move down
    act(() => {
      result.current.handleKeyDown(createKeyboardEvent('ArrowDown'))
    })

    // Then move up
    act(() => {
      result.current.handleKeyDown(createKeyboardEvent('ArrowUp'))
    })

    expect(result.current.focusedIndex).toBe(0)
  })

  it('does not go below 0 on ArrowUp', () => {
    const { result } = renderHook(() =>
      useRovingTabIndex({ items: mockItems })
    )

    act(() => {
      result.current.handleKeyDown(createKeyboardEvent('ArrowUp'))
    })

    expect(result.current.focusedIndex).toBe(0)
  })

  it('does not exceed items length on ArrowDown', () => {
    const { result } = renderHook(() =>
      useRovingTabIndex({ items: mockItems })
    )

    // Move to last item
    act(() => {
      result.current.handleKeyDown(createKeyboardEvent('ArrowDown'))
      result.current.handleKeyDown(createKeyboardEvent('ArrowDown'))
      result.current.handleKeyDown(createKeyboardEvent('ArrowDown'))
    })

    expect(result.current.focusedIndex).toBe(2) // Last index
  })

  it('jumps to first item on Home', () => {
    const { result } = renderHook(() =>
      useRovingTabIndex({ items: mockItems })
    )

    // Move down first
    act(() => {
      result.current.handleKeyDown(createKeyboardEvent('ArrowDown'))
      result.current.handleKeyDown(createKeyboardEvent('ArrowDown'))
    })

    expect(result.current.focusedIndex).toBe(2)

    // Press Home
    act(() => {
      result.current.handleKeyDown(createKeyboardEvent('Home'))
    })

    expect(result.current.focusedIndex).toBe(0)
  })

  it('jumps to last item on End', () => {
    const { result } = renderHook(() =>
      useRovingTabIndex({ items: mockItems })
    )

    act(() => {
      result.current.handleKeyDown(createKeyboardEvent('End'))
    })

    expect(result.current.focusedIndex).toBe(2)
  })

  it('calls onSelect with Enter', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() =>
      useRovingTabIndex({ items: mockItems, onSelect })
    )

    act(() => {
      result.current.handleKeyDown(createKeyboardEvent('Enter'))
    })

    expect(onSelect).toHaveBeenCalledWith(mockItems[0], 0)
  })

  it('calls onSelect with Space', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() =>
      useRovingTabIndex({ items: mockItems, onSelect })
    )

    // Move to second item
    act(() => {
      result.current.handleKeyDown(createKeyboardEvent('ArrowDown'))
    })

    act(() => {
      result.current.handleKeyDown(createKeyboardEvent(' '))
    })

    expect(onSelect).toHaveBeenCalledWith(mockItems[1], 1)
  })

  it('returns correct tabIndex for focused and unfocused items', () => {
    const { result } = renderHook(() =>
      useRovingTabIndex({ items: mockItems })
    )

    expect(result.current.getTabIndex(0)).toBe(0)
    expect(result.current.getTabIndex(1)).toBe(-1)
    expect(result.current.getTabIndex(2)).toBe(-1)

    // Move focus to index 1
    act(() => {
      result.current.handleKeyDown(createKeyboardEvent('ArrowDown'))
    })

    expect(result.current.getTabIndex(0)).toBe(-1)
    expect(result.current.getTabIndex(1)).toBe(0)
    expect(result.current.getTabIndex(2)).toBe(-1)
  })

  it('adjusts focusedIndex when items length decreases', () => {
    const { result, rerender } = renderHook(
      ({ items }) => useRovingTabIndex({ items }),
      { initialProps: { items: mockItems } }
    )

    // Move to last item
    act(() => {
      result.current.handleKeyDown(createKeyboardEvent('End'))
    })

    expect(result.current.focusedIndex).toBe(2)

    // Reduce items
    rerender({ items: [mockItems[0]] })

    expect(result.current.focusedIndex).toBe(0)
  })

  it('handles empty items array', () => {
    const { result } = renderHook(() =>
      useRovingTabIndex({ items: [] })
    )

    // Should not throw when handling key events
    act(() => {
      result.current.handleKeyDown(createKeyboardEvent('ArrowDown'))
    })

    expect(result.current.focusedIndex).toBe(0)
  })

  it('prevents default on navigation keys', () => {
    const { result } = renderHook(() =>
      useRovingTabIndex({ items: mockItems })
    )

    const event = createKeyboardEvent('ArrowDown')
    act(() => {
      result.current.handleKeyDown(event)
    })

    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('allows manual focus index setting', () => {
    const { result } = renderHook(() =>
      useRovingTabIndex({ items: mockItems })
    )

    act(() => {
      result.current.setFocusedIndex(2)
    })

    expect(result.current.focusedIndex).toBe(2)
  })

  describe('D-pad/TV remote simulation', () => {
    it('navigates with D-pad down (ArrowDown)', () => {
      const { result } = renderHook(() =>
        useRovingTabIndex({ items: mockItems })
      )

      act(() => {
        result.current.handleKeyDown(createKeyboardEvent('ArrowDown'))
      })

      expect(result.current.focusedIndex).toBe(1)
    })

    it('navigates with D-pad up (ArrowUp)', () => {
      const { result } = renderHook(() =>
        useRovingTabIndex({ items: mockItems })
      )

      act(() => {
        result.current.handleKeyDown(createKeyboardEvent('ArrowDown'))
        result.current.handleKeyDown(createKeyboardEvent('ArrowUp'))
      })

      expect(result.current.focusedIndex).toBe(0)
    })

    it('selects with OK button (Enter key)', () => {
      const onSelect = vi.fn()
      const { result } = renderHook(() =>
        useRovingTabIndex({ items: mockItems, onSelect })
      )

      act(() => {
        result.current.handleKeyDown(createKeyboardEvent('Enter'))
      })

      expect(onSelect).toHaveBeenCalledWith(mockItems[0], 0)
    })
  })

  it('leaves Enter and Space to the focused element when there is no onSelect', () => {
    const { result } = renderHook(() =>
      useRovingTabIndex({ items: mockItems })
    )

    for (const key of ['Enter', ' ']) {
      const event = createKeyboardEvent(key)
      act(() => {
        result.current.handleKeyDown(event)
      })
      expect(event.preventDefault).not.toHaveBeenCalled()
    }
  })

  describe('containerRef option', () => {
    // A plain list of buttons, as in the channel sidebar: no role="listbox"
    let list: HTMLUListElement
    let buttons: HTMLButtonElement[]
    let outside: HTMLButtonElement

    beforeEach(() => {
      list = document.createElement('ul')
      buttons = mockItems.map((item) => {
        const li = document.createElement('li')
        const button = document.createElement('button')
        button.textContent = item.name
        li.append(button)
        list.append(li)
        return button
      })
      outside = document.createElement('button')
      document.body.append(list, outside)
    })

    afterEach(() => {
      list.remove()
      outside.remove()
    })

    function setup(withContainer: boolean) {
      const containerRef = { current: list }
      const hook = renderHook(() =>
        useRovingTabIndex({ items: mockItems, containerRef: withContainer ? containerRef : undefined })
      )
      hook.result.current.itemRefs.current = buttons
      return hook
    }

    it('moves DOM focus between items inside the container, with no listbox role', () => {
      const { result } = setup(true)
      buttons[0].focus()

      act(() => {
        result.current.handleKeyDown(createKeyboardEvent('ArrowDown'))
      })
      expect(document.activeElement).toBe(buttons[1])

      act(() => {
        result.current.handleKeyDown(createKeyboardEvent('End'))
      })
      expect(document.activeElement).toBe(buttons[2])

      act(() => {
        result.current.handleKeyDown(createKeyboardEvent('Home'))
      })
      expect(document.activeElement).toBe(buttons[0])
    })

    it("doesn't pull focus into the container when focus is elsewhere", () => {
      const { result } = setup(true)
      outside.focus()

      act(() => {
        result.current.setFocusedIndex(2)
      })

      expect(result.current.getTabIndex(2)).toBe(0)
      expect(document.activeElement).toBe(outside)
    })

    it('without the option, moves the tab stop but not DOM focus outside a listbox', () => {
      const { result } = setup(false)
      buttons[0].focus()

      act(() => {
        result.current.handleKeyDown(createKeyboardEvent('ArrowDown'))
      })

      expect(result.current.focusedIndex).toBe(1)
      expect(document.activeElement).toBe(buttons[0])
    })
  })
})
