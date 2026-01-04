import { Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { LoginForm } from '@/components/LoginForm'
import { AppLoadingScreen } from '@/components/AppLoadingScreen'
import { OfflineFallback } from '@/components/OfflineFallback'
import { InstallPrompt } from '@/components/InstallPrompt'
import { Toaster } from '@/components/ui/sonner'

export function App() {
  const { isAuthenticated, isInitializing } = useAuth()

  // Show loading screen while checking auth state
  if (isInitializing) {
    return (
      <>
        <OfflineFallback />
        <AppLoadingScreen />
        <Toaster />
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
        <Toaster />
      </>
    )
  }

  return (
    <>
      <OfflineFallback />
      <Outlet />
      <InstallPrompt />
      <Toaster />
    </>
  )
}
