# Story 11.3: Admin Button in MainView Header

Status: ready-for-dev

## Story

As an admin on Live TV,
I want an admin button replacing the hamburger menu,
So that I can access the admin modal.

## Acceptance Criteria

1. **Given** I am logged in as admin on Live TV, **when** the header renders, **then** I see an admin icon button (replacing the hamburger menu) **and** clicking it opens the admin modal
2. **Given** I am logged in as viewer, **when** the header renders, **then** I do NOT see the admin button

## Tasks / Subtasks

- [ ] Task 1: Replace Menu icon with Settings icon (AC: #1, #2)
  - [ ] Import `Settings` from `lucide-react`
  - [ ] Replace `<Menu>` with `<Settings>` in header button
  - [ ] Update aria-label to "Open admin panel"
  - [ ] Keep existing `isAdmin &&` conditional

- [ ] Task 2: Add admin modal state and component (AC: #1)
  - [ ] Add state: `const [adminModalOpen, setAdminModalOpen] = useState(false)`
  - [ ] Import AdminModal component
  - [ ] Render `<AdminModal open={adminModalOpen} onOpenChange={setAdminModalOpen} view="live" />`

- [ ] Task 3: Remove sidebar drawer code (AC: #1)
  - [ ] Remove sidebar trigger ref: `sidebarTriggerRef`
  - [ ] Remove `sidebarDrawerRef` and related focus trap
  - [ ] Remove backdrop div (lines ~188-195)
  - [ ] Remove drawer aside element (lines ~197-222)
  - [ ] Remove mobile FAB button (lines ~226-238)
  - [ ] Remove `useFocusTrap` import if no longer used

- [ ] Task 4: Update button onClick handler (AC: #1)
  - [ ] Change from `setSidebarOpen(true)` to `setAdminModalOpen(true)`
  - [ ] Remove ref assignment in onClick

- [ ] Task 5: Clean up unused imports (AC: #1)
  - [ ] Remove `Menu` and `X` icons from lucide-react import
  - [ ] Remove `useFocusTrap` hook if no longer used
  - [ ] Remove unused UIStore references for sidebar

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

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
