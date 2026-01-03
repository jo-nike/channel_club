import { useState, useCallback, useRef, useEffect } from 'react'
import type { KeyboardEvent, RefObject } from 'react'

interface UseRovingTabIndexOptions<T> {
  items: T[]
  onSelect?: (item: T, index: number) => void
  getItemId?: (item: T) => string | number
}

interface UseRovingTabIndexResult {
  focusedIndex: number
  handleKeyDown: (e: KeyboardEvent) => void
  getTabIndex: (index: number) => 0 | -1
  setFocusedIndex: (index: number) => void
  itemRefs: RefObject<(HTMLElement | null)[]>
}

export function useRovingTabIndex<T>({
  items,
  onSelect,
  getItemId,
}: UseRovingTabIndexOptions<T>): UseRovingTabIndexResult {
  const [focusedIndex, setFocusedIndex] = useState(0)
  const itemRefs = useRef<(HTMLElement | null)[]>([])

  // Keep focusedIndex in bounds when items change
  // This intentionally updates state in effect to correct invalid focus index when items shrink
  const clampedFocusedIndex = items.length === 0
    ? 0
    : Math.min(focusedIndex, items.length - 1)

  useEffect(() => {
    if (clampedFocusedIndex !== focusedIndex) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFocusedIndex(clampedFocusedIndex)
    }
  }, [clampedFocusedIndex, focusedIndex])

  // Try to maintain focus on the same item when list updates
  const prevItemsRef = useRef<T[]>(items)
  useEffect(() => {
    if (getItemId && prevItemsRef.current !== items && items.length > 0) {
      const prevFocusedItem = prevItemsRef.current[focusedIndex]
      if (prevFocusedItem) {
        const prevId = getItemId(prevFocusedItem)
        const newIndex = items.findIndex((item) => getItemId(item) === prevId)
        if (newIndex !== -1 && newIndex !== focusedIndex) {
          setFocusedIndex(newIndex)
        }
      }
    }
    prevItemsRef.current = items
  }, [items, focusedIndex, getItemId])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (items.length === 0) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setFocusedIndex((i) => Math.min(i + 1, items.length - 1))
          break

        case 'ArrowUp':
          e.preventDefault()
          setFocusedIndex((i) => Math.max(i - 1, 0))
          break

        case 'Home':
          e.preventDefault()
          setFocusedIndex(0)
          break

        case 'End':
          e.preventDefault()
          setFocusedIndex(items.length - 1)
          break

        case 'Enter':
        case ' ':
          e.preventDefault()
          if (onSelect && items[focusedIndex]) {
            onSelect(items[focusedIndex], focusedIndex)
          }
          break

        default:
          break
      }
    },
    [items, focusedIndex, onSelect]
  )

  const getTabIndex = useCallback(
    (index: number): 0 | -1 => {
      return index === focusedIndex ? 0 : -1
    },
    [focusedIndex]
  )

  // Focus the correct item when focusedIndex changes
  useEffect(() => {
    const element = itemRefs.current[focusedIndex]
    if (element && document.activeElement !== element) {
      // Only focus if the container has focus (user is navigating with keyboard)
      const container = element.closest('[role="listbox"]')
      if (container?.contains(document.activeElement)) {
        element.focus()
      }
    }
  }, [focusedIndex])

  return {
    focusedIndex,
    handleKeyDown,
    getTabIndex,
    setFocusedIndex,
    itemRefs,
  }
}
