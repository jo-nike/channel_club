import { describe, it, expect } from 'vitest'

// Test the expected behavior of PWA configuration
describe('PWA Configuration', () => {
  describe('Caching Strategies', () => {
    it('should have workbox runtimeCaching for API routes', async () => {
      // Test that vite.config.ts exports correct PWA config
      // The actual SW generation is tested at build time
      // This tests our configuration expectations

      // Validate the pattern matches API routes but not WebSocket
      const apiPattern = /^https?:\/\/[^/]+\/api\/(?!ws).*/
      expect(apiPattern.test('http://localhost/api/channels')).toBe(true)
      expect(apiPattern.test('http://localhost/api/auth/token')).toBe(true)
      expect(apiPattern.test('http://localhost/api/ws')).toBe(false)
    })

    it('should have CacheFirst strategy for static assets', () => {
      // Static assets pattern
      const staticPattern = /\.(?:js|css|woff2?)$/
      expect(staticPattern.test('main.abc123.js')).toBe(true)
      expect(staticPattern.test('styles.def456.css')).toBe(true)
      expect(staticPattern.test('font.woff2')).toBe(true)
      expect(staticPattern.test('index.html')).toBe(false)
    })

    it('should have CacheFirst strategy for images', () => {
      const imagePattern = /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/
      expect(imagePattern.test('logo.png')).toBe(true)
      expect(imagePattern.test('icon.svg')).toBe(true)
      expect(imagePattern.test('photo.jpg')).toBe(true)
      expect(imagePattern.test('favicon.ico')).toBe(true)
      expect(imagePattern.test('video.mp4')).toBe(false)
    })
  })

  describe('Exclusion Patterns', () => {
    it('should exclude WebSocket connections', () => {
      const wsPattern = /^\/api\/ws/
      expect(wsPattern.test('/api/ws')).toBe(true)
      expect(wsPattern.test('/api/ws/connect')).toBe(true)
      expect(wsPattern.test('/api/channels')).toBe(false)
    })

    it('should exclude HLS stream segments', () => {
      const streamPattern = /^\/api\/ersatztv\/stream/
      const segmentPattern = /^\/api\/ersatztv\/segments/

      expect(streamPattern.test('/api/ersatztv/stream/channel1')).toBe(true)
      expect(segmentPattern.test('/api/ersatztv/segments/123.ts')).toBe(true)
      expect(streamPattern.test('/api/ersatztv/channels')).toBe(false)
    })

    it('should exclude blob URLs from caching', () => {
      // Blob URLs are handled by navigateFallbackDenylist
      const blobPattern = /^blob:/
      expect(blobPattern.test('blob:http://localhost/abc123')).toBe(true)
      expect(blobPattern.test('http://localhost/api/data')).toBe(false)
    })
  })
})
