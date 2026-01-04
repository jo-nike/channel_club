# Story 8.4: Conditional Login UI

Status: review

## Story

As a user,
I want the login page to show appropriate options based on configuration,
so that I see only relevant authentication methods.

## Acceptance Criteria

1. **No Auth Configured**: When `LOCAL_AUTH_ENABLED=false` AND `PLEX_AUTH_ENABLED=false`, show error "No authentication methods configured"
2. **Local Only**: When `LOCAL_AUTH_ENABLED=true` AND `PLEX_AUTH_ENABLED=false`, show only username/password form (no Plex option)
3. **Plex Only**: When `LOCAL_AUTH_ENABLED=false` AND `PLEX_AUTH_ENABLED=true`, show only "Sign in with Plex" button (no credential form)
4. **Both Enabled**: When `LOCAL_AUTH_ENABLED=true` AND `PLEX_AUTH_ENABLED=true`, show both credential form and Plex button with visual separator ("or")
5. **Login Success**: Either auth method succeeds, user is redirected to main app experience

## Tasks / Subtasks

- [x] Task 1: Add LOCAL_AUTH_ENABLED config (AC: #1, #2)
  - [x] Add `local_auth_enabled: bool = False` to Settings class
  - [x] Update `/api/auth/config` to include `localAuthEnabled`
  - [x] Update `/api/auth/token` to check `local_auth_enabled` flag
- [x] Task 2: Update LoginForm for conditional rendering (AC: #1-4)
  - [x] Fetch auth config on component mount
  - [x] Show loading state while fetching config
  - [x] Conditionally render credential form based on `localAuthEnabled`
  - [x] Conditionally render Plex button based on `plexAuthEnabled`
  - [x] Show error message when no auth methods enabled
  - [x] Show "or" separator when both methods enabled
- [x] Task 3: Handle no auth configured state (AC: #1)
  - [x] Create informative error UI with instructions for admin
  - [x] Style consistently with other error states
- [x] Task 4: Ensure auth state cleanup on success (AC: #5)
  - [x] Both auth methods use same `setAuth` flow
  - [x] Verify redirect works for both methods
- [x] Task 5: Write tests (AC: #1-5)
  - [x] Test no auth configured error display
  - [x] Test local only form display
  - [x] Test Plex only button display
  - [x] Test both methods with separator
  - [x] Test successful redirect for both methods

## Dev Notes

### Architecture Compliance

- **Component pattern**: Single LoginForm component handles all auth states
- **Config pattern**: Auth config fetched from backend
- **State pattern**: Loading/error states managed in component
- **API pattern**: Same auth response format for both methods

### Technical Implementation

**Updated LoginForm Component** (`frontend/src/components/LoginForm.tsx`):
```typescript
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/authStore'
import { login, getAuthConfig, loginWithPlex, AuthConfig } from '@/services/api'
import { authenticateWithPlex } from '@/services/plexAuth'

export function LoginForm() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [plexLoading, setPlexLoading] = useState(false)
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(true)
  const setAuth = useAuthStore((state) => state.setAuth)

  useEffect(() => {
    getAuthConfig()
      .then(setAuthConfig)
      .catch((err) => {
        console.error('Failed to load auth config:', err)
        setError('Failed to load authentication configuration')
      })
      .finally(() => setConfigLoading(false))
  }, [])

  const handleLocalSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const response = await login({ username, password })
      setAuth(response.accessToken, response.role)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid credentials')
    } finally {
      setIsLoading(false)
    }
  }

  const handlePlexLogin = async () => {
    setPlexLoading(true)
    setError('')
    try {
      const authToken = await authenticateWithPlex()
      const response = await loginWithPlex(authToken)
      setAuth(response.accessToken, response.role)
    } catch (err) {
      if (err instanceof Error && err.message !== 'Authentication cancelled') {
        setError(err.message)
      }
    } finally {
      setPlexLoading(false)
    }
  }

  // Loading state
  if (configLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
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
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md p-8 border rounded-lg shadow-lg bg-card text-center">
          <h1 className="text-3xl font-bold text-foreground mb-4">IPTV Viewer</h1>
          <div className="p-4 text-xl text-destructive-foreground bg-destructive/10 border border-destructive rounded-md">
            No authentication methods configured
          </div>
          <p className="mt-4 text-muted-foreground">
            Please contact the administrator to enable authentication.
          </p>
        </div>
      </div>
    )
  }

  const showLocalAuth = authConfig?.localAuthEnabled
  const showPlexAuth = authConfig?.plexAuthEnabled
  const showSeparator = showLocalAuth && showPlexAuth

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6 p-8 border rounded-lg shadow-lg bg-card">
        <h1 className="text-3xl font-bold text-center text-foreground">
          IPTV Viewer
        </h1>

        {error && (
          <div
            role="alert"
            className="p-4 text-xl text-destructive-foreground bg-destructive/10 border border-destructive rounded-md"
          >
            {error}
          </div>
        )}

        {/* Local Auth Form */}
        {showLocalAuth && (
          <form onSubmit={handleLocalSubmit} className="space-y-4">
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
                className="h-14 text-2xl px-4 focus:ring-2 focus:ring-offset-2"
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
                className="h-14 text-2xl px-4 focus:ring-2 focus:ring-offset-2"
              />
            </div>

            <Button
              type="submit"
              disabled={isLoading || plexLoading}
              className="h-14 text-2xl px-8 w-full focus:ring-2 focus:ring-offset-2"
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

        {/* Plex Auth Button */}
        {showPlexAuth && (
          <Button
            type="button"
            onClick={handlePlexLogin}
            disabled={isLoading || plexLoading}
            className="h-14 text-2xl px-8 w-full bg-[#E5A00D] hover:bg-[#CC8F0C] text-black focus:ring-2 focus:ring-offset-2"
          >
            {plexLoading ? 'Signing in...' : 'Sign in with Plex'}
          </Button>
        )}
      </div>
    </div>
  )
}
```

**Backend Config Update** (`backend/app/config.py`):
```python
class Settings(BaseSettings):
    # ... existing settings ...

    # Authentication Feature Flags
    local_auth_enabled: bool = False  # Feature flag for local auth
    plex_auth_enabled: bool = False   # Feature flag for Plex auth
```

Note: `local_auth_enabled` defaults to `False`. For backward compatibility, when migrating existing deployments, ensure `LOCAL_AUTH_ENABLED=true` is set if using local credentials.

### UI States Summary

| LOCAL_AUTH_ENABLED | PLEX_AUTH_ENABLED | Display |
|-------------------|-------------------|---------|
| false | false | Error: "No authentication methods configured" |
| true | false | Credential form only |
| false | true | "Sign in with Plex" button only |
| true | true | Credential form + "or" + Plex button |

### Dependencies

- Story 8.1 (Plex backend) for `/api/auth/plex` endpoint
- Story 8.2 (Plex OAuth) for `authenticateWithPlex` function
- Story 8.5 (Feature-flagged local auth) for `local_auth_enabled` config

### Project Structure Notes

Modified files:
- `frontend/src/components/LoginForm.tsx` (major rewrite)
- `backend/app/config.py` (add local_auth_enabled)
- `backend/app/routers/auth.py` (update /config endpoint)
- `frontend/src/components/LoginForm.test.tsx` (update tests)

### Testing Requirements

```typescript
import { render, screen, waitFor } from '@testing-library/react'
import { LoginForm } from './LoginForm'
import { vi } from 'vitest'
import * as api from '@/services/api'

vi.mock('@/services/api')

describe('LoginForm conditional rendering', () => {
  it('shows error when no auth methods configured', async () => {
    vi.mocked(api.getAuthConfig).mockResolvedValue({
      localAuthEnabled: false,
      plexAuthEnabled: false
    })

    render(<LoginForm />)

    await waitFor(() => {
      expect(screen.getByText('No authentication methods configured')).toBeInTheDocument()
    })
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
    expect(screen.queryByText('Sign in with Plex')).not.toBeInTheDocument()
  })

  it('shows only credential form when local auth enabled', async () => {
    vi.mocked(api.getAuthConfig).mockResolvedValue({
      localAuthEnabled: true,
      plexAuthEnabled: false
    })

    render(<LoginForm />)

    await waitFor(() => {
      expect(screen.getByLabelText('Username')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByText('Sign In')).toBeInTheDocument()
    expect(screen.queryByText('Sign in with Plex')).not.toBeInTheDocument()
    expect(screen.queryByText('or')).not.toBeInTheDocument()
  })

  it('shows only Plex button when Plex auth enabled', async () => {
    vi.mocked(api.getAuthConfig).mockResolvedValue({
      localAuthEnabled: false,
      plexAuthEnabled: true
    })

    render(<LoginForm />)

    await waitFor(() => {
      expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
    })
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.queryByText('or')).not.toBeInTheDocument()
  })

  it('shows both options with separator when both enabled', async () => {
    vi.mocked(api.getAuthConfig).mockResolvedValue({
      localAuthEnabled: true,
      plexAuthEnabled: true
    })

    render(<LoginForm />)

    await waitFor(() => {
      expect(screen.getByLabelText('Username')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByText('Sign In')).toBeInTheDocument()
    expect(screen.getByText('or')).toBeInTheDocument()
    expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
  })

  it('shows loading state while fetching config', () => {
    vi.mocked(api.getAuthConfig).mockImplementation(
      () => new Promise(() => {})  // Never resolves
    )

    render(<LoginForm />)

    // Check for loading skeleton
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
    expect(screen.queryByText('Sign in with Plex')).not.toBeInTheDocument()
  })
})
```

### References

- [Source: frontend/src/components/LoginForm.tsx] - Existing login form
- [Source: frontend/src/services/api.ts] - API service
- [Source: backend/app/routers/auth.py] - Auth endpoints
- [Source: backend/app/config.py] - Settings
- [Source: _bmad-output/project-context.md] - Project conventions

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

N/A - No debug issues encountered during implementation.

### Completion Notes List

- Task 1 was already implemented by Story 8-5 (feature-flagged local authentication). The backend config already had `local_auth_enabled`, the `/api/auth/config` endpoint already returned `localAuthEnabled`, and `/api/auth/token` already checked the flag.
- Task 2: Rewrote LoginForm component to properly handle conditional rendering based on auth config. Added loading state (skeleton UI) while fetching config, corrected conditional display logic for local auth (changed from `!== false` to `=== true`), and wrapped form in proper container structure.
- Task 3: Implemented "No authentication methods configured" error state with admin contact message, styled consistently with other error states using the app's destructive color scheme.
- Task 4: Verified that both local and Plex authentication use the same `setAuth` flow and redirect works correctly.
- Task 5: Added comprehensive tests for all acceptance criteria including: no auth configured error display, local only form display, Plex only button display, both methods with separator, loading state, and successful redirect tests. Fixed existing tests to handle async config loading.

### File List

- frontend/src/components/LoginForm.tsx (modified - major rewrite for conditional rendering)
- frontend/src/components/LoginForm.test.tsx (modified - added 7 new tests, fixed 6 existing tests)
- frontend/src/router.test.tsx (modified - fixed 2 tests to handle async config loading)
- frontend/src/App.test.tsx (modified - fixed 1 test to handle async config loading)
- backend/tests/test_config.py (modified - fixed 2 tests to use mocked environment)

### Change Log

- 2026-01-04: Implemented conditional login UI with loading state, no-auth error state, and proper conditional rendering of local/Plex auth options. Updated 21 frontend tests and 316 backend tests passing.
