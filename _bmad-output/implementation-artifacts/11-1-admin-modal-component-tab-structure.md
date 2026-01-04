# Story 11.1: Admin Modal Component & Tab Structure

Status: review

## Story

As an admin,
I want a modal dialog with multiple tabs,
So that I can access all admin functions from one place.

## Acceptance Criteria

1. **Given** I am logged in as admin, **when** I click the admin button in the header, **then** a modal opens with tabs: "Channels", "Active Users", "User Access", "Plugins"
2. **Given** the admin modal is open, **when** I click outside the modal or press Escape, **then** the modal closes
3. **Given** I am on any view (Live TV or ErsatzTV), **when** I open the admin modal, **then** all four tabs are visible and functional

## Tasks / Subtasks

- [x] Task 1: Create AdminModal component (AC: #1, #2, #3)
  - [x] Create new file `frontend/src/components/AdminModal.tsx`
  - [x] Use existing Dialog component from `@/components/ui/dialog`
  - [x] Implement custom tab UI (no Radix Tabs installed - use local state)
  - [x] All 4 tabs always visible (context-agnostic - no view prop needed)
  - [x] Implement tab state management with useState
  - [x] Add proper focus management for keyboard navigation

- [x] Task 2: Implement tab content areas (AC: #1, #3)
  - [x] Create tab container with conditional rendering
  - [x] Add placeholder content for each tab (actual content in later stories)
  - [x] "Channels" tab - placeholder `{/* Story 11.2 */}`
  - [x] "Active Users" tab - placeholder `{/* Story 11.6 */}`
  - [x] "User Access" tab - placeholder `{/* Story 11.7 */}`
  - [x] "Plugins" tab - placeholder `{/* Story 11.7 */}`

- [x] Task 3: Add modal close behavior (AC: #2)
  - [x] Implement onOpenChange callback to Dialog
  - [x] Escape key handling (inherited from Dialog)
  - [x] Click outside to close (inherited from Dialog)

- [x] Task 4: Style tabs to match design system
  - [x] Use existing button/secondary styling patterns
  - [x] Active tab indicator (border-bottom or bg change)
  - [x] Hover states for inactive tabs
  - [x] Focus ring for keyboard navigation

## Dev Notes

### Architecture Patterns

**Component Pattern:**
- Use functional component with named export: `export function AdminModal()`
- Props interface: `{ open: boolean; onOpenChange: (open: boolean) => void }`
- **UPDATE:** Removed `view` prop - admin modal is context-agnostic
- Follow existing modal pattern from `ProgrammeDetailsModal.tsx`

**Tab Implementation:**
- NO Radix Tabs installed - implement custom tabs with `useState`
- **UPDATE:** Admin modal is context-agnostic - all 4 tabs always visible
- Tab pattern:
```tsx
const [activeTab, setActiveTab] = useState<TabType>('channels')

const tabs = [
  { id: 'channels', label: 'Channels' },
  { id: 'active-users', label: 'Active Users' },
  { id: 'user-access', label: 'User Access' },
  { id: 'plugins', label: 'Plugins' },
]

<div className="flex gap-0 border-b">
  {tabs.map(tab => (
    <button
      key={tab.id}
      onClick={() => setActiveTab(tab.id)}
      className={cn(
        "px-4 py-2 border-b-2 transition-colors",
        activeTab === tab.id
          ? "border-primary text-primary font-medium"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {tab.label}
    </button>
  ))}
</div>
```

### Existing Dialog Component Usage

**From `frontend/src/components/ui/dialog.tsx`:**
```tsx
<Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent className="max-w-2xl">
    <DialogHeader>
      <DialogTitle>Admin Panel</DialogTitle>
    </DialogHeader>
    {/* Tab navigation and content */}
  </DialogContent>
</Dialog>
```

**Key Props:**
- `showCloseButton={true}` - default, provides X button
- Modal handles Escape key automatically
- Click-outside-to-close is built-in

### Dependencies

**Required Imports:**
- `Dialog, DialogContent, DialogHeader, DialogTitle` from `@/components/ui/dialog`
- `cn` from `@/lib/utils`
- No new dependencies needed

### File Structure

```
frontend/src/components/
├── AdminModal.tsx (NEW - this story)
├── admin/
│   └── ActiveUsersTab.tsx (Story 11.6)
└── ChannelList.tsx (reused in Story 11.2)
```

### Project Structure Notes

- Aligns with existing component patterns in `frontend/src/components/`
- Uses PascalCase for component filename
- Named export pattern consistent with codebase
- Dialog component already exists and is well-tested

### References

- [Source: frontend/src/components/ersatztv/ProgrammeDetailsModal.tsx] - Modal pattern reference
- [Source: frontend/src/components/ui/dialog.tsx] - Dialog API and props
- [Source: frontend/src/lib/utils.ts] - cn utility usage
- [Source: _bmad-output/project-planning-artifacts/sprint-change-proposal-2026-01-04-admin-modal.md] - Tab styling specification

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

N/A - Implementation completed without issues

### Completion Notes List

- Created AdminModal component with custom tab implementation (no Radix Tabs dependency)
- Implemented 4 tabs: Channels, Active Users, User Access, Plugins
- **UPDATE 2026-01-04:** Removed `view` prop - admin modal is now context-agnostic
- All 4 tabs always visible regardless of which view opens the modal
- All dialog behaviors (Escape key, click-outside-to-close, X button) inherited from Radix Dialog
- Full keyboard navigation with Enter/Space key support
- 24 comprehensive tests covering all acceptance criteria
- Tests pass, lint passes, no regressions

### File List

- frontend/src/components/AdminModal.tsx (NEW)
- frontend/src/components/AdminModal.test.tsx (NEW)

### Change Log

- 2026-01-04: Implemented AdminModal component with tab structure (Story 11.1)
- 2026-01-04: **UPDATED** - Removed view-dependent tab visibility per correct-course workflow. Admin modal is now context-agnostic with all 4 tabs always visible.
