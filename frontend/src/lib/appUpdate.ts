/**
 * App updates through the service worker, in vite-plugin-pwa's prompt mode.
 *
 * A new worker waits instead of taking over. If nothing is playing it is
 * applied at once (the page reloads); otherwise a toast offers Reload, so a
 * tab in the middle of a show never reloads without the viewer acting.
 * Updates are looked for hourly, and at once when the server reports a
 * different build than the one this page was built from.
 */
import { toast } from 'sonner'
import { logger } from '@/lib/logger'

export const APP_BUILD_ID: string = __APP_BUILD_ID__

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000
const UPDATE_TOAST_ID = 'app-update'

let registration: ServiceWorkerRegistration | null = null
let checkTimer: ReturnType<typeof setInterval> | null = null

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

/** Forget the registration and stop the hourly check (tests). */
export function resetAppUpdate(): void {
  if (checkTimer !== null) clearInterval(checkTimer)
  checkTimer = null
  registration = null
}
