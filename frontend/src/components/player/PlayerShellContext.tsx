import { createContext, useContext, useEffect, type RefObject } from 'react'

/**
 * The player shell: one element that stays mounted while the video engine
 * inside it is swapped (a live channel change, an ErsatzTV channel switch).
 * It is the fullscreen element, so fullscreen survives those swaps and a
 * reload, and the scope for the auto-hide, the engines' keyboard shortcuts
 * and portals. The control bar (PlayerChrome) reads fullscreen, theater and
 * the controls' visibility here.
 */
export interface PlayerShell {
  /** The shell element: fullscreen target, portal container, event scope */
  containerRef: RefObject<HTMLDivElement | null>
  /** Whether the shell is the fullscreen element */
  isFullscreen: boolean
  toggleFullscreen: () => void
  /** The page's theater layout, which the player's controls switch */
  isTheaterMode: boolean
  toggleTheaterMode: () => void
  /**
   * Whether the controls are showing: one auto-hide for the whole player, so
   * the control bar and any overlay that follows it agree
   */
  controlsVisible: boolean
  /** The engine's playback: only a playing video hides its controls (see useShellPlayback) */
  setPlaying: (playing: boolean) => void
  /** The pointer is over the control bar, which keeps it up */
  setHoveringControls: (hovering: boolean) => void
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

/**
 * Reports an engine's playback to the shell's auto-hide. An engine that goes
 * away (a channel change, a stream retry) counts as stopped, and the pointer
 * no longer counts as over its control bar, which a mouseleave would never say.
 */
export function useShellPlayback(isPlaying: boolean): void {
  const { setPlaying, setHoveringControls } = usePlayerShell()

  useEffect(() => {
    setPlaying(isPlaying)
  }, [isPlaying, setPlaying])

  useEffect(
    () => () => {
      setPlaying(false)
      setHoveringControls(false)
    },
    [setPlaying, setHoveringControls]
  )
}
