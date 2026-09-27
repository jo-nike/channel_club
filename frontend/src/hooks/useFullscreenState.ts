import { useCallback, useSyncExternalStore, type RefObject } from 'react'

type WebkitDocument = Document & { webkitFullscreenElement?: Element | null }

const FULLSCREEN_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'] as const

function subscribe(callback: () => void) {
  FULLSCREEN_EVENTS.forEach((event) => document.addEventListener(event, callback))
  return () => FULLSCREEN_EVENTS.forEach((event) => document.removeEventListener(event, callback))
}

/** The page's fullscreen element, if any (Safari only has the webkit one) */
export function getFullscreenElement(): Element | null {
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

/**
 * Marks the player shell, the element the player fullscreens, so views
 * outside it can find it in fullscreen (DualModeVideoPlayer sets it)
 */
export const PLAYER_SHELL_ATTRIBUTE = 'data-player-shell'

const getPlayerFullscreenElement = (): HTMLElement | null => {
  const element = getFullscreenElement()
  return element instanceof HTMLElement && element.hasAttribute(PLAYER_SHELL_ATTRIBUTE) ? element : null
}

/**
 * The player shell while it is the fullscreen element, else null. In
 * fullscreen only that element is drawn, so a layer that must stay in view
 * (the chat panel, toasts) portals into it.
 */
export function usePlayerFullscreenElement(): HTMLElement | null {
  return useSyncExternalStore(subscribe, getPlayerFullscreenElement, () => null)
}
