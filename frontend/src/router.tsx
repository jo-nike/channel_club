import { useRef } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { App } from '@/App'
import { MainView } from '@/components/MainView'
import { ErsatzTVView } from '@/components/ersatztv/ErsatzTVView'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { useUIStore } from '@/stores/uiStore'

/**
 * InitialRouteRedirect handles initial app load redirection only.
 * On first render, checks lastRoute and redirects if needed.
 * Subsequent renders always show MainView (allowing normal navigation).
 */
function InitialRouteRedirect() {
  const lastRoute = useUIStore((s) => s.lastRoute)
  const hasRedirected = useRef(false)

  // Only redirect on initial load, not on subsequent navigations
  if (!hasRedirected.current && lastRoute === '/ersatztv') {
    hasRedirected.current = true
    return <Navigate to="/ersatztv" replace />
  }

  // Mark as handled and render MainView
  hasRedirected.current = true
  return <MainView />
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        index: true,
        element: (
          <ProtectedRoute>
            <InitialRouteRedirect />
          </ProtectedRoute>
        ),
      },
      {
        path: 'ersatztv',
        element: (
          <ProtectedRoute>
            <ErsatzTVView />
          </ProtectedRoute>
        ),
      },
    ],
  },
])
