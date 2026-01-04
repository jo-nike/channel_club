# Story 10.2: Service Worker & Caching

Status: review

## Story

As a user,
I want the app shell to load quickly,
So that I see UI immediately even on slow connections.

## Acceptance Criteria

1. **Given** vite-plugin-pwa is configured
   **When** the app builds
   **Then** a service worker is generated with precaching for app shell assets

2. **Given** static assets (JS, CSS, images)
   **When** requested after first load
   **Then** they are served from cache (CacheFirst strategy)

3. **Given** API requests
   **When** fetching channels or streams
   **Then** network is preferred with optional fallback (NetworkFirst)

4. **Given** the user is offline
   **When** they launch the installed PWA
   **Then** they see the app shell with "Network unavailable" message

## Tasks / Subtasks

- [x] Task 1: Configure Workbox caching strategies (AC: #1, #2, #3)
  - [x] Configure generateSW mode in vite-plugin-pwa
  - [x] Set up CacheFirst for static assets (js, css, images, fonts)
  - [x] Set up NetworkFirst for API routes (/api/*)
  - [x] Configure cache expiration policies

- [x] Task 2: Configure precaching (AC: #1)
  - [x] Enable workbox precaching for app shell
  - [x] Include index.html, main JS/CSS bundles
  - [x] Exclude video/stream content from caching

- [x] Task 3: Create offline fallback UI (AC: #4)
  - [x] Create OfflineFallback component
  - [x] Display "Network unavailable" message
  - [x] Add retry button that checks connectivity
  - [x] Style consistent with app theme

- [x] Task 4: Register service worker with update handling (AC: #1)
  - [x] Configure autoUpdate registration type
  - [x] Add update prompt for new versions (optional toast)
  - [x] Handle SW registration errors gracefully

- [x] Task 5: Configure runtime caching exclusions (AC: #3)
  - [x] Exclude WebSocket connections from SW interception
  - [x] Exclude HLS stream segments (no caching)
  - [x] Exclude blob URLs from caching

## Dev Notes

### Technical Approach

vite-plugin-pwa uses Workbox under the hood. Configure:
- `generateSW` mode for automatic service worker generation
- Runtime caching rules for different resource types
- Precaching for app shell assets

### vite.config.ts Configuration

```typescript
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    // ... existing plugins
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Precache app shell
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],

        // Runtime caching strategies
        runtimeCaching: [
          {
            // API calls - network first with cache fallback
            urlPattern: /^\/api\/(?!ws).*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 5 // 5 minutes
              },
              networkTimeoutSeconds: 10
            }
          },
          {
            // Static assets - cache first
            urlPattern: /\.(?:js|css|woff2?)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-assets',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              }
            }
          },
          {
            // Images - cache first
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 7 // 7 days
              }
            }
          }
        ],

        // Exclude streams and WebSocket
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          /^\/api\/ws/,
          /^\/api\/ersatztv\/stream/,
          /^\/api\/ersatztv\/segments/
        ]
      },
      manifest: {
        // ... manifest config from Story 10.1
      }
    })
  ]
})
```

### Offline Fallback Component

Create `src/components/OfflineFallback.tsx`:

```typescript
export function OfflineFallback() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (isOnline) return null

  return (
    <div className="fixed inset-0 bg-slate-900/90 flex items-center justify-center z-50">
      <div className="text-center p-8">
        <WifiOff className="h-16 w-16 mx-auto mb-4 text-slate-400" />
        <h2 className="text-2xl font-bold text-white mb-2">Network Unavailable</h2>
        <p className="text-slate-400 mb-4">Please check your connection</p>
        <Button onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    </div>
  )
}
```

### Service Worker Registration

vite-plugin-pwa handles registration automatically with `registerType: 'autoUpdate'`. For custom handling:

```typescript
// src/main.tsx or App.tsx
import { registerSW } from 'virtual:pwa-register'

const updateSW = registerSW({
  onNeedRefresh() {
    // Show toast: "New version available. Click to update."
    if (confirm('New content available. Reload?')) {
      updateSW(true)
    }
  },
  onOfflineReady() {
    console.log('App ready to work offline')
  }
})
```

### Caching Strategy Rationale

| Resource Type | Strategy | Reason |
|--------------|----------|--------|
| Static assets | CacheFirst | Versioned by build, immutable |
| API data | NetworkFirst | Need fresh data, cache as fallback |
| Images | CacheFirst | Large files, rarely change |
| WebSocket | Excluded | Cannot cache real-time |
| HLS streams | Excluded | Live content, no caching needed |

### Project Structure Notes

Files to create/modify:
- `frontend/vite.config.ts` - Add workbox configuration
- `frontend/src/components/OfflineFallback.tsx` - New component
- `frontend/src/App.tsx` - Add OfflineFallback to root

### TypeScript Configuration

Add to `tsconfig.app.json`:

```json
{
  "compilerOptions": {
    "types": ["vite-plugin-pwa/client"]
  }
}
```

This enables types for `virtual:pwa-register`.

### Testing Checklist

1. Build app: `npm run build`
2. Preview: `npm run preview`
3. Chrome DevTools > Application > Service Workers
4. Verify SW is registered and active
5. Check "Cache Storage" for precached assets
6. Toggle "Offline" in Network panel
7. Reload - should see cached app shell
8. Verify API calls show fallback behavior

### Cache Size Considerations

Keep caches lean:
- App shell ~1MB precached
- API cache limited to 50 entries
- Images limited to 50 entries
- Don't cache video content

### References

- [Source: _bmad-output/project-planning-artifacts/epics.md#Story 10.2]
- [Source: _bmad-output/project-context.md#Technology Stack]
- [Workbox Strategies](https://developer.chrome.com/docs/workbox/modules/workbox-strategies)
- [vite-plugin-pwa Workbox Config](https://vite-pwa-org.netlify.app/workbox/)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

### Completion Notes List

- Configured vite-plugin-pwa with Workbox caching strategies in vite.config.ts
- Added generateSW mode with precaching for app shell assets (29 entries, ~1.17 MB)
- Configured CacheFirst strategy for static assets (js, css, fonts) with 30-day expiration
- Configured CacheFirst strategy for images with 7-day expiration
- Configured NetworkFirst strategy for API routes with 5-minute cache and 10-second network timeout
- Added navigateFallbackDenylist to exclude WebSocket, HLS streams, and blob URLs
- Created OfflineFallback component with WifiOff icon, "Network Unavailable" message, and Retry button
- Integrated OfflineFallback into App.tsx for all auth states (loading, login, main)
- Added service worker registration in main.tsx with onNeedRefresh, onOfflineReady, and onRegisterError handlers
- Added vite-plugin-pwa/client types to tsconfig.app.json
- All 589 tests pass, lint passes, build generates sw.js successfully

### File List

- frontend/vite.config.ts (modified) - Added Workbox configuration with runtime caching strategies
- frontend/tsconfig.app.json (modified) - Added vite-plugin-pwa/client types
- frontend/src/main.tsx (modified) - Added service worker registration with update handling
- frontend/src/App.tsx (modified) - Integrated OfflineFallback component
- frontend/src/components/OfflineFallback.tsx (new) - Offline fallback UI component
- frontend/src/components/OfflineFallback.test.tsx (new) - Tests for OfflineFallback component
- frontend/src/test/pwa.test.ts (new) - Tests for PWA caching strategy patterns
- frontend/src/test/pwa-register.test.ts (new) - Tests for SW registration configuration

## Change Log

- 2026-01-04: Implemented Story 10.2 - Service Worker & Caching (PWA offline support)
