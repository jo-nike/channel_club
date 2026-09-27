import { APP_NAME, APP_TAGLINE } from '@/lib/appInfo'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PlexLoginButton } from '@/components/PlexLoginButton'
import { QRPlexLogin } from '@/components/QRPlexLogin'
import { useAuthStore } from '@/stores/authStore'
import { useTVMode } from '@/hooks/useTVMode'
import { logger } from '@/lib/logger'
import { login, getAuthConfig, loginWithPlex, type AuthConfig } from '@/services/api'
import { authenticateWithPlex, PlexAuthError } from '@/services/plexAuth'

type PlexAuthMode = 'select' | 'popup' | 'qr'

export function LoginForm() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [plexLoading, setPlexLoading] = useState(false)
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [plexAuthMode, setPlexAuthMode] = useState<PlexAuthMode>('select')
  const setAuth = useAuthStore((state) => state.setAuth)
  const isTVMode = useTVMode()

  useEffect(() => {
    getAuthConfig()
      .then(setAuthConfig)
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
    // On desktop, use popup mode
    setPlexLoading(true)
    setError('')
    try {
      const authToken = await authenticateWithPlex()
      const response = await loginWithPlex(authToken)
      setAuth(response.accessToken, response.role)
    } catch (err) {
      const cancelled = err instanceof PlexAuthError && err.code === 'cancelled'
      if (err instanceof Error && !cancelled) {
        setError(err.message)
      }
    } finally {
      setPlexLoading(false)
    }
  }

  const handleQRPlexSuccess = async (authToken: string) => {
    setPlexLoading(true)
    setError('')
    try {
      const response = await loginWithPlex(authToken)
      setAuth(response.accessToken, response.role)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete Plex login')
    } finally {
      setPlexLoading(false)
      setPlexAuthMode('select')
    }
  }

  const handleQRPlexCancel = () => {
    setPlexAuthMode('select')
  }

  const handleQRPlexError = (err: Error) => {
    setError(err.message)
  }

  // Loading state while fetching config
  if (configLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="w-full max-w-md p-8 border rounded-lg shadow-lg bg-card">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-muted rounded w-3/4 mx-auto" />
            <div className="h-12 bg-muted rounded" />
            <div className="h-12 bg-muted rounded" />
            <div className="h-12 bg-muted rounded" />
          </div>
        </div>
      </div>
    )
  }

  // No auth methods configured
  const noAuthConfigured = authConfig && !authConfig.localAuthEnabled && !authConfig.plexAuthEnabled
  if (noAuthConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="w-full max-w-md p-8 border rounded-lg shadow-lg bg-card text-center">
          <h1 className="text-3xl font-bold text-foreground mb-4">{APP_NAME}</h1>
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-md space-y-6 p-8 border rounded-lg shadow-lg bg-card">
        <h1 className="text-3xl font-bold text-center text-foreground">
          {APP_NAME}
        </h1>
        <p className="text-center text-muted-foreground">{APP_TAGLINE}</p>

        {error && (
          <div
            role="alert"
            className="p-4 text-xl text-foreground bg-destructive/10 border border-destructive rounded-md"
          >
            {error}
          </div>
        )}

        {/* Local Auth Form */}
        {showLocalAuth && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="username" className="block text-xl text-foreground">
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
                className="h-14 text-2xl px-4"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="block text-xl text-foreground">
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
                className="h-14 text-2xl px-4"
              />
            </div>

            <Button
              type="submit"
              disabled={isLoading || plexLoading}
              className="h-14 text-2xl px-8 w-full"
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
            <PlexLoginButton onClick={handlePlexLogin} isLoading={plexLoading || isLoading} />
            {/* Show QR option link for desktop users */}
            {!isTVMode && (
              <button
                type="button"
                onClick={() => setPlexAuthMode('qr')}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Use QR code instead (for TV)
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
          />
        )}
      </div>
    </div>
  )
}
