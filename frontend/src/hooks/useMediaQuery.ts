import { useSyncExternalStore } from 'react'

function getServerSnapshot(): boolean {
  return false
}

export function useMediaQuery(query: string): boolean {
  // Use useSyncExternalStore for proper SSR support and no cascading renders
  const getSnapshot = () => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(query).matches
  }

  const subscribeToMediaQuery = (callback: () => void) => {
    if (typeof window === 'undefined') return () => {}

    const mediaQuery = window.matchMedia(query)
    mediaQuery.addEventListener('change', callback)
    return () => mediaQuery.removeEventListener('change', callback)
  }

  return useSyncExternalStore(subscribeToMediaQuery, getSnapshot, getServerSnapshot)
}
