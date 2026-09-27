import { Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { LoginForm } from '@/components/LoginForm'
import { AppLoadingScreen } from '@/components/AppLoadingScreen'
import { OfflineFallback } from '@/components/OfflineFallback'
import { InstallPrompt } from '@/components/InstallPrompt'
import { Toaster } from '@/components/ui/sonner'

export function App() {
  const { isAuthenticated, isInitializing } = useAuth()

  // Apply the stored theme here, before the early returns, so the loading
  // and sign-in screens are themed too (not only the main view)
  const { isDark } = useTheme()
  const toastTheme = isDark ? 'dark' : 'light'

  // Show loading screen while checking auth state
  if (isInitializing) {
    return (
      <>
        <OfflineFallback />
        <AppLoadingScreen />
        <Toaster theme={toastTheme} />
      </>
    )
  }

  if (!isAuthenticated) {
    return (
      <>
        <OfflineFallback />
        <div className="flex min-h-screen items-center justify-center bg-background">
          <LoginForm />
        </div>
        <Toaster theme={toastTheme} />
      </>
    )
  }

  return (
    <>
      <OfflineFallback />
      <Outlet />
      <InstallPrompt />
      <Toaster theme={toastTheme} />
    </>
  )
}
