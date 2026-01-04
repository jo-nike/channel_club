# Story 8.2: Plex OAuth Token Acquisition

Status: review

## Story

As a user,
I want to click "Sign in with Plex" and authenticate via Plex popup,
so that I don't need to remember separate credentials.

## Acceptance Criteria

1. **Plex Button Visibility**: When `PLEX_AUTH_ENABLED=true`, login page shows "Sign in with Plex" button
2. **Popup Opens**: Clicking "Sign in with Plex" opens Plex's official authentication page in a popup
3. **Plex Auth Page**: User can enter their Plex credentials in the popup
4. **Success Flow**: On successful Plex authentication, popup closes and auth token is sent to `/api/auth/plex`
5. **Login Completion**: On backend success, user is logged in with appropriate role
6. **Cancel Handling**: If user cancels the Plex popup, they remain on login page with no error

## Tasks / Subtasks

- [x] Task 1: Create Plex OAuth utility (AC: #2, #3)
  - [x] Create `frontend/src/services/plexAuth.ts`
  - [x] Implement `openPlexAuthPopup()` - opens Plex auth URL
  - [x] Implement PIN-based auth flow using Plex pins API
  - [x] Handle popup message listener for auth completion
- [x] Task 2: Add Plex auth config endpoint (AC: #1)
  - [x] Add `GET /api/auth/config` endpoint to return enabled auth methods (completed in Story 8-1)
  - [x] Response: `{localAuthEnabled: boolean, plexAuthEnabled: boolean}`
  - [x] Frontend fetches config on app load to determine which auth methods to show
- [x] Task 3: Create Plex login button component (AC: #1, #2)
  - [x] Create `frontend/src/components/PlexLoginButton.tsx`
  - [x] Display Plex-branded button with Plex orange (#E5A00D) color
  - [x] Include Plex logo or icon
  - [x] Handle loading state during authentication
- [x] Task 4: Integrate Plex auth into LoginForm (AC: #1-6)
  - [x] Fetch auth config on mount
  - [x] Conditionally render PlexLoginButton based on config
  - [x] Handle Plex auth success - call `/api/auth/plex` and setAuth
  - [x] Handle Plex auth cancellation gracefully
- [x] Task 5: Add API service function (AC: #4, #5)
  - [x] Add `loginWithPlex(authToken: string)` to `frontend/src/services/api.ts`
  - [x] Returns same TokenResponse as regular login
- [x] Task 6: Write tests (AC: #1-6)
  - [x] Test PlexLoginButton renders correctly
  - [x] Test login form shows Plex button when enabled
  - [x] Test login form hides Plex button when disabled
  - [x] Test successful Plex auth flow

## Dev Notes

### Architecture Compliance

- **Component pattern**: Named exports, PascalCase files
- **API pattern**: Add to existing `services/api.ts`
- **State pattern**: Use existing `authStore` for auth state
- **Config pattern**: Fetch auth config from backend, store in component state

### Technical Implementation

**Plex OAuth Flow:**
Plex uses a PIN-based OAuth flow:
1. Request PIN from Plex: `POST https://plex.tv/api/v2/pins`
2. Open auth URL in popup: `https://app.plex.tv/auth#?clientID=...&code=...&context[device][product]=...`
3. Poll PIN status: `GET https://plex.tv/api/v2/pins/{id}` until `authToken` is set
4. Use `authToken` to authenticate with our backend

**Plex Auth Service** (`frontend/src/services/plexAuth.ts`):
```typescript
const PLEX_CLIENT_ID = 'iptv-viewer-2'
const PLEX_PRODUCT = 'IPTV Viewer'

interface PlexPin {
  id: number
  code: string
  authToken: string | null
}

export async function createPlexPin(): Promise<PlexPin> {
  const response = await fetch('https://plex.tv/api/v2/pins', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'X-Plex-Product': PLEX_PRODUCT,
      'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
    },
    body: new URLSearchParams({ strong: 'true' })
  })
  return response.json()
}

export function getPlexAuthUrl(pin: PlexPin): string {
  const params = new URLSearchParams({
    clientID: PLEX_CLIENT_ID,
    code: pin.code,
    'context[device][product]': PLEX_PRODUCT,
  })
  return `https://app.plex.tv/auth#?${params}`
}

export async function checkPlexPin(pinId: number): Promise<string | null> {
  const response = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
    headers: {
      'Accept': 'application/json',
      'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
    }
  })
  const data = await response.json()
  return data.authToken || null
}

export async function authenticateWithPlex(): Promise<string> {
  // 1. Create PIN
  const pin = await createPlexPin()

  // 2. Open popup
  const authUrl = getPlexAuthUrl(pin)
  const popup = window.open(authUrl, 'PlexAuth', 'width=600,height=700')

  if (!popup) {
    throw new Error('Failed to open Plex authentication popup')
  }

  // 3. Poll for auth token
  return new Promise((resolve, reject) => {
    const pollInterval = setInterval(async () => {
      // Check if popup was closed
      if (popup.closed) {
        clearInterval(pollInterval)
        reject(new Error('Authentication cancelled'))
        return
      }

      try {
        const authToken = await checkPlexPin(pin.id)
        if (authToken) {
          clearInterval(pollInterval)
          popup.close()
          resolve(authToken)
        }
      } catch {
        // Continue polling
      }
    }, 2000) // Poll every 2 seconds

    // Timeout after 5 minutes
    setTimeout(() => {
      clearInterval(pollInterval)
      popup.close()
      reject(new Error('Authentication timed out'))
    }, 5 * 60 * 1000)
  })
}
```

**Auth Config Endpoint** (`backend/app/routers/auth.py`):
```python
from pydantic import BaseModel

class AuthConfigResponse(BaseModel):
    local_auth_enabled: bool = Field(alias="localAuthEnabled")
    plex_auth_enabled: bool = Field(alias="plexAuthEnabled")

    class Config:
        populate_by_name = True

@router.get("/config", response_model=AuthConfigResponse)
async def get_auth_config() -> AuthConfigResponse:
    """Return available authentication methods."""
    return AuthConfigResponse(
        local_auth_enabled=settings.local_auth_enabled,
        plex_auth_enabled=settings.plex_auth_enabled
    )
```

**PlexLoginButton Component** (`frontend/src/components/PlexLoginButton.tsx`):
```typescript
import { Button } from '@/components/ui/button'

interface PlexLoginButtonProps {
  onClick: () => void
  isLoading: boolean
}

export function PlexLoginButton({ onClick, isLoading }: PlexLoginButtonProps) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={isLoading}
      className="h-14 text-2xl px-8 w-full bg-[#E5A00D] hover:bg-[#CC8F0C] text-black"
    >
      {isLoading ? 'Signing in...' : 'Sign in with Plex'}
    </Button>
  )
}
```

**Updated LoginForm** (integration snippet):
```typescript
import { PlexLoginButton } from '@/components/PlexLoginButton'
import { authenticateWithPlex } from '@/services/plexAuth'
import { getAuthConfig, loginWithPlex } from '@/services/api'

// In component:
const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null)
const [plexLoading, setPlexLoading] = useState(false)

useEffect(() => {
  getAuthConfig().then(setAuthConfig).catch(console.error)
}, [])

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

// In render, after credential form:
{authConfig?.plexAuthEnabled && (
  <>
    <div className="relative">
      <div className="absolute inset-0 flex items-center">
        <span className="w-full border-t" />
      </div>
      <div className="relative flex justify-center text-xs uppercase">
        <span className="bg-card px-2 text-muted-foreground">or</span>
      </div>
    </div>
    <PlexLoginButton onClick={handlePlexLogin} isLoading={plexLoading} />
  </>
)}
```

**API Service Addition** (`frontend/src/services/api.ts`):
```typescript
export interface AuthConfig {
  localAuthEnabled: boolean
  plexAuthEnabled: boolean
}

export async function getAuthConfig(): Promise<AuthConfig> {
  const response = await fetch(`${API_BASE}/auth/config`)
  if (!response.ok) throw new Error('Failed to get auth config')
  return response.json()
}

export async function loginWithPlex(authToken: string): Promise<TokenResponse> {
  const response = await fetch(`${API_BASE}/auth/plex`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authToken })
  })
  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.detail || 'Plex authentication failed')
  }
  return response.json()
}
```

### Dependencies

- Story 8.1 must be completed first (Plex backend service)

### Project Structure Notes

New/modified files:
- `frontend/src/services/plexAuth.ts` (new)
- `frontend/src/components/PlexLoginButton.tsx` (new)
- `frontend/src/components/LoginForm.tsx` (modify)
- `frontend/src/services/api.ts` (modify - add getAuthConfig, loginWithPlex)
- `backend/app/routers/auth.py` (modify - add /config endpoint)
- `frontend/src/components/PlexLoginButton.test.tsx` (new)

### Testing Requirements

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PlexLoginButton } from './PlexLoginButton'
import { LoginForm } from './LoginForm'

describe('PlexLoginButton', () => {
  it('renders with Plex branding', () => {
    render(<PlexLoginButton onClick={vi.fn()} isLoading={false} />)
    expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
  })

  it('shows loading state', () => {
    render(<PlexLoginButton onClick={vi.fn()} isLoading={true} />)
    expect(screen.getByText('Signing in...')).toBeInTheDocument()
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<PlexLoginButton onClick={onClick} isLoading={false} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalled()
  })
})

describe('LoginForm with Plex', () => {
  it('shows Plex button when enabled', async () => {
    vi.mocked(getAuthConfig).mockResolvedValue({
      localAuthEnabled: true,
      plexAuthEnabled: true
    })

    render(<LoginForm />)

    await waitFor(() => {
      expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
    })
  })

  it('hides Plex button when disabled', async () => {
    vi.mocked(getAuthConfig).mockResolvedValue({
      localAuthEnabled: true,
      plexAuthEnabled: false
    })

    render(<LoginForm />)

    await waitFor(() => {
      expect(screen.queryByText('Sign in with Plex')).not.toBeInTheDocument()
    })
  })
})
```

