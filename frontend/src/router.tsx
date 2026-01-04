import { createBrowserRouter } from 'react-router-dom'
import { App } from '@/App'
import { MainView } from '@/components/MainView'
import { ErsatzTVView } from '@/components/ersatztv/ErsatzTVView'
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
            <MainView />
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
