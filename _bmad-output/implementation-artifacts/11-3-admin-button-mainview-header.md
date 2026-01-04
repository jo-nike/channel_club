# Story 11.3: Admin Button in MainView Header

Status: review

## Story

As an admin on Live TV,
I want an admin button replacing the hamburger menu,
So that I can access the admin modal.

## Acceptance Criteria

1. **Given** I am logged in as admin on Live TV, **when** the header renders, **then** I see an admin icon button (replacing the hamburger menu) **and** clicking it opens the admin modal
2. **Given** I am logged in as viewer, **when** the header renders, **then** I do NOT see the admin button

## Tasks / Subtasks

- [x] Task 1: Replace Menu icon with Settings icon (AC: #1, #2)
  - [x] Import `Settings` from `lucide-react`
  - [x] Replace `<Menu>` with `<Settings>` in header button
  - [x] Update aria-label to "Open admin panel"
  - [x] Keep existing `isAdmin &&` conditional

- [x] Task 2: Add admin modal state and component (AC: #1)
  - [x] Add state: `const [adminModalOpen, setAdminModalOpen] = useState(false)`
  - [x] Import AdminModal component
  - [x] Render `<AdminModal open={adminModalOpen} onOpenChange={setAdminModalOpen} view="live" />`

- [x] Task 3: Remove sidebar drawer code (AC: #1)
  - [x] Remove sidebar trigger ref: `sidebarTriggerRef`
  - [x] Remove `sidebarDrawerRef` and related focus trap
  - [x] Remove backdrop div (lines ~188-195)
  - [x] Remove drawer aside element (lines ~197-222)
  - [x] Remove mobile FAB button (lines ~226-238)
  - [x] Remove `useFocusTrap` import if no longer used

- [x] Task 4: Update button onClick handler (AC: #1)
  - [x] Change from `setSidebarOpen(true)` to `setAdminModalOpen(true)`
  - [x] Remove ref assignment in onClick

- [x] Task 5: Clean up unused imports (AC: #1)
  - [x] Remove `Menu` and `X` icons from lucide-react import
  - [x] Remove `useFocusTrap` hook if no longer used
  - [x] Remove unused UIStore references for sidebar

## Dev Notes

### Architecture Patterns

**Current Header Structure (lines 109-162):**
```tsx
<header className="flex justify-between items-center px-4 py-2 bg-background border-b">
  <div className="flex items-center gap-4">
    {/* Menu button - left side for admin */}
    {isAdmin && (
      <button
        ref={sidebarTriggerRef}
        onClick={(e) => {
          sidebarTriggerRef.current = e.currentTarget
          setSidebarOpen(true)
        }}
        className="h-8 w-8 flex items-center justify-center bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        aria-label="Open channel list"
      >
        <Menu className="h-4 w-4 shrink-0" />
      </button>
    )}
    <ConnectionStatus status={status} onReconnect={reconnect} />
    {/* ... rest of header */}
  </div>
</header>
```

**NEW Header Structure:**
```tsx
<header className="flex justify-between items-center px-4 py-2 bg-background border-b">
  <div className="flex items-center gap-4">
    {/* Admin button - left side for admin */}
    {isAdmin && (
      <button
        onClick={() => setAdminModalOpen(true)}
        className="h-8 w-8 flex items-center justify-center bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        aria-label="Open admin panel"
      >
        <Settings className="h-4 w-4 shrink-0" />
      </button>
    )}
    <ConnectionStatus status={status} onReconnect={reconnect} />
    {/* ... rest of header */}
  </div>
</header>

{/* Admin Modal - rendered outside header */}
{isAdmin && (
  <AdminModal
    open={adminModalOpen}
    onOpenChange={setAdminModalOpen}
    view="live"
  />
)}
```

### Code to Remove

**Lines to delete from MainView.tsx:**

1. **Refs (around lines 64-67):**
```tsx
// DELETE:
const sidebarTriggerRef = useRef<HTMLButtonElement | null>(null)
const sidebarDrawerRef = useRef<HTMLElement>(null)
```

2. **Focus trap (around lines 70-73):**
```tsx
// DELETE:
useFocusTrap(sidebarDrawerRef, {
  enabled: isSidebarOpen,
  restoreFocus: false,
})
```

3. **Sidebar state usage (line 31-32):**
```tsx
// DELETE:
const isSidebarOpen = useUIStore((s) => s.isSidebarOpen)
const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
```

4. **Escape handler modification (lines 88-98):**
```tsx
// MODIFY - remove sidebar handling:
const handleEscape = useCallback(() => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {})
  } else if (isTheaterMode) {
    setTheaterMode(false)
  }
  // REMOVE sidebar close logic
}, [isTheaterMode, setTheaterMode])
```

5. **Backdrop (lines ~188-195):**
```tsx
// DELETE entire backdrop div
```

6. **Drawer (lines ~197-223):**
```tsx
// DELETE entire aside element
```

7. **Mobile FAB (lines ~226-238):**
```tsx
// DELETE entire mobile FAB button
```

### Icon Change

**Import Change:**
```tsx
// FROM:
import { Menu, X, Film, RefreshCw } from 'lucide-react'

// TO:
import { Settings, Film, RefreshCw } from 'lucide-react'
```

### Viewer Experience

For viewers (non-admin), the header will look cleaner:
- No admin button visible
- Same layout otherwise
- `isAdmin &&` conditional prevents rendering

### Dependencies

**New Import:**
- AdminModal from `@/components/AdminModal`

**Removed Imports:**
- Menu, X from lucide-react
- useFocusTrap hook (if only used for sidebar)

### Project Structure Notes

- This modifies existing file `frontend/src/components/MainView.tsx`
- Significant code removal (sidebar drawer code)
- Simpler component with modal approach
- Less state management needed

### References

- [Source: frontend/src/components/MainView.tsx:64-67] - Refs to remove
- [Source: frontend/src/components/MainView.tsx:70-73] - Focus trap to remove
- [Source: frontend/src/components/MainView.tsx:112-124] - Current admin button
- [Source: frontend/src/components/MainView.tsx:184-223] - Sidebar overlay to remove
- [Source: frontend/src/components/MainView.tsx:226-238] - Mobile FAB to remove
- [Source: _bmad-output/project-planning-artifacts/sprint-change-proposal-2026-01-04-admin-modal.md#4.3] - Detailed change specification

### Previous Story Dependencies

- **Story 11.1** - AdminModal component must be created first
- **Story 11.2** - ChannelList integration (can be in parallel)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

- None required - straightforward implementation

### Completion Notes List

- ✅ Replaced Menu icon with Settings icon from lucide-react
- ✅ Updated aria-label from "Open channel list" to "Open admin panel"
- ✅ Added adminModalOpen state to manage modal visibility
- ✅ Imported and integrated AdminModal component with view="live" prop
- ✅ Removed sidebar drawer code (backdrop, aside element, refs, focus trap)
- ✅ Removed mobile FAB button for channel list
- ✅ Removed unused imports: Menu, X icons, useFocusTrap, useBreakpoint, ChannelList
- ✅ Removed unused UIStore references: isSidebarOpen, setSidebarOpen
- ✅ Updated escape key handler to only handle fullscreen and theater mode (removed sidebar handling)
- ✅ Updated tests in MainView.test.tsx to reflect new admin button behavior
- ✅ Updated tests in App.test.tsx for role-based rendering

### File List

- `frontend/src/components/MainView.tsx` - Modified: Replaced sidebar with admin modal
- `frontend/src/components/MainView.test.tsx` - Modified: Updated tests for admin button/modal
- `frontend/src/App.test.tsx` - Modified: Updated role-based rendering tests

### Change Log

- 2026-01-04: Implemented Story 11-3 - Admin button in MainView header
  - Replaced hamburger menu with Settings icon button
  - Integrated AdminModal component for admin functionality
  - Removed legacy sidebar drawer code
  - All 648 tests pass, lint passes
