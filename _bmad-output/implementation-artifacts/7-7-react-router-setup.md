# Story 7.7: React Router Setup

Status: review

## Story

As a user,
I want to navigate between live TV and ErsatzTV views,
so that I can access both features from the same app.

## Acceptance Criteria

1. **Authenticated users can access live TV**: Navigating to `/` shows the existing live TV MainView
2. **Authenticated users can access ErsatzTV**: Navigating to `/ersatztv` shows the ErsatzTV view
3. **Unauthenticated redirect**: Non-authenticated users are redirected to the login page for both routes
4. **Navigation link**: Live TV view includes a navigation link to `/ersatztv`

## Tasks / Subtasks

- [x] Task 1: Install and configure React Router (AC: #1, #2, #3)
  - [x] Install `react-router-dom` via npm
  - [x] Create `src/router.tsx` with route configuration
  - [x] Update `src/main.tsx` to wrap App with BrowserRouter
- [x] Task 2: Create protected route wrapper (AC: #3)
  - [x] Create `src/components/ProtectedRoute.tsx` component
  - [x] Use `useAuth` hook to check authentication state
  - [x] Redirect to login if not authenticated
- [x] Task 3: Configure application routes (AC: #1, #2)
  - [x] Update `src/App.tsx` to use Routes and Route components
  - [x] Set `/` route to render MainView (existing live TV)
  - [x] Set `/ersatztv` route to render placeholder ErsatzTVView
- [x] Task 4: Create ErsatzTV placeholder view (AC: #2)
  - [x] Create `src/components/ersatztv/ErsatzTVView.tsx` (placeholder for story 7-13)
  - [x] Export named function component following project conventions
- [x] Task 5: Add navigation link (AC: #4)
  - [x] Add ErsatzTV link to MainView header (hamburger menu for admin, or header)
  - [x] Use React Router `Link` or `useNavigate` hook
- [x] Task 6: Write tests
  - [x] Test route navigation to `/` shows MainView
  - [x] Test route navigation to `/ersatztv` shows ErsatzTVView
  - [x] Test unauthenticated users are redirected
  - [x] Test navigation links work correctly

## Dev Notes

### Architecture Compliance

- **Router file**: `src/router.tsx` - centralized route configuration
- **Protected routes**: All routes require authentication via ProtectedRoute wrapper
- **Component naming**: Named exports, PascalCase files (`ProtectedRoute.tsx`, `ErsatzTVView.tsx`)
- **Path alias**: Use `@/` for all imports

### Technical Implementation

**Install React Router:**
```bash
cd frontend && npm install react-router-dom
```

**Route configuration** (`src/router.tsx`):
```typescript
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { App } from '@/App'
import { MainView } from '@/components/MainView'
import { ErsatzTVView } from '@/components/ersatztv/ErsatzTVView'
import { ProtectedRoute } from '@/components/ProtectedRoute'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        index: true,
        element: <ProtectedRoute><MainView /></ProtectedRoute>,
      },
      {
        path: 'ersatztv',
        element: <ProtectedRoute><ErsatzTVView /></ProtectedRoute>,
      },
    ],
  },
])
```

**ProtectedRoute component** (`src/components/ProtectedRoute.tsx`):
```typescript
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

interface ProtectedRouteProps {
  children: React.ReactNode
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isInitializing } = useAuth()

  if (isInitializing) {
    return null // Or loading spinner
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
```

**App.tsx update** - integrate with Outlet pattern:
```typescript
import { Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { LoginForm } from '@/components/LoginForm'
import { Toaster } from '@/components/ui/sonner'

export function App() {
  const { isAuthenticated, isInitializing } = useAuth()

  if (isInitializing) {
    return <AppLoadingScreen />
  }

  if (!isAuthenticated) {
    return <LoginForm />
  }

  return (
    <>
      <Outlet />
      <Toaster />
    </>
  )
}
```

**ErsatzTV placeholder** (`src/components/ersatztv/ErsatzTVView.tsx`):
```typescript
export function ErsatzTVView() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <p className="text-muted-foreground">ErsatzTV View - Coming Soon</p>
    </div>
  )
}
```

### Navigation Integration

Add to MainView header (admin hamburger menu or header section):
```typescript
import { Link } from 'react-router-dom'

// In header/menu:
<Link
  to="/ersatztv"
  className="block px-4 py-2 hover:bg-accent rounded"
>
  Movie Channels
</Link>
```

### Project Structure Notes

**New files:**
- `frontend/src/router.tsx`
- `frontend/src/components/ProtectedRoute.tsx`
- `frontend/src/components/ProtectedRoute.test.tsx`
- `frontend/src/components/ersatztv/ErsatzTVView.tsx`
- `frontend/src/components/ersatztv/ErsatzTVView.test.tsx`

**Modified files:**
- `frontend/src/main.tsx` - wrap with RouterProvider
- `frontend/src/App.tsx` - use Outlet pattern
- `frontend/src/components/MainView.tsx` - add navigation link
- `frontend/package.json` - add react-router-dom dependency

### Testing Requirements

```typescript
// src/components/ProtectedRoute.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ProtectedRoute } from './ProtectedRoute'

// Mock useAuth hook
vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}))

describe('ProtectedRoute', () => {
  it('redirects to login when not authenticated', () => {
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: false,
      isInitializing: false
    })

    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route
            path="/protected"
            element={<ProtectedRoute><div>Protected</div></ProtectedRoute>}
          />
        </Routes>
      </MemoryRouter>
    )

    expect(screen.getByText('Login Page')).toBeInTheDocument()
  })

  it('renders children when authenticated', () => {
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: true,
      isInitializing: false
    })

    render(
      <MemoryRouter>
        <ProtectedRoute><div>Protected Content</div></ProtectedRoute>
      </MemoryRouter>
    )

    expect(screen.getByText('Protected Content')).toBeInTheDocument()
  })
})
```

### Anti-Patterns to Avoid

- **DO NOT use default exports** - use named exports
- **DO NOT use inline routes in App.tsx** - create centralized router.tsx
- **DO NOT forget to wrap with BrowserRouter** in main.tsx
- **DO NOT create login route** - current login is handled in App, not a route

### References

- [Source: frontend/src/App.tsx] - Current auth handling pattern
- [Source: frontend/src/hooks/useAuth.ts] - Auth hook pattern
- [Source: frontend/src/components/MainView.tsx] - Current main view structure
- [Source: _bmad-output/project-context.md] - Component naming conventions

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None - implementation proceeded without issues

### Completion Notes List

- Installed react-router-dom v7.x via npm
- Created centralized router configuration in `src/router.tsx` using `createBrowserRouter`
- Updated `main.tsx` to use `RouterProvider` instead of direct App rendering
- Refactored `App.tsx` to use `Outlet` pattern for child route rendering
- Created `ProtectedRoute.tsx` component that redirects unauthenticated users to login
- Created placeholder `ErsatzTVView.tsx` component in `src/components/ersatztv/` directory
- Added "Movie Channels" navigation link with Film icon to MainView header (visible to all users)
- Wrote comprehensive tests for ProtectedRoute, ErsatzTVView, and router integration
- Updated existing App.test.tsx and MainView.test.tsx to work with router context
- All 338 tests pass, lint passes, build succeeds

### File List

**New files:**
- frontend/src/router.tsx
- frontend/src/router.test.tsx
- frontend/src/components/ProtectedRoute.tsx
- frontend/src/components/ProtectedRoute.test.tsx
- frontend/src/components/ersatztv/ErsatzTVView.tsx
- frontend/src/components/ersatztv/ErsatzTVView.test.tsx

**Modified files:**
- frontend/src/main.tsx
- frontend/src/App.tsx
- frontend/src/App.test.tsx
- frontend/src/components/MainView.tsx
- frontend/src/components/MainView.test.tsx
- frontend/package.json
- frontend/package-lock.json

## Change Log

| Date | Change Description |
|------|-------------------|
| 2026-01-03 | Implemented React Router setup with protected routes, navigation link, and comprehensive tests |
