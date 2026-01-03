# Story 6.5: Admin Role - Hamburger Menu

Status: review

## Story

As an admin,
I want channel selection via a hamburger menu,
so that the video has more screen space when not selecting channels.

## Acceptance Criteria

1. **Hamburger menu on ALL breakpoints**: Admin sees hamburger menu button in header on desktop/tablet/mobile (not just tablet/mobile)
2. **Full-width video by default**: Video player takes full width (minus header), channel list NOT pinned to side
3. **Slide-out drawer from right**: Clicking hamburger opens channel list as drawer from right side
4. **Channel selection closes drawer**: After selecting a channel, drawer closes automatically
5. **Close mechanisms**: Clicking outside drawer OR pressing Escape closes it

## Tasks / Subtasks

- [x] Task 1: Show hamburger on desktop for admin (AC: #1)
  - [x] Remove `!isDesktop &&` condition from menu button in header
  - [x] Menu button visible for admin on all breakpoints
- [x] Task 2: Remove desktop pinned sidebar (AC: #2)
  - [x] Remove the desktop sidebar section entirely (it's replaced by hamburger menu)
  - [x] Video player now takes full width on desktop too
- [x] Task 3: Update drawer for all breakpoints (AC: #3)
  - [x] Remove `!isDesktop &&` condition from mobile/tablet sidebar overlay
  - [x] Drawer now works on all breakpoints
  - [x] Adjust drawer width: full on mobile, 80-width (320px) on tablet/desktop
- [x] Task 4: Auto-close on channel selection (AC: #4)
  - [x] Modify ChannelList to close sidebar after channel selection
  - [x] Use uiStore.setSidebarOpen(false) in channel click handler
- [x] Task 5: Verify close mechanisms (AC: #5)
  - [x] Backdrop click already closes (existing)
  - [x] Escape key already closes (existing useEscapeKey)
- [x] Task 6: Update tests

## Dev Notes

### Architecture Compliance

- **Store usage**: Uses existing `useUIStore` for sidebar state
- **Component modification**: MainView.tsx and ChannelList.tsx

### Technical Implementation

**Current behavior to change**:
- Desktop: Pinned sidebar on right (need to remove)
- Tablet/Mobile: Hamburger menu with drawer (need to extend to desktop)

**Target behavior**:
- ALL breakpoints: Hamburger menu with drawer (unified experience)

### Changes to MainView.tsx

**1. Menu button** - Remove desktop exclusion:
```tsx
// Before:
{!isDesktop && isAdmin && (

// After:
{isAdmin && (
```

**2. Remove desktop sidebar section entirely** (lines 133-144):
```tsx
// DELETE THIS ENTIRE BLOCK:
{!isTheaterMode && isDesktop && isAdmin && (
  <aside className="w-80 border-l...">
    ...
  </aside>
)}
```

**3. Sidebar overlay** - Remove desktop exclusion:
```tsx
// Before:
{!isTheaterMode && !isDesktop && isAdmin && (

// After:
{!isTheaterMode && isAdmin && (
```

**4. Update drawer width for desktop**:
```tsx
<aside
  ...
  className={cn(
    'fixed inset-y-0 right-0 z-50 bg-background border-l flex flex-col',
    'transform transition-transform duration-300 ease-in-out',
    // Full width on mobile, fixed width on tablet and desktop
    isMobile ? 'w-full' : 'w-80',
    isSidebarOpen ? 'translate-x-0' : 'translate-x-full'
  )}
>
```

**5. Mobile FAB** - Keep mobile-only (good UX on small screens):
```tsx
// Keep as-is - FAB is a nice mobile enhancement
{!isTheaterMode && isMobile && !isSidebarOpen && isAdmin && (
```

### Changes to ChannelList.tsx

Add auto-close on channel selection:

```tsx
import { useUIStore } from '@/stores/uiStore'

// Inside component:
const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)

// In click handler for channel selection:
const handleChannelSelect = async (channel: Channel) => {
  await selectChannel(channel)
  setSidebarOpen(false)  // Auto-close drawer
}
```

### Key Considerations

1. **Desktop users get hamburger menu**: This is intentional per requirements - maximizes video space
2. **Keyboard navigation preserved**: Escape key handler already in place
3. **Focus trap preserved**: Focus trap already works on drawer
4. **Theater mode preserved**: In theater mode, no UI shown (existing behavior)

### Dependency: Story 6-4

Story 6-4 adds `isAdmin &&` checks. This story modifies the same conditions. These stories should be implemented together or 6-4 first.

When both are done:
- Viewer: No channel access at all
- Admin: Hamburger menu on all breakpoints

### Project Structure Notes

Modified files:
- `frontend/src/components/MainView.tsx` - Remove desktop sidebar, extend hamburger to desktop
- `frontend/src/components/ChannelList.tsx` - Add auto-close on selection

### Testing Requirements

- Test hamburger visible on desktop for admin
- Test drawer opens/closes correctly on desktop
- Test channel selection closes drawer
- Test Escape key closes drawer
- Test backdrop click closes drawer
- Test viewer still has no access (from 6-4)

### References

- [Source: frontend/src/components/MainView.tsx#91-103] - Menu button
- [Source: frontend/src/components/MainView.tsx#133-144] - Desktop sidebar to remove
- [Source: frontend/src/components/MainView.tsx#148-188] - Drawer to extend
- [Source: frontend/src/components/ChannelList.tsx] - Channel selection handler
- [Source: frontend/src/stores/uiStore.ts] - Sidebar state

## Dev Agent Record

### Agent Model Used
Claude Opus 4.5

### Debug Log References
N/A - Implementation proceeded without issues

### Completion Notes List
- ✅ Task 1: Removed `!isDesktop &&` condition from menu button, updated focus trap to work on all breakpoints
- ✅ Task 2: Removed desktop pinned sidebar (`<aside>` in `<main>`), video now takes full width
- ✅ Task 3: Extended drawer overlay to all breakpoints by removing `!isDesktop &&` condition, updated comment
- ✅ Task 4: Added `useUIStore` import to ChannelList and call `setSidebarOpen(false)` after channel selection
- ✅ Task 5: Verified existing close mechanisms work (backdrop click line 149, Escape key handler lines 57-68)
- ✅ Task 6: Updated MainView.test.tsx with 4 new desktop tests, added auto-close test to ChannelList.test.tsx, removed outdated `isDesktop` variable causing lint error
- All 315 tests pass, linting passes, build succeeds

### Change Log
- 2026-01-03: Implemented unified hamburger menu for admin on all breakpoints. Removed pinned desktop sidebar. Added auto-close on channel selection.

### File List
- frontend/src/components/MainView.tsx (modified)
- frontend/src/components/ChannelList.tsx (modified)
- frontend/src/components/MainView.test.tsx (modified)
- frontend/src/components/ChannelList.test.tsx (modified)
