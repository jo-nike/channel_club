# Story 11.4: Admin Button in ErsatzTVView Header

Status: ready-for-dev

## Story

As an admin on ErsatzTV,
I want the same admin button in the header,
So that I have consistent access to admin functions.

## Acceptance Criteria

1. **Given** I am logged in as admin on ErsatzTV, **when** the header renders, **then** I see the admin icon button at the same position as Live TV (left side)
2. **Given** I click the admin button, **when** the modal opens, **then** all four tabs are visible: "Channels", "Active Users", "User Access", "Plugins"
3. **Given** I select a channel from the Channels tab while on ErsatzTV, **when** selection completes, **then** the Live TV channel changes for all viewers

## Tasks / Subtasks

- [ ] Task 1: Add useAuth hook and isAdmin check (AC: #1)
  - [ ] Import useAuth hook
  - [ ] Destructure `isAdmin` from useAuth
  - [ ] Add conditional rendering for admin button

- [ ] Task 2: Add admin button to header (AC: #1)
  - [ ] Import Settings icon from lucide-react
  - [ ] Add button at left side of header (before ThemePicker)
  - [ ] Use same styling as MainView admin button
  - [ ] Add aria-label="Open admin panel"

- [ ] Task 3: Add admin modal state and component (AC: #1, #2, #3)
  - [ ] Add state: `const [adminModalOpen, setAdminModalOpen] = useState(false)`
  - [ ] Import AdminModal component
  - [ ] Render `<AdminModal open={adminModalOpen} onOpenChange={setAdminModalOpen} />`
  - [ ] Note: All 4 tabs are always visible (context-agnostic modal)

- [ ] Task 4: Verify viewer experience unchanged
  - [ ] Ensure admin button not visible for viewers
  - [ ] Header layout unchanged for non-admins

## Dev Notes

### Architecture Patterns

**Current Header Structure (lines 185-238):**
```tsx
<header className="flex justify-between items-center px-4 py-2 bg-background border-b">
  <div className="flex items-center gap-4">
    {/* Theme picker - consistent with MainView placement */}
    <ThemePicker />
    {/* Current programme info */}
    <span className="text-muted-foreground text-sm">
      {selectedChannel?.name && currentProgramme
        ? `${selectedChannel.name} - ${currentProgramme.title}`
        : selectedChannel?.name || 'No programme'}
    </span>
  </div>

  <div className="flex items-center gap-2">
    {/* EPG toggle button - desktop only */}
    {!isMobile && (...)}
    {/* Live TV button */}
    <button onClick={handleLiveTVClick}>...</button>
    {/* ... other buttons */}
  </div>
</header>
```

**NEW Header Structure:**
```tsx
<header className="flex justify-between items-center px-4 py-2 bg-background border-b">
  <div className="flex items-center gap-4">
    {/* Admin button - same position as MainView (left side) */}
    {isAdmin && (
      <button
        onClick={() => setAdminModalOpen(true)}
        className="h-8 w-8 flex items-center justify-center bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        aria-label="Open admin panel"
      >
        <Settings className="h-4 w-4 shrink-0" />
      </button>
    )}
    {/* Theme picker */}
    <ThemePicker />
    {/* Current programme info */}
    <span className="text-muted-foreground text-sm">
      {/* ... */}
    </span>
  </div>
  {/* ... right side unchanged ... */}
</header>

{/* Admin Modal - all tabs visible (context-agnostic) */}
{isAdmin && (
  <AdminModal
    open={adminModalOpen}
    onOpenChange={setAdminModalOpen}
  />
)}
```

### Tab Visibility (Context-Agnostic)

**UPDATE:** AdminModal no longer uses a `view` prop. All 4 tabs are always visible:
- "Channels" tab: **VISIBLE** - can control Live TV channel from ErsatzTV view
- "Active Users" tab: **VISIBLE**
- "User Access" tab: **VISIBLE**
- "Plugins" tab: **VISIBLE** - future plugins accessible from any view

No filtering logic - AdminModalProps is now just `{ open, onOpenChange }`.

### Import Changes

**Add to existing imports:**
```tsx
import { Settings } from 'lucide-react'  // Add to existing lucide import
import { useAuth } from '@/hooks/useAuth'  // Add new import
import { AdminModal } from '@/components/AdminModal'  // Add new import
```

**Current imports in ErsatzTVView.tsx:**
```tsx
import { Tv, LayoutList, RefreshCw } from 'lucide-react'
```

**New imports:**
```tsx
import { Settings, Tv, LayoutList, RefreshCw } from 'lucide-react'
```

### useAuth Hook Usage

The useAuth hook is already used in MainView. For ErsatzTVView, add:

```tsx
const { logout, isAdmin } = useAuth()
```

Note: `logout` is already destructured. Just add `isAdmin`.

### Consistent Styling

Button styling matches MainView exactly:
```tsx
className="h-8 w-8 flex items-center justify-center bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
```

### Project Structure Notes

- Modifies existing file `frontend/src/components/ersatztv/ErsatzTVView.tsx`
- Adds admin button to left side of header
- Uses same AdminModal component as MainView
- Different `view` prop controls tab visibility

### References

- [Source: frontend/src/components/ersatztv/ErsatzTVView.tsx:185-238] - Current header structure
- [Source: frontend/src/components/ersatztv/ErsatzTVView.tsx:1-20] - Current imports
- [Source: frontend/src/components/MainView.tsx:112-124] - Admin button styling reference
- [Source: frontend/src/hooks/useAuth.ts] - useAuth hook API
- [Source: _bmad-output/project-planning-artifacts/sprint-change-proposal-2026-01-04-admin-modal.md#4.4] - Detailed change specification

### Previous Story Dependencies

- **Story 11.1** - AdminModal component must be created first
- **Story 11.3** - Can run in parallel; provides reference for consistent implementation

### Testing Notes

- Verify admin button appears only for admin role
- Verify clicking button opens modal
- Verify modal only shows Active Users and User Access tabs
- Verify viewer role sees no admin button
- Verify header layout consistent with MainView

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
