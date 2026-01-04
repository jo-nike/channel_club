import { createBrowserRouter, Navigate } from 'react-router-dom'
import { App } from '@/App'
import { TVView } from '@/components/tv/TVView'
import { InitialRouteRedirect } from '@/components/InitialRouteRedirect'
import { ProtectedRoute } from '@/components/ProtectedRoute'

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
        path: 'tv',
        element: (
          <ProtectedRoute>
            <TVView />
          </ProtectedRoute>
        ),
      },
      {
        // Legacy route - redirect to /tv
        path: 'ersatztv',
        element: <Navigate to="/tv" replace />,
      },
    ],
  },
])
