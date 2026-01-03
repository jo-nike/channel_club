# Story 6.4: Viewer Role - Remove Channel List

Status: ready-for-dev

## Story

As a viewer,
I want a distraction-free viewing experience,
so that I can focus on the video content.

## Acceptance Criteria

1. **No channel list for viewers**: Viewer role does NOT see channel list or hamburger menu
2. **Full-width video**: Video player takes full width (minus header) for viewers
3. **No channel selection access**: Viewers cannot access channel selection in any way
4. **All breakpoints**: Channel list hidden on ALL screen sizes for viewers (mobile/tablet/desktop)
5. **Admin unaffected**: Admin role still has full channel access (handled in Story 6-5)

## Tasks / Subtasks

- [ ] Task 1: Hide desktop sidebar for viewers (AC: #1, #2, #4)
  - [ ] Wrap desktop sidebar (`isDesktop && ...`) with `isAdmin` check
- [ ] Task 2: Hide mobile/tablet sidebar for viewers (AC: #1, #3, #4)
  - [ ] Wrap mobile/tablet sidebar overlay with `isAdmin` check
  - [ ] Hide hamburger menu button for viewers
  - [ ] Hide mobile FAB button for viewers
- [ ] Task 3: Verify video full-width (AC: #2)
  - [ ] Ensure video player container takes full width when sidebar hidden
- [ ] Task 4: Update tests (AC: #1-5)
  - [ ] Add tests for viewer role seeing no channel list
  - [ ] Add tests for admin role still having access

## Dev Notes

### Architecture Compliance

- **Auth access**: Use existing `useAuth()` hook which provides `isAdmin`
- **Component modification**: MainView.tsx only

### Technical Implementation

**Current MainView.tsx structure**:
```tsx
const { isAdmin, logout } = useAuth()
```

The `isAdmin` variable already exists. Need to add conditional rendering.

**Changes to make**:

1. **Desktop sidebar** (lines 133-144): Add `isAdmin &&`
```tsx
{/* Desktop Sidebar - only for admin */}
{!isTheaterMode && isDesktop && isAdmin && (
  <aside className="w-80 border-l bg-background flex flex-col shrink-0">
    ...
  </aside>
)}
```

2. **Menu button in header** (lines 91-103): Add `isAdmin &&`
```tsx
{/* Menu button - visible on tablet and mobile for admin only */}
{!isDesktop && isAdmin && (
  <button ... >
    <Menu className="h-6 w-6" />
  </button>
)}
```

3. **Mobile/tablet sidebar overlay** (lines 148-188): Wrap entire block with `isAdmin &&`
```tsx
{/* Mobile/Tablet Sidebar Overlay - admin only */}
{!isTheaterMode && !isDesktop && isAdmin && (
  <>
    {/* Backdrop */}
    ...
    {/* Drawer */}
    ...
  </>
)}
```

4. **Mobile FAB** (lines 191-203): Add `isAdmin &&`
```tsx
{/* Mobile FAB - admin only */}
{!isTheaterMode && isMobile && !isSidebarOpen && isAdmin && (
  <button ... >
    <Menu className="h-6 w-6" />
  </button>
)}
```

### Video Full-Width

The video container already takes `flex-1` which means it will expand to fill available space. When sidebar is hidden, it automatically takes full width. No additional changes needed.

### Viewer Experience

After changes, viewers will see:
- Header with title, current channel name, connection status, logout button
- Full-width video player
- No hamburger menu, no sidebar, no FAB

### Key Considerations

1. **isAdmin already available**: No need to add new imports
2. **Sidebar state cleanup**: If viewer somehow has `isSidebarOpen: true` in store (from previous admin session), it won't matter since the sidebar isn't rendered
3. **Theater mode**: Viewers can still use theater mode (full-screen video experience)

### Project Structure Notes

Modified files:
- `frontend/src/components/MainView.tsx` - Add role-based conditional rendering

No new files needed.

### Testing Requirements

Mock auth state in MainView tests:
```tsx
// Test viewer sees no channel controls
vi.mocked(useAuth).mockReturnValue({
  isAdmin: false,
  isAuthenticated: true,
  logout: vi.fn(),
  ...
})
// Assert no Menu button, no sidebar, no FAB

// Test admin sees channel controls
vi.mocked(useAuth).mockReturnValue({
  isAdmin: true,
  ...
})
// Assert Menu button present, sidebar present
```

### References

- [Source: frontend/src/components/MainView.tsx#16] - `isAdmin` from useAuth
- [Source: frontend/src/components/MainView.tsx#133-144] - Desktop sidebar
- [Source: frontend/src/components/MainView.tsx#148-188] - Mobile sidebar
- [Source: frontend/src/components/MainView.tsx#191-203] - Mobile FAB
- [Source: frontend/src/hooks/useAuth.ts] - Auth hook providing isAdmin

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
