# Story 1.3: Login UI & Auth State Management

Status: review

## Story

As a user,
I want a login form to enter my credentials,
So that I can access the app from any device.

## Acceptance Criteria

1. **Given** I am not logged in
   **When** I visit the app
   **Then** I see a login form with username and password fields

2. **Given** I enter valid credentials and submit
   **When** the login succeeds
   **Then** the JWT is stored in localStorage
   **And** I am redirected to the main app view
   **And** authStore contains token and role

3. **Given** I enter invalid credentials
   **When** I submit
   **Then** I see an error message "Invalid credentials"
   **And** I remain on the login form

4. **Given** the login form is displayed
   **When** I view it on mobile or TV
   **Then** the form is responsive with proper 10-foot UI sizing

5. **Given** I am on the login form
   **When** I press Tab or use D-pad
   **Then** focus moves logically between username, password, and submit button

## Tasks / Subtasks

- [x] Task 1: Create Auth Store with Zustand (AC: #2)
  - [x] Create frontend/src/stores/authStore.ts
  - [x] Define AuthState interface (token, role, isAuthenticated)
  - [x] Implement setAuth action (stores token in state AND localStorage)
  - [x] Implement logout action (clears state and localStorage)
  - [x] Implement initialize action (checks localStorage on app load)

- [x] Task 2: Create API Service Function (AC: #2, #3)
  - [x] Create frontend/src/services/api.ts
  - [x] Implement login function that POSTs to /api/auth/token
  - [x] Handle success response (return token and role)
  - [x] Handle error response (throw with message)

- [x] Task 3: Create TypeScript Types (AC: #2)
  - [x] Create frontend/src/types/index.ts
  - [x] Define AuthState type
  - [x] Define LoginRequest type
  - [x] Define TokenResponse type
  - [x] Define Channel type (for future use)

- [x] Task 4: Create LoginForm Component (AC: #1, #3, #4, #5)
  - [x] Create frontend/src/components/LoginForm.tsx
  - [x] Use shadcn/ui Input and Button components
  - [x] Implement form state with useState
  - [x] Show loading state during submission
  - [x] Display error message on failure
  - [x] Apply 10-foot UI styling (min 24px text, 44px touch targets)
  - [x] Ensure keyboard navigation works (Tab through fields)

- [x] Task 5: Integrate with App.tsx (AC: #1, #2)
  - [x] Modify App.tsx to check authStore.isAuthenticated
  - [x] Show LoginForm if not authenticated
  - [x] Show main app content if authenticated
  - [x] Call authStore.initialize on mount to check localStorage

## Dev Notes

### Architecture Compliance

**State Management:** Zustand with hook pattern
**Token Storage:** localStorage (persists across sessions)
**Component Pattern:** Named exports only

### Auth Store Implementation

```typescript
// frontend/src/stores/authStore.ts
import { create } from 'zustand'

interface AuthState {
  token: string | null
  role: 'admin' | 'viewer' | null
  isAuthenticated: boolean
  setAuth: (token: string, role: 'admin' | 'viewer') => void
  logout: () => void
  initialize: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  role: null,
  isAuthenticated: false,

  setAuth: (token, role) => {
    localStorage.setItem('token', token)
    localStorage.setItem('role', role)
    set({ token, role, isAuthenticated: true })
  },

  logout: () => {
    localStorage.removeItem('token')
    localStorage.removeItem('role')
    set({ token: null, role: null, isAuthenticated: false })
  },

  initialize: () => {
    const token = localStorage.getItem('token')
    const role = localStorage.getItem('role') as 'admin' | 'viewer' | null
    if (token && role) {
      set({ token, role, isAuthenticated: true })
    }
  },
}))
```

### API Service Implementation

```typescript
// frontend/src/services/api.ts
const API_URL = import.meta.env.VITE_API_URL

interface LoginRequest {
  username: string
  password: string
}

interface TokenResponse {
  accessToken: string
  tokenType: string
  role: 'admin' | 'viewer'
}

export async function login(credentials: LoginRequest): Promise<TokenResponse> {
  const response = await fetch(`${API_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail || 'Login failed')
  }

  return response.json()
}
```

### LoginForm Component Structure

```typescript
// frontend/src/components/LoginForm.tsx
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/authStore'
import { login } from '@/services/api'

export function LoginForm() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const setAuth = useAuthStore((state) => state.setAuth)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const response = await login({ username, password })
      setAuth(response.accessToken, response.role)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-md mx-auto p-8">
      {/* Form content with 10-foot UI styling */}
    </form>
  )
}
```

### 10-Foot UI Styling Requirements

```css
/* Apply to login form elements */
.login-form input {
  min-height: 56px;        /* 44px minimum + padding */
  font-size: 24px;         /* Readable from 10 feet */
  padding: 16px;
}

.login-form button {
  min-height: 56px;
  font-size: 24px;
  min-width: 200px;
}

/* Focus states for D-pad navigation */
.login-form input:focus,
.login-form button:focus {
  outline: 3px solid hsl(var(--ring));
  outline-offset: 2px;
}
```

**Tailwind Classes:**
```tsx
<Input
  className="h-14 text-2xl px-4 focus:ring-2 focus:ring-offset-2"
  // ...
/>
<Button
  className="h-14 text-2xl px-8 w-full focus:ring-2 focus:ring-offset-2"
  // ...
/>
```

### App.tsx Integration

```typescript
// frontend/src/App.tsx
import { useEffect } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { LoginForm } from '@/components/LoginForm'

export function App() {
  const { isAuthenticated, initialize } = useAuthStore()

  useEffect(() => {
    initialize()
  }, [initialize])

  if (!isAuthenticated) {
    return <LoginForm />
  }

  return (
    <main>
      {/* Main app content - placeholder for now */}
      <p>Logged in!</p>
    </main>
  )
}
```

### shadcn/ui Components Required

Run these commands to add required shadcn components:
```bash
npx shadcn@latest add button
npx shadcn@latest add input
npx shadcn@latest add card  # Optional, for form container
```

### Project Structure Notes

Files to create:
- `frontend/src/stores/authStore.ts` - NEW
- `frontend/src/services/api.ts` - NEW
- `frontend/src/types/index.ts` - NEW
- `frontend/src/components/LoginForm.tsx` - NEW
- `frontend/src/App.tsx` - MODIFY

### Naming Conventions

- React components: PascalCase with named exports
- Zustand stores: camelCase with `use` prefix (useAuthStore)
- Service functions: camelCase (login, fetchChannels)
- Types/Interfaces: PascalCase (AuthState, TokenResponse)

### Anti-Patterns to Avoid

- ❌ Do NOT use `export default` - use named exports
- ❌ Do NOT put async logic directly in components (use services)
- ❌ Do NOT hardcode API URLs - use VITE_API_URL env var
- ❌ Do NOT ignore TypeScript errors with `// @ts-ignore`
- ❌ Do NOT use `any` type - define proper interfaces

### Keyboard Navigation

Ensure Tab order is logical:
1. Username field
2. Password field
3. Submit button

All elements must have visible focus states (ring/outline).

### References

- [Source: _bmad-output/architecture.md#Frontend-Architecture]
- [Source: _bmad-output/architecture.md#Implementation-Patterns-&-Consistency-Rules]
- [Source: _bmad-output/prd.md#Authentication-&-Authorization]
- [Source: _bmad-output/project-context.md#TypeScript/React-Rules]
- [Source: _bmad-output/project-context.md#10-Foot-UI-Rules]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

- No blocking issues encountered during implementation

### Completion Notes List

- Implemented complete auth store with Zustand including setAuth, logout, and initialize actions
- Created login API service function with proper error handling for invalid credentials
- Added TypeScript types for AuthState, LoginRequest, TokenResponse, and Channel
- Built LoginForm component with shadcn/ui Button and Input components, 10-foot UI styling (h-14 / 56px height, text-2xl), loading states, and error display
- Updated App.tsx to use named export pattern, show LoginForm when unauthenticated, and initialize auth from localStorage on mount
- Added comprehensive test suite with 21 tests covering authStore, API service, and LoginForm component
- Configured Vitest test framework with jsdom environment and testing-library

### File List

**New Files:**
- frontend/src/components/ui/button.tsx
- frontend/src/components/ui/input.tsx
- frontend/src/components/ui/card.tsx
- frontend/src/test/setup.ts
- frontend/src/stores/authStore.test.ts
- frontend/src/services/api.test.ts
- frontend/src/components/LoginForm.test.tsx

**Modified Files:**
- frontend/src/stores/authStore.ts (expanded with full implementation)
- frontend/src/services/api.ts (added login function)
- frontend/src/types/index.ts (added AuthState, LoginRequest, TokenResponse)
- frontend/src/components/LoginForm.tsx (implemented component)
- frontend/src/App.tsx (auth integration)
- frontend/src/main.tsx (named import for App)
- frontend/vite.config.ts (added Vitest configuration)
- frontend/tsconfig.app.json (excluded test files)
- frontend/package.json (added test scripts, testing dependencies)

## Change Log

- 2025-12-23: Implemented Story 1.3 - Login UI & Auth State Management
  - Added auth store with Zustand for token, role, and authentication state management
  - Implemented login API service with error handling
  - Created LoginForm component with 10-foot UI styling and keyboard navigation
  - Integrated auth flow into App.tsx with conditional rendering
  - Added shadcn/ui Button, Input, and Card components
  - Set up Vitest testing framework with 21 passing tests
