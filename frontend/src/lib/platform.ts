/**
 * Running as an installed app (home-screen PWA) rather than in a browser tab.
 * Chrome and Android report the display mode; iOS Safari only sets navigator.standalone.
 */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

/**
 * An iPhone, iPad or iPod, where installing is Share > Add to Home Screen
 * (iOS browsers never fire beforeinstallprompt). iPadOS Safari reports a
 * Macintosh user agent, so a touch screen on a "Mac" counts as an iPad.
 */
export function isIOS(): boolean {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}
