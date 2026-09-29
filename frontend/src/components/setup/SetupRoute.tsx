import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { AppLoadingScreen } from '@/components/AppLoadingScreen'
import { OfflineFallback } from '@/components/OfflineFallback'
import { Wordmark } from '@/components/brand/Wordmark'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { decodeTokenPayload } from '@/lib/jwt'
import { getSetupStatus } from '@/services/setupApi'
import { useAuthStore } from '@/stores/authStore'
import type { SetupStatus } from '@/types/setup'
import { clearProgress } from './progressStorage'
import { SetupWizard } from './SetupWizard'
import type { WizardAdmin } from './wizardReducer'

/** The admin a session belongs to: a Plex sign-in carries its Plex id. */
function sessionAdmin(token: string | null, username: string | null): WizardAdmin {
  const plexId = token ? decodeTokenPayload(token)?.plex_id : undefined
  return typeof plexId === 'string'
    ? { signIn: 'plex', username: username ?? '', plexId }
    : { signIn: 'password', username: username ?? '', plexId: null }
}

function Unreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background px-4 pt-safe pb-safe text-center">
      <h1 className="text-foreground">
        <Wordmark size="lg" />
      </h1>
      <p role="alert" className="text-muted-foreground">
        Couldn't reach Channel Club's server.
      </p>
      <Button type="button" variant="outline" className="h-11 px-5" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

/**
 * /setup: the wizard while the club is unclaimed (for anyone) or claimed
 * (for its admin). Once setup is complete, or for anyone else, it's home.
 * App isn't mounted here, so this starts sign-in, the theme and the toaster.
 */
export function SetupRoute() {
  const { isInitializing, isAuthenticated, isAdmin, token, username } = useAuth()
  const { isDark } = useTheme()
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getSetupStatus(controller.signal)
      .then((next) => {
        if (next.setupState === 'unclaimed') {
          // Nobody has an account yet, so a stored session is from before
          // and would only be refused; so is any progress stored with it
          if (useAuthStore.getState().token) useAuthStore.getState().logout()
          clearProgress()
        }
        setStatus(next)
      })
      .catch(() => {
        if (!controller.signal.aborted) setUnreachable(true)
      })
    return () => controller.abort()
  }, [attempt])

  const retry = () => {
    setUnreachable(false)
    setAttempt((n) => n + 1)
  }

  let content
  if (unreachable) {
    content = <Unreachable onRetry={retry} />
  } else if (status === null || isInitializing) {
    content = <AppLoadingScreen />
  } else if (status.setupState === 'complete' || (status.setupState === 'claimed' && !(isAuthenticated && isAdmin))) {
    // Signed-out admins sign in at home first
    content = <Navigate to="/" replace />
  } else {
    content = (
      <SetupWizard
        setupState={status.setupState}
        envLocked={status.envLocked}
        admin={status.setupState === 'claimed' ? sessionAdmin(token, username) : null}
      />
    )
  }

  return (
    <>
      <OfflineFallback />
      {content}
      <Toaster theme={isDark ? 'dark' : 'light'} />
    </>
  )
}
