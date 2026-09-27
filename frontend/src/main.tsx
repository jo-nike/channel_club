import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
// Self-hosted brand fonts, upright only (the few italic lines get a
// synthesized slant). The packages ship no latin-only entry; unicode-range
// means a browser only fetches the subsets a page uses, and the service
// worker precaches them all (about 100 kB) for offline starts.
import '@fontsource-variable/figtree'
import '@fontsource-variable/big-shoulders-display'
import './index.css'
// Must come before the router: it applies ?tv=1 / ?tv=0 (see the module)
import './tvModeParam'
import { router } from '@/router'
import { logger } from '@/lib/logger'
import { TooltipProvider } from '@/components/ui/tooltip'

// Register service worker with update handling
// Uses autoUpdate mode - SW updates automatically in background
const updateSW = registerSW({
  onNeedRefresh() {
    // Optional: Show toast notification for new version
    // For now, just log - users get updated on next visit
    logger.info('PWA', 'New app version available')
  },
  onOfflineReady() {
    logger.info('PWA', 'App ready to work offline')
  },
  onRegisterError(error) {
    // Log but don't crash - SW is a progressive enhancement
    logger.error('PWA', 'SW registration error', error)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider delayDuration={300}>
      <RouterProvider router={router} />
    </TooltipProvider>
  </StrictMode>,
)

// Export for potential use in components (e.g., manual update trigger)
export { updateSW }
