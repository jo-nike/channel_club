import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { useProgrammeReminders } from '@/hooks/useProgrammeReminders'
import { LoginForm } from '@/components/LoginForm'
import { AppLoadingScreen } from '@/components/AppLoadingScreen'
import { OfflineFallback } from '@/components/OfflineFallback'
import { InstallPrompt } from '@/components/InstallPrompt'
import { Toaster } from '@/components/ui/sonner'
import { logger } from '@/lib/logger'
import { getAuthConfig } from '@/services/api'

/** Programme reminders go off while someone is signed in, whichever view is open. */
function ReminderRunner() {
  useProgrammeReminders()
  return null
}

/**
 * An admin whose club isn't set up yet goes back to the wizard. The app
 * shows meanwhile: the check doesn't hold it up. A server that doesn't say
 * counts as set up.
 */
function ResumeSetupRedirect() {
  const [unfinished, setUnfinished] = useState(false)

  useEffect(() => {
    getAuthConfig()
      .then((config) => {
        if (config.setupState === 'claimed' || config.setupState === 'unclaimed') setUnfinished(true)
      })
      .catch((err) => logger.warn('Auth', 'Could not check whether setup is finished', err))
  }, [])

  return unfinished ? <Navigate to="/setup" replace /> : null
}

export function App() {
  const { isAuthenticated, isInitializing, isAdmin } = useAuth()

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
      {isAdmin && <ResumeSetupRedirect />}
      <InstallPrompt />
      <ReminderRunner />
      <Toaster theme={toastTheme} />
    </>
  )
}
