import { APP_TAGLINE } from '@/lib/appInfo'
import { useState, useEffect, useEffectEvent, useRef } from 'react'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AppLoadingScreen } from '@/components/AppLoadingScreen'
import { Wordmark } from '@/components/brand/Wordmark'
import { PlexLoginButton } from '@/components/PlexLoginButton'
import { QRPlexLogin } from '@/components/QRPlexLogin'
import { useAuthStore } from '@/stores/authStore'
import { useTVMode } from '@/hooks/useTVMode'
import { PLEX_ERROR_COPY, usePlexSignIn } from '@/hooks/usePlexSignIn'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import { login, getAuthConfig, loginWithPlex, type AuthConfig } from '@/services/api'
import { PlexAuthError } from '@/services/plexAuth'

type PlexAuthMode = 'select' | 'popup' | 'qr'

export function LoginForm() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  // A message, or a Plex sign-in failure from the popup or the redirect (shown
  // with Try again / Sign in with a code)
  const [error, setError] = useState<string | PlexAuthError>('')
  const [isLoading, setIsLoading] = useState(false)
  // A code sign-in's token is being exchanged for a session
  const [qrFinishing, setQrFinishing] = useState(false)
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [plexAuthMode, setPlexAuthMode] = useState<PlexAuthMode>('select')
  const setAuth = useAuthStore((state) => state.setAuth)
  const isTVMode = useTVMode()
  // The TV opens on the code screen once; leaving it doesn't bring it back
  const autoStartedRef = useRef(false)
  const plex = usePlexSignIn({
    onToken: async (authToken, signal) => {
      const response = await loginWithPlex(authToken)
      if (signal.aborted) return
      setAuth(response.accessToken, response.role)
    },
    onError: (err) => setError(err),
    onStart: () => setError(''),
  })
  const plexLoading = plex.waiting || qrFinishing

  // A TV with Plex goes straight to the code screen: no D-pad trip to the
  // Plex button first. Set with the config, so the choice screen never flashes.
  const applyAuthConfig = useEffectEvent((config: AuthConfig) => {
    setAuthConfig(config)
    if (isTVMode && config.plexAuthEnabled && !autoStartedRef.current) {
      autoStartedRef.current = true
      setPlexAuthMode('qr')
    }
  })

  useEffect(() => {
    getAuthConfig()
      .then((config) => applyAuthConfig(config))
      .catch((err) => {
        logger.error('Auth', 'Failed to load auth config', err)
        setError('Failed to load authentication configuration')
      })
      .finally(() => setConfigLoading(false))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const response = await login({ username, password })
      setAuth(response.accessToken, response.role, username)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid credentials')
    } finally {
      setIsLoading(false)
    }
  }

  const handlePlexLogin = async () => {
    // On TV, default to QR mode
    if (isTVMode) {
      setPlexAuthMode('qr')
      return
    }
    // A popup, or on iPhones, iPads and installed apps the whole page goes to Plex
    await plex.start()
  }

  const handlePlexCancel = () => {
    plex.cancel()
  }

  const handleQRPlexSuccess = async (authToken: string) => {
    setQrFinishing(true)
    setError('')
    try {
      const response = await loginWithPlex(authToken)
      setAuth(response.accessToken, response.role)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete Plex login')
    } finally {
      setQrFinishing(false)
      setPlexAuthMode('select')
    }
  }

  const handleSignInWithCode = () => {
    setError('')
    setPlexAuthMode('qr')
  }

  const handleQRPlexCancel = () => {
    setPlexAuthMode('select')
  }

  const handleQRPlexError = (err: Error) => {
    setError(err.message)
  }

  // A fresh code replaces whatever went wrong before, so a TV never shows an
  // old error above a code that works. The code screen reports its own timeout.
  const handleQRCodeRequested = () => {
    setError('')
  }

  // While the config loads, carry on showing the app's loading screen
  if (configLoading) {
    return <AppLoadingScreen />
  }

  // No auth methods configured
  const noAuthConfigured = authConfig && !authConfig.localAuthEnabled && !authConfig.plexAuthEnabled
  if (noAuthConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="w-full max-w-md p-8 border rounded-lg shadow-lg bg-card text-center">
          <h1 className="flex justify-center text-foreground mb-4">
            <Wordmark size="lg" />
          </h1>
          <p className="mb-6 text-muted-foreground">{APP_TAGLINE}</p>
          <div
            role="alert"
            className="p-4 text-xl text-foreground bg-destructive/10 border border-destructive rounded-md"
          >
            No authentication methods configured
          </div>
          <p className="mt-4 text-muted-foreground">
            Please contact the administrator to enable authentication.
          </p>
        </div>
      </div>
    )
  }

  const showLocalAuth = authConfig?.localAuthEnabled === true
  const showPlexAuth = authConfig?.plexAuthEnabled === true
  const showSeparator = showLocalAuth && showPlexAuth
  // Desktop-sized controls; room-sized on a TV
  const labelClass = cn('block text-foreground', isTVMode ? 'text-xl' : 'text-sm')
  const inputClass = isTVMode ? 'h-14 text-2xl px-4' : 'h-11 text-base md:text-base px-3'

  const errorCallout = error && (
    <div
      role="alert"
      className={cn(
        'flex gap-3 p-4 text-foreground bg-destructive/10 border border-destructive rounded-md',
        isTVMode ? 'text-2xl' : 'text-sm'
      )}
    >
      <AlertCircle className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
      <div className="space-y-3">
        <p>{typeof error === 'string' ? error : PLEX_ERROR_COPY[error.code]}</p>
        {error instanceof PlexAuthError && (
          <div className="flex flex-wrap gap-2">
            {/* Not the amber default: the Plex button stays the one amber action */}
            <Button type="button" size="sm" variant="secondary" onClick={handlePlexLogin}>
              Try again
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={handleSignInWithCode}>
              Sign in with a code
            </Button>
          </div>
        )}
      </div>
    </div>
  )

  // TV code screen: full width, large code and QR to read from the sofa
  if (isTVMode && showPlexAuth && plexAuthMode === 'qr') {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background px-16 py-12">
        <div className="w-full max-w-7xl space-y-12">
          <div className="space-y-4">
            <h1 className="text-foreground">
              <Wordmark size="lg" className="gap-5 text-7xl" />
            </h1>
            <p className="text-3xl text-muted-foreground">{APP_TAGLINE}</p>
          </div>

          {errorCallout}

          <QRPlexLogin
            variant="tv"
            autoRestart
            cancelLabel={showLocalAuth ? 'Use another sign-in method' : 'Cancel'}
            onSuccess={handleQRPlexSuccess}
            onCancel={handleQRPlexCancel}
            onError={handleQRPlexError}
            onCodeRequested={handleQRCodeRequested}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-md space-y-6 p-8 border rounded-lg shadow-lg bg-card">
        <h1 className="flex justify-center text-foreground">
          <Wordmark size="lg" />
        </h1>
        <p className="text-center text-muted-foreground">{APP_TAGLINE}</p>

        {errorCallout}

        {/* Local Auth Form */}
        {showLocalAuth && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="username" className={labelClass}>
                Username
              </label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                required
                disabled={isLoading}
                autoComplete="username"
                className={inputClass}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className={labelClass}>
                Password
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                required
                disabled={isLoading}
                autoComplete="current-password"
                className={inputClass}
              />
            </div>

            {/* With Plex on, its button is the one call to action, so this steps back */}
            <Button
              type="submit"
              variant={showPlexAuth ? 'secondary' : 'default'}
              disabled={isLoading || plexLoading}
              className={cn('w-full', isTVMode ? 'h-14 text-2xl px-8' : 'h-12 text-base px-6')}
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>
        )}

        {/* Separator */}
        {showSeparator && (
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-sm uppercase">
              <span className="bg-card px-2 text-muted-foreground">or</span>
            </div>
          </div>
        )}

        {/* Plex Auth Section */}
        {showPlexAuth && plexAuthMode === 'select' && (
          <div className="space-y-3">
            <PlexLoginButton
              onClick={handlePlexLogin}
              onCancel={handlePlexCancel}
              isLoading={plexLoading}
              disabled={isLoading}
              tv={isTVMode}
            />
            {/* Show QR option link for desktop users */}
            {!isTVMode && (
              <button
                type="button"
                onClick={handleSignInWithCode}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Sign in with a code
              </button>
            )}
          </div>
        )}

        {/* QR Plex Login */}
        {showPlexAuth && plexAuthMode === 'qr' && (
          <QRPlexLogin
            onSuccess={handleQRPlexSuccess}
            onCancel={handleQRPlexCancel}
            onError={handleQRPlexError}
            onCodeRequested={handleQRCodeRequested}
          />
        )}
      </div>
    </div>
  )
}
