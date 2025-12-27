import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

interface UseFocusTrapOptions {
  enabled?: boolean
  restoreFocus?: boolean
}

export function useFocusTrap<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  { enabled = true, restoreFocus = true }: UseFocusTrapOptions = {}
) {
  const previousActiveElement = useRef<Element | null>(null)

  useEffect(() => {
    if (!enabled || !containerRef.current) return

    const container = containerRef.current

    // Store currently focused element for restoration
    if (restoreFocus) {
      previousActiveElement.current = document.activeElement
    }

    // Get all focusable elements
    const getFocusableElements = () => {
      return container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    }

    // Focus the first focusable element
    const focusableElements = getFocusableElements()
    if (focusableElements.length > 0) {
      focusableElements[0].focus()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      const focusable = getFocusableElements()
      if (focusable.length === 0) return

      const firstElement = focusable[0]
      const lastElement = focusable[focusable.length - 1]

      if (e.shiftKey) {
        // Shift+Tab: if on first element, wrap to last
        if (document.activeElement === firstElement) {
          e.preventDefault()
          lastElement.focus()
        }
      } else {
        // Tab: if on last element, wrap to first
        if (document.activeElement === lastElement) {
          e.preventDefault()
          firstElement.focus()
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)

    return () => {
      container.removeEventListener('keydown', handleKeyDown)

      // Restore focus to previously focused element
      if (restoreFocus && previousActiveElement.current) {
        const prevElement = previousActiveElement.current as HTMLElement
        if (prevElement.focus && document.body.contains(prevElement)) {
          prevElement.focus()
        }
      }
    }
  }, [enabled, containerRef, restoreFocus])
}
