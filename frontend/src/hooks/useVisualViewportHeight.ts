import { useEffect } from 'react'

const APP_HEIGHT_VAR = '--app-height'

/**
 * While `active`, keeps `--app-height` on <html> at the visual viewport's
 * height, and removes it again afterwards. iOS doesn't shrink the layout
 * viewport when the soft keyboard opens, so a 100dvh layout runs on under
 * the keyboard and hides the chat composer; the visual viewport is what is
 * actually left on screen. Resize catches the keyboard opening and closing,
 * scroll the browser panning the page to the focused field.
 */
export function useVisualViewportHeight(active: boolean): void {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!active || !viewport) return
    const root = document.documentElement
    const update = () => root.style.setProperty(APP_HEIGHT_VAR, `${viewport.height}px`)
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      root.style.removeProperty(APP_HEIGHT_VAR)
    }
  }, [active])
}
