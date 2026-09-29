import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom'
import { App } from '@/App'
import { TVView } from '@/components/tv/TVView'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AppErrorScreen } from '@/components/AppErrorScreen'
import { AppLoadingScreen } from '@/components/AppLoadingScreen'

export const routes: RouteObject[] = [
  {
    // First-run setup, needed once per install: loaded only when opened
    path: '/setup',
    lazy: () => import('@/components/setup/SetupRoute').then((module) => ({ Component: module.SetupRoute })),
    errorElement: <AppErrorScreen />,
    hydrateFallbackElement: <AppLoadingScreen />,
  },
  {
    path: '/',
    element: <App />,
    errorElement: <AppErrorScreen />,
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
      {
        // Unknown paths (old bookmarks such as /login or /admin) go home
        // instead of showing a 404 error page
        path: '*',
        element: <Navigate to="/" replace />,
      },
    ],
  },
]

export const router = createBrowserRouter(routes)
