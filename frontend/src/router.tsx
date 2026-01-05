import { createBrowserRouter, Navigate } from 'react-router-dom'
import { App } from '@/App'
import { TVView } from '@/components/tv/TVView'
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
            <TVView />
          </ProtectedRoute>
        ),
      },
      {
        // Legacy route - redirect to root for backwards compatibility
        path: 'tv',
        element: <Navigate to="/" replace />,
      },
      {
        // Legacy route - redirect to root for backwards compatibility
        path: 'ersatztv',
        element: <Navigate to="/" replace />,
      },
    ],
  },
])
