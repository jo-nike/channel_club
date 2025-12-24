# Story 1.4: Protected Routes & Role-Based Access

Status: review

## Story

As the system,
I want to enforce authentication and role-based access,
So that only authorized users access appropriate features.

## Acceptance Criteria

1. **Given** I have a valid JWT stored in localStorage
   **When** I visit the app
   **Then** I bypass the login form and see the main view

2. **Given** I am logged in as admin
   **When** the app renders
   **Then** I can see admin controls (channel selection area - placeholder for now)

3. **Given** I am logged in as viewer
   **When** the app renders
   **Then** I see the video player area but NOT admin channel controls

4. **Given** my JWT is expired or invalid
   **When** I make an API request
   **Then** I am redirected to the login form
   **And** localStorage is cleared

5. **Given** I click a logout button
   **When** the action completes
   **Then** I am redirected to the login form
   **And** localStorage is cleared

## Tasks / Subtasks

- [x] Task 1: Create useAuth Hook (AC: #1, #4)
  - [x] Create frontend/src/hooks/useAuth.ts
  - [x] Wrap authStore with additional logic
  - [x] Implement token validation check (decode JWT, check expiration)
  - [x] Implement checkAuth function to validate on API errors
  - [x] Auto-logout if token is expired

- [x] Task 2: Create API Request Interceptor (AC: #4)
  - [x] Modify frontend/src/services/api.ts
  - [x] Create fetchWithAuth helper that adds Authorization header
  - [x] Handle 401 responses by calling logout
  - [x] Export for use by all authenticated API calls

- [x] Task 3: Create Role-Based UI Components (AC: #2, #3)
  - [x] Create frontend/src/components/AdminControls.tsx (placeholder)
  - [x] Create frontend/src/components/MainView.tsx
  - [x] Conditionally render AdminControls based on role
  - [x] Add placeholder video player area for viewers

- [x] Task 4: Implement Logout Functionality (AC: #5)
  - [x] Add logout button to main view header
  - [x] Wire up to authStore.logout()
  - [x] Ensure localStorage is cleared
  - [x] Return to login form

- [x] Task 5: Update App.tsx with Complete Auth Flow (AC: #1, #2, #3)
  - [x] Initialize auth state from localStorage on mount
  - [x] Validate token expiration on mount
  - [x] Route to LoginForm or MainView based on auth state
  - [x] Pass role to MainView for conditional rendering

## Dev Notes

### Architecture Compliance

**Auth Flow:**
1. App mounts → check localStorage for token
2. If token exists → validate expiration (decode JWT client-side)
3. If valid → show main app with role-appropriate content
4. If invalid/expired → clear localStorage, show login

**Role-Based Access:**
- `admin`: Sees channel list + selection controls + video player
- `viewer`: Sees video player only (channel controlled by admin)

### useAuth Hook Implementation

```typescript
// frontend/src/hooks/useAuth.ts
import { useEffect } from 'react'
import { useAuthStore } from '@/stores/authStore'

export function useAuth() {
  const { token, role, isAuthenticated, logout, initialize } = useAuthStore()

  useEffect(() => {
    initialize()
  }, [initialize])

  // Check if token is expired (client-side validation)
  useEffect(() => {
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]))
        const exp = payload.exp * 1000 // Convert to milliseconds
        if (Date.now() >= exp) {
          logout()
        }
      } catch {
        logout()
      }
    }
  }, [token, logout])

  return {
    token,
    role,
    isAuthenticated,
    isAdmin: role === 'admin',
    isViewer: role === 'viewer',
    logout,
  }
}
```

### fetchWithAuth Helper

```typescript
// frontend/src/services/api.ts (add to existing)
import { useAuthStore } from '@/stores/authStore'

const API_URL = import.meta.env.VITE_API_URL

export async function fetchWithAuth(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = localStorage.getItem('token')

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      ...options.headers,
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  })

  // Handle 401 - unauthorized
  if (response.status === 401) {
    // Clear auth state and redirect to login
    useAuthStore.getState().logout()
    throw new Error('Session expired')
  }

  return response
}

// Example usage for future API calls:
export async function fetchChannels(): Promise<Channel[]> {
  const response = await fetchWithAuth('/channels')
  if (!response.ok) {
    throw new Error('Failed to fetch channels')
  }
  return response.json()
}
```

### MainView Component

```typescript
// frontend/src/components/MainView.tsx
import { useAuth } from '@/hooks/useAuth'
import { AdminControls } from '@/components/AdminControls'
import { Button } from '@/components/ui/button'

export function MainView() {
  const { isAdmin, logout } = useAuth()

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="flex justify-between items-center p-4 bg-background border-b">
        <h1 className="text-2xl font-bold">IPTV Viewer</h1>
        <Button
          variant="outline"
          onClick={logout}
          className="h-12 text-lg focus:ring-2"
        >
          Logout
        </Button>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex">
        {/* Video Player Area */}
        <div className="flex-1 bg-black flex items-center justify-center">
          <p className="text-white text-xl">Video Player (Coming in Epic 2)</p>
        </div>

        {/* Admin Controls - Only visible to admins */}
        {isAdmin && (
          <aside className="w-80 border-l bg-background">
            <AdminControls />
          </aside>
        )}
      </main>
    </div>
  )
}
```

### AdminControls Placeholder

```typescript
// frontend/src/components/AdminControls.tsx
export function AdminControls() {
  return (
    <div className="p-4">
      <h2 className="text-xl font-semibold mb-4">Channel Selection</h2>
      <p className="text-muted-foreground">
        Channel list will be implemented in Epic 2
      </p>
    </div>
  )
}
```

### Updated App.tsx

```typescript
// frontend/src/App.tsx
import { useAuth } from '@/hooks/useAuth'
import { LoginForm } from '@/components/LoginForm'
import { MainView } from '@/components/MainView'

export function App() {
  const { isAuthenticated } = useAuth()

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <LoginForm />
      </div>
    )
  }

  return <MainView />
}
```

### Project Structure Notes

Files to create:
- `frontend/src/hooks/useAuth.ts` - NEW
- `frontend/src/components/MainView.tsx` - NEW
- `frontend/src/components/AdminControls.tsx` - NEW

Files to modify:
- `frontend/src/services/api.ts` - ADD fetchWithAuth helper
- `frontend/src/App.tsx` - REPLACE with auth-aware version

### 10-Foot UI Considerations

All new components must follow 10-foot UI rules:
- Logout button: min 44px height, visible focus state
- Text: min 24px for readability
- Focus states: 3px ring for keyboard navigation

### Testing Scenarios

1. **Fresh visit (no token):** Should see login form
2. **Valid token in localStorage:** Should see main view immediately
3. **Expired token:** Should be redirected to login, localStorage cleared
4. **Admin role:** Should see AdminControls sidebar
5. **Viewer role:** Should NOT see AdminControls sidebar
6. **Logout click:** Should clear localStorage and show login form
7. **API returns 401:** Should trigger logout and redirect

### Anti-Patterns to Avoid

- ❌ Do NOT check auth in every component - centralize in useAuth hook
- ❌ Do NOT store sensitive data beyond token/role in localStorage
- ❌ Do NOT make API calls without using fetchWithAuth
- ❌ Do NOT use inline styles - use Tailwind classes
- ❌ Do NOT forget focus states on interactive elements

### Dependencies on Previous Stories

- Story 1-1: Project scaffolding must be complete
- Story 1-2: Backend auth endpoint must be implemented
- Story 1-3: authStore and LoginForm must be implemented

### References

- [Source: _bmad-output/architecture.md#Frontend-Architecture]
- [Source: _bmad-output/architecture.md#Component-Boundaries]
- [Source: _bmad-output/prd.md#FR1-5-Authentication]
- [Source: _bmad-output/project-context.md#TypeScript/React-Rules]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

N/A - Clean implementation with no blocking issues

### Completion Notes List

- Implemented useAuth hook with JWT token validation and auto-logout on expiration
- Created fetchWithAuth API interceptor that handles 401 responses and triggers logout
- Built MainView component with role-based rendering (admin sees AdminControls, viewer does not)
- AdminControls component created as placeholder for future Epic 2 channel selection
- Updated App.tsx to use useAuth hook for authentication flow
- All 55 tests pass (9 new tests for useAuth, 5 new tests for fetchWithAuth, 12 new tests for MainView/AdminControls, 8 new tests for App)
- 10-foot UI compliance: logout button has h-12 (48px) height and visible focus states

### File List

**New Files:**
- frontend/src/hooks/useAuth.ts
- frontend/src/hooks/useAuth.test.ts
- frontend/src/components/MainView.tsx
- frontend/src/components/MainView.test.tsx
- frontend/src/components/AdminControls.test.tsx
- frontend/src/App.test.tsx

**Modified Files:**
- frontend/src/services/api.ts (added fetchWithAuth helper)
- frontend/src/services/api.test.ts (added fetchWithAuth tests)
- frontend/src/components/AdminControls.tsx (replaced placeholder with actual component)
- frontend/src/App.tsx (replaced with useAuth-based auth flow)

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2025-12-23 | Implemented protected routes and role-based access control (Story 1.4) | Claude Opus 4.5 |

