import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { MainView } from '@/components/MainView'
import { useUIStore } from '@/stores/uiStore'

/**
 * InitialRouteRedirect handles initial app load redirection only.
 * Uses useState lazy initializer to capture the initial lastRoute value once,
 * ensuring pure render behavior.
 */
export function InitialRouteRedirect() {
  // Capture lastRoute only on initial mount using lazy initializer
  const [shouldRedirect] = useState(() => {
    return useUIStore.getState().lastRoute === '/ersatztv'
  })

  if (shouldRedirect) {
    return <Navigate to="/ersatztv" replace />
  }

  return <MainView />
}
