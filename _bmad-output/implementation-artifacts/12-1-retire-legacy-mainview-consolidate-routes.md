# Story 12.1: Retire Legacy MainView & Consolidate Routes

Status: review

## Story

As a user,
I want the unified TV view to be the root route,
So that there's one consistent entry point to the application.

## Acceptance Criteria

1. **Given** the current route structure with `/` (old MainView) and `/tv` (unified view), **when** this story is complete, **then** the unified TV view is served at `/`

2. **Given** the unified TV view is at root, **when** this story is complete, **then** the `/tv` route redirects to `/` for backwards compatibility

3. **Given** legacy MainView exists, **when** this story is complete, **then** the old MainView component is removed

4. **Given** dead code from legacy views exists, **when** this story is complete, **then** all dead code from the legacy separate views is cleaned up

5. **Given** a user bookmarked `/tv`, **when** they visit that URL, **then** they are redirected to `/`

6. **Given** the admin modal, **when** opened from the unified view, **then** all tabs are available (Channels, Active Users, User Access, Plugins, Status)

## Tasks / Subtasks

- [x] Task 1: Update Router Configuration (AC: #1, #2, #5)
  - [x] Modify `frontend/src/router.tsx` to serve TVView at `/` (index route)
  - [x] Add redirect from `/tv` to `/` for backwards compatibility
  - [x] Keep `/ersatztv` redirect to `/` (already redirects to `/tv`)
  - [x] Remove InitialRouteRedirect component usage (inline Navigate)

- [x] Task 2: Remove Legacy MainView (AC: #3)
  - [x] Delete `frontend/src/components/MainView.tsx`
  - [x] Delete `frontend/src/components/MainView.test.tsx`
  - [x] Remove any imports of MainView from other files

- [x] Task 3: Update TVView for Root Route (AC: #1)
  - [x] Update `frontend/src/components/tv/TVView.tsx` setLastRoute to `/`
  - [x] Review and update any hardcoded route references within TVView

- [x] Task 4: Clean Up UI Store Route Tracking (AC: #4)
  - [x] Update `frontend/src/stores/uiStore.ts` lastRoute type to remove legacy values
  - [x] Change type from `'/' | '/ersatztv' | '/tv'` to just `'/'`
  - [x] Update any related getters/setters

- [x] Task 5: Evaluate ErsatzTVView for Removal (AC: #4)
  - [x] Analyze if `frontend/src/components/ersatztv/ErsatzTVView.tsx` is still needed
  - [x] If redundant with TVView, delete the component and its test file
  - [x] If keeping, ensure it redirects/integrates properly

- [x] Task 6: Clean Up InitialRouteRedirect (AC: #4)
  - [x] Evaluate if `InitialRouteRedirect.tsx` is still needed
  - [x] If not needed (direct TVView at `/`), delete the component
  - [x] If keeping, simplify to single purpose

- [x] Task 7: Update Test Files (AC: #1, #3, #4)
  - [x] Update `frontend/src/router.test.tsx` to reflect new route structure
  - [x] Update `frontend/src/App.test.tsx` if MainView references exist
  - [x] Remove or update any test mocks for deleted components
  - [x] Verify all tests pass with new routing

- [x] Task 8: Add Status Tab Placeholder to AdminModal (AC: #6)
  - [x] Add 'status' tab to AdminModal tab structure
  - [x] Add PlaceholderTab for Status: "System health monitoring coming soon"
  - [x] Prepare for Story 12.2 implementation

- [x] Task 9: Verify and Test Consolidated Routes
  - [x] Test authenticated user lands at `/` with TVView
  - [x] Test `/tv` redirects to `/`
  - [x] Test `/ersatztv` redirects to `/`
  - [x] Test admin modal opens with all tabs from unified view
  - [x] Test no broken links or references

## Dev Notes

### Current Route Structure (BEFORE)

```
/              → MainView (LEGACY - basic live TV)
/tv            → TVView (NEW - unified live + on-demand)
/ersatztv      → Redirect to /tv
/login         → LoginForm
```

### Target Route Structure (AFTER)

```
/              → TVView (unified live + on-demand)
/tv            → Redirect to / (backwards compatibility)
/ersatztv      → Redirect to / (backwards compatibility)
/login         → LoginForm
```

### Files to DELETE

| File | Reason |
|------|--------|
| `frontend/src/components/MainView.tsx` | Legacy view replaced by TVView |
| `frontend/src/components/MainView.test.tsx` | Tests for deleted component |
| `frontend/src/components/InitialRouteRedirect.tsx` | No longer needed with direct TVView at root |

### Files to MODIFY

| File | Changes |
|------|---------|
| `frontend/src/router.tsx` | Serve TVView at `/`, add `/tv` redirect |
| `frontend/src/components/tv/TVView.tsx` | Update setLastRoute to `/` |
| `frontend/src/stores/uiStore.ts` | Simplify lastRoute type |
| `frontend/src/components/AdminModal.tsx` | Add Status tab |
| `frontend/src/router.test.tsx` | Update route tests |
| `frontend/src/App.test.tsx` | Remove MainView references if any |

### Router Implementation

**Current router.tsx:**
```tsx
export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        index: true,
        element: (
          <ProtectedRoute>
            <InitialRouteRedirect />
          </ProtectedRoute>
        ),
      },
      {
        path: 'tv',
        element: (
          <ProtectedRoute>
            <TVView />
          </ProtectedRoute>
        ),
      },
      {
        path: 'ersatztv',
        element: <Navigate to="/tv" replace />,
      },
    ],
  },
])
```

**Target router.tsx:**
```tsx
export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        index: true,
        element: (
          <ProtectedRoute>
            <TVView />
          </ProtectedRoute>
        ),
      },
      {
        path: 'tv',
        element: <Navigate to="/" replace />,
      },
      {
        path: 'ersatztv',
        element: <Navigate to="/" replace />,
      },
    ],
  },
])
```

### UI Store Update

**Current uiStore.ts lastRoute type:**
```tsx
lastRoute: '/' | '/ersatztv' | '/tv'
```

**Target:**
```tsx
lastRoute: '/'  // Only one route now
```

Consider if `lastRoute` is even needed anymore since there's only one view. May be able to remove entirely.

### AdminModal Status Tab Addition

Add to the tabs array in `AdminModal.tsx`:
```tsx
type TabType = 'channels' | 'active-users' | 'user-access' | 'plugins' | 'status'

const tabs: { id: TabType; label: string }[] = [
  { id: 'channels', label: 'Channels' },
  { id: 'active-users', label: 'Active Users' },
  { id: 'user-access', label: 'User Access' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'status', label: 'Status' },  // NEW
]

// In renderTabContent:
case 'status':
  return (
    <PlaceholderTab
      title="Status"
      message="System health monitoring coming soon"
      description="Monitor ErsatzTV and Dispatcharr service health, active streams, and resource usage."
    />
  )
```

### ErsatzTVView Analysis

The `ErsatzTVView.tsx` (436 lines) is potentially redundant since `TVView.tsx` (473 lines) now handles both live and on-demand channels in a unified interface.

**Decision Criteria:**
- If TVView fully replaces ErsatzTVView functionality → DELETE
- If ErsatzTVView has unique features not in TVView → KEEP and integrate

**TVView Unified Features:**
- ✅ Dual-mode video player (HLS + live stream)
- ✅ Unified channel sidebar with live + ersatztv channels
- ✅ EPG grid for all channels
- ✅ Programme details modal
- ✅ Presence tracking with view type
- ✅ Responsive layouts

**Recommendation:** ErsatzTVView can be safely deleted as TVView supersedes it.

### Project Structure Notes

- All routes consolidate to single TVView component at `/`
- Backwards compatibility via redirects from `/tv` and `/ersatztv`
- Admin modal gains Status tab (placeholder for Story 12.2)
- No new dependencies required
- Follows existing naming conventions (PascalCase components)

### References

- [Source: frontend/src/router.tsx] - Current route configuration
- [Source: frontend/src/components/tv/TVView.tsx] - Unified view implementation
- [Source: frontend/src/components/MainView.tsx] - Legacy view to remove
- [Source: frontend/src/stores/uiStore.ts:lastRoute] - Route tracking state
- [Source: _bmad-output/project-context.md] - Project conventions

### Previous Epic Intelligence

**From Epic 11 (Admin Modal):**
- AdminModal is context-agnostic - all tabs visible from any view
- PlaceholderTab component exists and can be reused for Status tab
- Tab structure uses `TabType` union type
- All tests pass with 690+ frontend tests

**Recent Git Activity:**
- `6e1279d` - united view fixes (TVView improvements)
- `9e3d290` - epg fixes
- `975df35` - hls retry + plex auth fix
- TVView is actively developed and stable

### Testing Checklist

- [x] `npm run build` succeeds (no dead imports)
- [x] `npm run test` passes (updated tests) - 663 tests pass
- [ ] Navigate to `/` shows TVView (manual test)
- [ ] Navigate to `/tv` redirects to `/` (manual test)
- [ ] Navigate to `/ersatztv` redirects to `/` (manual test)
- [ ] Admin modal opens from header (manual test)
- [ ] All 5 tabs visible in admin modal (including new Status) (manual test)
- [ ] No console errors about missing routes/components (manual test)
- [ ] WebSocket connection works from root route (manual test)
- [ ] Channel switching works (live + ersatztv) (manual test)

### Potential Risks

1. **Broken Bookmarks** - Mitigated by redirects
2. **Test Failures** - Update tests before running suite
3. **Import Errors** - Run build to catch missing imports
4. **WebSocket Route Tracking** - Verify presence tracking uses correct route

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None required - implementation was straightforward.

### Completion Notes List

- Consolidated all routes to serve TVView at `/` (root path)
- Added backwards-compatible redirects from `/tv` and `/ersatztv` to `/`
- Deleted legacy components: MainView.tsx, MainView.test.tsx, ErsatzTVView.tsx, ErsatzTVView.test.tsx, InitialRouteRedirect.tsx
- Updated uiStore.ts to simplify lastRoute type from union to single value
- Updated TVView.tsx to set lastRoute to '/' instead of '/tv'
- Added Status tab placeholder to AdminModal (5 tabs total now)
- Updated all test files: router.test.tsx, App.test.tsx, AdminModal.test.tsx
- All 663 frontend tests pass
- Build succeeds with no errors

### File List

**Deleted Files:**
- frontend/src/components/MainView.tsx
- frontend/src/components/MainView.test.tsx
- frontend/src/components/ersatztv/ErsatzTVView.tsx
- frontend/src/components/ersatztv/ErsatzTVView.test.tsx
- frontend/src/components/InitialRouteRedirect.tsx

**Modified Files:**
- frontend/src/router.tsx
- frontend/src/components/tv/TVView.tsx
- frontend/src/stores/uiStore.ts
- frontend/src/components/AdminModal.tsx
- frontend/src/router.test.tsx
- frontend/src/App.test.tsx
- frontend/src/components/AdminModal.test.tsx

## Change Log

- 2026-01-04: Story 12.1 implemented - Retired legacy MainView, consolidated routes to single TVView at root, added Status tab placeholder to AdminModal

