/**
 * Running as an installed app (home-screen PWA) rather than in a browser tab.
 * Chrome and Android report the display mode; iOS Safari only sets navigator.standalone.
 */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}
