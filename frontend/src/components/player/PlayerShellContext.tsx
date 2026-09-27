import { createContext, useContext, type RefObject } from 'react'

/**
 * The player shell: one element that stays mounted while the video engine
 * inside it is swapped (a live channel change, an ErsatzTV channel switch).
 * It is the fullscreen element, so fullscreen survives those swaps and a
 * reload, and the scope for the engines' auto-hide, keyboard shortcuts and
 * portals.
 */
export interface PlayerShell {
  /** The shell element: fullscreen target, portal container, event scope */
  containerRef: RefObject<HTMLDivElement | null>
  /** Whether the shell is the fullscreen element */
  isFullscreen: boolean
  toggleFullscreen: () => void
  /** Re-initialises the engine; the shell (and fullscreen) stays */
  reload: () => void
  /** Changes on every reload, whether asked for here or by the page */
  reloadKey: number
}

export const PlayerShellContext = createContext<PlayerShell | null>(null)

export function usePlayerShell(): PlayerShell {
  const shell = useContext(PlayerShellContext)
  if (!shell) throw new Error('usePlayerShell must be used inside the player shell')
  return shell
}
