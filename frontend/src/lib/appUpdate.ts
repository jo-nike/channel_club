/**
 * App updates through the service worker, in vite-plugin-pwa's prompt mode.
 *
 * A new worker waits instead of taking over. If nothing is playing it is
 * applied at once (the page reloads); otherwise a toast offers Reload, so a
 * tab in the middle of a show never reloads without the viewer acting.
 * Updates are looked for hourly, and at once when the server reports a
 * different build than the one this page was built from.
 *
 * The worker is registered here with workbox-window rather than through
 * virtual:pwa-register, because the plugin's prompt mode reloads every tab
 * that showed the prompt once the new worker takes control, including a
 * playing tab when another, idle tab applied the update.
 */
import { toast } from 'sonner'
import { Workbox } from 'workbox-window'
import { logger } from '@/lib/logger'

export const APP_BUILD_ID: string = __APP_BUILD_ID__

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000
const UPDATE_TOAST_ID = 'app-update'

let registration: ServiceWorkerRegistration | null = null
let checkTimer: ReturnType<typeof setInterval> | null = null
// This tab asked the waiting worker to take over (automatically or by Reload)
let updateRequested = false
// A new worker took control without reloading this tab, so Reload has nothing left to apply
let tookOver = false

/** Ask the browser to look for a new service worker now. */
export function checkForAppUpdate(): void {
  if (!registration) return
  registration.update().catch((error: unknown) => {
    logger.warn('PWA', 'Update check failed', error)
  })
}

/** The periodic-update recipe: keep the registration and check hourly. */
export function watchForAppUpdates(r: ServiceWorkerRegistration | undefined): void {
  if (!r) return
  registration = r
  if (checkTimer !== null) clearInterval(checkTimer)
  checkTimer = setInterval(checkForAppUpdate, UPDATE_CHECK_INTERVAL_MS)
}

/** connection_ack names the server's build; a different one means a deploy happened. */
export function noticeServerBuild(serverBuildId: unknown, clientBuildId: string = APP_BUILD_ID): void {
  if (typeof serverBuildId !== 'string' || serverBuildId === clientBuildId) return
  // Local builds and dev servers have no real build id to compare
  if (serverBuildId === 'dev' || clientBuildId === 'dev') return
  logger.info('PWA', `Server runs build ${serverBuildId}, this page is ${clientBuildId}: checking for an update`)
  checkForAppUpdate()
}

/** A <video> on the page is playing. Kept to a DOM check so players need no wiring. */
export function isPlaybackActive(): boolean {
  return Array.from(document.querySelectorAll('video')).some((video) => !video.paused && !video.ended)
}

/** A new version is waiting: apply it now if nothing is playing, otherwise offer Reload. */
export function offerAppUpdate(updateSW: (reloadPage?: boolean) => Promise<void>): void {
  if (!isPlaybackActive()) {
    logger.info('PWA', 'Applying the new app version')
    void updateSW(true)
    return
  }
  toast('Channel Club was updated', {
    id: UPDATE_TOAST_ID,
    duration: Infinity,
    action: { label: 'Reload', onClick: () => { void updateSW(true) } },
  })
}

type ServiceWorkerEvents = Pick<Workbox, 'addEventListener' | 'messageSkipWaiting'>

/**
 * Offer each waiting worker, and reload when the new one takes control only
 * if this tab asked for it or has nothing playing. Every open tab gets the
 * controller change, so a playing tab keeps its show (and its Reload toast)
 * when another tab applies the update.
 */
export function handleServiceWorkerUpdates(wb: ServiceWorkerEvents, reload: () => void = () => window.location.reload()): void {
  wb.addEventListener('waiting', () => {
    logger.info('PWA', 'New app version available')
    tookOver = false
    offerAppUpdate(() => {
      // Another tab already applied it: skipWaiting would find no waiting worker
      if (tookOver) {
        reload()
        return Promise.resolve()
      }
      updateRequested = true
      wb.messageSkipWaiting()
      return Promise.resolve()
    })
  })
  wb.addEventListener('controlling', (event) => {
    if (!event.isUpdate) return
    if (updateRequested || !isPlaybackActive()) reload()
    else tookOver = true
  })
  wb.addEventListener('installed', (event) => {
    if (!event.isUpdate && !event.isExternal) logger.info('PWA', 'App ready to work offline')
  })
}

/** Register the worker vite-plugin-pwa builds (dist/sw.js); dev servers have none. */
export function registerAppServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const wb = new Workbox('/sw.js', { scope: '/' })
  handleServiceWorkerUpdates(wb)
  wb.register().then(watchForAppUpdates).catch((error: unknown) => {
    // Log but don't crash - SW is a progressive enhancement
    logger.error('PWA', 'SW registration error', error)
  })
}

/** Forget the registration and stop the hourly check (tests). */
export function resetAppUpdate(): void {
  if (checkTimer !== null) clearInterval(checkTimer)
  checkTimer = null
  registration = null
  updateRequested = false
  tookOver = false
}
