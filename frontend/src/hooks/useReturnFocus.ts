import { useRef, type RefObject } from 'react'

/**
 * Focus handlers for a DialogContent opened without a Radix DialogTrigger (by
 * state, a key or a menu item). Radix returns focus on close only to its
 * trigger, so with none focus drops to <body>: the keyboard user loses their
 * place, and the player's window shortcuts take the next keys.
 *
 * onOpenAutoFocus remembers what had focus as the dialog opened, without
 * preventing Radix's own first focus inside the dialog. onCloseAutoFocus puts
 * focus back there, or on `fallback` when that element has gone (a menu item
 * unmounts with its menu) or was the page itself.
 */
export function useReturnFocus(fallback?: RefObject<HTMLElement | null>) {
  const returnFocusRef = useRef<Element | null>(null)

  return {
    onOpenAutoFocus: () => {
      returnFocusRef.current = document.activeElement
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault()
      const previous = returnFocusRef.current
      returnFocusRef.current = null
      if (previous instanceof HTMLElement && previous.isConnected && previous !== document.body) {
        previous.focus()
      } else {
        fallback?.current?.focus()
      }
    },
  }
}
