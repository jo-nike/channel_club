/* Workers before the update prompt were autoUpdate workers, and tabs they
 * started never show the prompt. So the first prompt-mode worker takes over
 * by itself, once; the marker cache records that, and later workers wait. */
const PROMPT_MODE_MARKER = 'prompt-mode-migrated'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.has(PROMPT_MODE_MARKER).then((migrated) => {
    if (migrated) return undefined
    return caches.open(PROMPT_MODE_MARKER).then(() => self.skipWaiting())
  }))
})

/* Retire data written by the previous worker before taking control. */
self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all(
    ['api-cache', 'static-assets', 'image-cache'].map((name) => caches.delete(name)),
  ))
})
