import { useCallback, useSyncExternalStore, type RefObject } from 'react'

type WebkitDocument = Document & { webkitFullscreenElement?: Element | null }

const FULLSCREEN_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'] as const

function subscribe(callback: () => void) {
  FULLSCREEN_EVENTS.forEach((event) => document.addEventListener(event, callback))
  return () => FULLSCREEN_EVENTS.forEach((event) => document.removeEventListener(event, callback))
}

function getFullscreenElement(): Element | null {
  return document.fullscreenElement ?? (document as WebkitDocument).webkitFullscreenElement ?? null
}

/**
 * Whether this player's container is the fullscreen element.
 *
 * Strict identity, not "anything is fullscreen": another element in
 * fullscreen (or none) is false. Safari only fires the webkit event.
 */
export function useFullscreenState(containerRef?: RefObject<HTMLElement | null>): boolean {
  const getSnapshot = useCallback(() => {
    const container = containerRef?.current ?? null
    return container !== null && getFullscreenElement() === container
  }, [containerRef])

  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
