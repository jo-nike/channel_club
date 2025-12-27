import { useAuth } from '@/hooks/useAuth'
import { LoginForm } from '@/components/LoginForm'
import { MainView } from '@/components/MainView'
import { AppLoadingScreen } from '@/components/AppLoadingScreen'
import { Toaster } from '@/components/ui/sonner'

export function App() {
  const { isAuthenticated, isInitializing } = useAuth()

  // Show loading screen while checking auth state
  if (isInitializing) {
    return (
      <>
        <AppLoadingScreen />
        <Toaster />
      </>
    )
  }

  if (!isAuthenticated) {
    return (
      <>
        <div className="flex min-h-screen items-center justify-center bg-background">
          <LoginForm />
        </div>
        <Toaster />
      </>
    )
  }

  return (
    <>
      <MainView />
      <Toaster />
    </>
  )
}
