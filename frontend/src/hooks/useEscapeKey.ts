import { useEffect, useCallback } from 'react'

interface UseEscapeKeyOptions {
  onEscape: () => void
  enabled?: boolean
}

export function useEscapeKey({ onEscape, enabled = true }: UseEscapeKeyOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onEscape()
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
