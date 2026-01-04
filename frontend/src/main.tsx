import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import { router } from '@/router'
import { logger } from '@/lib/logger'

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
    <RouterProvider router={router} />
  </StrictMode>,
)

// Export for potential use in components (e.g., manual update trigger)
export { updateSW }
