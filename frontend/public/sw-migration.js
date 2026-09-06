/* Retire data written by the previous worker before taking control. */
self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all(
    ['api-cache', 'static-assets', 'image-cache'].map((name) => caches.delete(name)),
  ))
})
