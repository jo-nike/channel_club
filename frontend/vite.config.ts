import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { readFileSync } from 'node:fs'

const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

// Vidstack's HLS and DASH providers fall back to loading their library from
// cdn.jsdelivr.net. The player hands them bundled hls.js, so blank the CDN
// base in Vidstack's modules to make a third-party script load impossible.
// scripts/check-no-cdn.mjs fails the build if jsdelivr still reaches dist/.
const JSDELIVR_CDN = /(["'`])https:\/\/cdn\.jsdelivr\.net\1/g

function stripVidstackCdn(): Plugin {
  return {
    name: 'strip-vidstack-cdn',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]node_modules[\\/](@vidstack[\\/]react|vidstack)[\\/]/.test(id)) return null
      if (!code.includes('cdn.jsdelivr.net')) return null
      return { code: code.replace(JSDELIVR_CDN, '$1$1'), map: null }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    // The Docker build passes the image's build id; local builds are 'dev'
    __APP_BUILD_ID__: JSON.stringify(process.env.VITE_APP_BUILD_ID || 'dev'),
  },
  plugins: [
    stripVidstackCdn(),
    react(),
    tailwindcss(),
    VitePWA({
      // A waiting update applies when nothing is playing, or when the viewer
      // chooses Reload (src/lib/appUpdate.ts); it never reloads a playing tab
      registerType: 'prompt',
      // src/lib/appUpdate.ts registers the worker itself
      injectRegister: false,
      workbox: {
        // Precache app shell assets
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        importScripts: ['/sw-migration.js'],

        // Runtime caching strategies
        runtimeCaching: [
          {
            // Match before file extensions so API data always uses server authorization.
            urlPattern: /^https?:\/\/[^/]+\/api(?:\/|$)/,
            handler: 'NetworkOnly',
          },
          {
            // Static assets - cache first (versioned by build)
            urlPattern: /\.(?:js|css|woff2?)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-assets',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
          {
            // Images - cache first
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
            },
          },
        ],

        // Navigate fallback for SPA routing
        navigateFallback: '/index.html',
        // Exclude streams and WebSocket from navigation fallback
        navigateFallbackDenylist: [/^\/api(?:\/|$)/],
      },
      manifest: {
        name: 'Channel Club',
        short_name: 'Channel Club',
        description: 'Good TV. Better company.',
        theme_color: '#0d0f18',
        background_color: '#0d0f18',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true, // Listen on all interfaces (0.0.0.0) for LAN access
    proxy: {
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
        ws: true, // Enable WebSocket proxying
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
