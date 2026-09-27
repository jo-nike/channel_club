import { useEffect, useCallback } from 'react'

interface UseEscapeKeyOptions {
  // Receives the keydown, so a handler can skip one another layer already handled
  onEscape: (e: KeyboardEvent) => void
  enabled?: boolean
}

export function useEscapeKey({ onEscape, enabled = true }: UseEscapeKeyOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onEscape(e)
      }
    },
    [onEscape]
  )

  useEffect(() => {
    if (!enabled) return

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled, handleKeyDown])
}
