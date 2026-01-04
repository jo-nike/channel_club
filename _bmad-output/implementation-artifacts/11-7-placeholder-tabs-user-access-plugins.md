# Story 11.7: Placeholder Tabs (User Access & Plugins)

Status: ready-for-dev

## Story

As an admin,
I want placeholder tabs for future features,
So that the UI structure is ready for expansion.

## Acceptance Criteria

1. **Given** I open the "User Access" tab, **when** the tab renders, **then** I see a placeholder message: "User access management coming soon"
2. **Given** I open the admin modal from any view, **when** I navigate to the "Plugins" tab, **then** I see a placeholder message: "Plugins management coming soon"

## Tasks / Subtasks

- [ ] Task 1: Create PlaceholderTab component (AC: #1, #2)
  - [ ] Create reusable placeholder component
  - [ ] Accept `title` and `message` props
  - [ ] Use consistent styling with other modal content
  - [ ] Add icon for visual interest (optional)

- [ ] Task 2: Implement User Access tab content (AC: #1)
  - [ ] Render PlaceholderTab when "user-access" tab is active
  - [ ] Message: "User access management coming soon"
  - [ ] Consider adding brief description of planned functionality

- [ ] Task 3: Implement Plugins tab content (AC: #2)
  - [ ] Render PlaceholderTab when "plugins" tab is active
  - [ ] Message: "Plugins management coming soon"
  - [ ] Visible from any view (context-agnostic admin modal)

- [ ] Task 4: Verify tabs work from any view
  - [ ] Confirm all tabs visible regardless of which view opens modal
  - [ ] Test navigation between all 4 tabs

## Dev Notes

### Architecture Patterns

**PlaceholderTab Component:**

```tsx
// Can be added directly in AdminModal.tsx or as separate file
// frontend/src/components/admin/PlaceholderTab.tsx

import { Construction } from 'lucide-react'

interface PlaceholderTabProps {
  title: string
  message: string
  description?: string
}

export function PlaceholderTab({ title, message, description }: PlaceholderTabProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Construction className="h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground">{message}</p>
      {description && (
        <p className="text-sm text-muted-foreground mt-2 max-w-md">
          {description}
        </p>
      )}
    </div>
  )
}
```

**Integration in AdminModal:**

```tsx
// In AdminModal.tsx

{activeTab === 'user-access' && (
  <PlaceholderTab
    title="User Access"
    message="User access management coming soon"
    description="Manage user permissions, invite new users, and control access levels."
  />
)}

{activeTab === 'plugins' && view === 'live' && (
  <PlaceholderTab
    title="Plugins"
    message="Plugins management coming soon"
    description="Extend functionality with third-party integrations and custom features."
  />
)}
```

### Tab Visibility (Context-Agnostic)

**UPDATE:** AdminModal is now context-agnostic. All 4 tabs are always visible:

```tsx
const tabs = [
  { id: 'channels', label: 'Channels' },
  { id: 'active-users', label: 'Active Users' },
  { id: 'user-access', label: 'User Access' },
  { id: 'plugins', label: 'Plugins' },
]
```

No filtering - all tabs visible from any view (Live TV or ErsatzTV).

### Placeholder Content Suggestions

**User Access Tab:**
```tsx
<PlaceholderTab
  title="User Access"
  message="User access management coming soon"
  description="Future features: invite users, manage roles, revoke access, view login history."
/>
```

**Plugins Tab:**
```tsx
<PlaceholderTab
  title="Plugins"
  message="Plugins management coming soon"
  description="Future features: EPG enhancements, recording integration, channel grouping."
/>
```

### Alternative: Inline Placeholder

If you prefer not to create a separate component:

```tsx
{activeTab === 'user-access' && (
  <div className="flex flex-col items-center justify-center py-12 text-center">
    <p className="text-lg text-muted-foreground">
      User access management coming soon
    </p>
  </div>
)}

{activeTab === 'plugins' && (
  <div className="flex flex-col items-center justify-center py-12 text-center">
    <p className="text-lg text-muted-foreground">
      Plugins management coming soon
    </p>
  </div>
)}
```

### Icon Options from lucide-react

Available icons that convey "coming soon" / "under construction":

- `Construction` - hard hat / construction theme
- `Wrench` - tools / in progress
- `Clock` - coming soon / time
- `Sparkles` - new / upcoming
- `Settings2` - configuration in progress

### File Structure

Option A (Separate component):
```
frontend/src/components/
├── admin/
│   ├── ActiveUsersTab.tsx (from Story 11.6)
│   └── PlaceholderTab.tsx (NEW - optional)
└── AdminModal.tsx
```

Option B (Inline in AdminModal):
```
frontend/src/components/
├── admin/
│   └── ActiveUsersTab.tsx (from Story 11.6)
└── AdminModal.tsx (all placeholder content inline)
```

### Project Structure Notes

- Lightweight implementation - placeholder content only
- No new dependencies required
- Reuses existing Tailwind classes and patterns
- Icon from lucide-react (already installed)

### References

- [Source: frontend/src/components/AdminModal.tsx] - Modal component from Story 11.1
- [Source: _bmad-output/project-planning-artifacts/sprint-change-proposal-2026-01-04-admin-modal.md] - Tab visibility requirements
- lucide-react icons: https://lucide.dev/icons

### Previous Story Dependencies

- **Story 11.1** - AdminModal structure and tab logic must exist
- Tab visibility already handled by view prop

### Testing Notes

- Verify User Access tab shows placeholder from any view
- Verify Plugins tab shows placeholder from any view
- Verify placeholder messages are readable and centered
- Test keyboard navigation between all tabs

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