### References

- [Source: frontend/src/components/LoginForm.tsx] - Existing login form
- [Source: frontend/src/services/api.ts] - API service pattern
- [Source: frontend/src/stores/authStore.ts] - Auth state management
- [Plex OAuth Flow: https://github.com/Arcanemagus/plex-api/wiki/Plex-Web-API-Overview] - PIN-based auth
- [Source: _bmad-output/project-context.md] - Project conventions

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None - implementation proceeded without issues.

### Completion Notes List

- Implemented Plex OAuth PIN-based authentication flow in frontend
- Created `plexAuth.ts` service with `createPlexPin()`, `getPlexAuthUrl()`, `checkPlexPin()`, and `authenticateWithPlex()` functions
- Created `PlexLoginButton.tsx` component with Plex orange branding (#E5A00D)
- Added `getAuthConfig()` and `loginWithPlex()` to `api.ts` service
- Integrated Plex auth into `LoginForm.tsx` with conditional rendering based on auth config
- LoginForm now hides local auth fields when `localAuthEnabled=false` (Plex-only mode)
- Added "or" divider between local and Plex auth when both are enabled
- Plex auth cancellation (popup closed) is handled gracefully without showing error
- All 49 tests pass: plexAuth (6), PlexLoginButton (5), api (24), LoginForm (14)
- Backend `/api/auth/config` endpoint was already implemented in Story 8-1

### File List

**New Files:**
- frontend/src/services/plexAuth.ts
- frontend/src/services/plexAuth.test.ts
- frontend/src/components/PlexLoginButton.tsx
- frontend/src/components/PlexLoginButton.test.tsx

**Modified Files:**
- frontend/src/services/api.ts (added AuthConfig interface, getAuthConfig, loginWithPlex)
- frontend/src/services/api.test.ts (added tests for getAuthConfig, loginWithPlex)
- frontend/src/components/LoginForm.tsx (integrated Plex auth)
- frontend/src/components/LoginForm.test.tsx (added Plex auth tests)
- frontend/src/App.test.tsx (added getAuthConfig mock)
- frontend/src/router.test.tsx (added getAuthConfig mock)

### Change Log

- 2026-01-04: Implemented Plex OAuth Token Acquisition frontend (Story 8.2)
