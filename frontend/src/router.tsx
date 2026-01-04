import { createBrowserRouter } from 'react-router-dom'
import { App } from '@/App'
import { ErsatzTVView } from '@/components/ersatztv/ErsatzTVView'
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
