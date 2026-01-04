# Sprint Change Proposal: Context-Agnostic Admin Modal

**Date:** 2026-01-04
**Requested By:** Jon
**Status:** Approved

---

## Section 1: Issue Summary

### Problem Statement

The current Epic 11 design implements a **context-dependent admin modal** where certain tabs (Channels, Plugins) are hidden when the modal is opened from the ErsatzTV view. This creates an inconsistent admin experience and prevents useful workflows like:

- Changing the Live TV channel while watching ErsatzTV
- Accessing future plugin features from the ErsatzTV view

### Context

Discovered during Epic 11 implementation (Story 11.2 in progress). The original design assumed admins would only need channel control from Live TV view, but in practice a unified admin experience is more practical.

### Evidence

- AdminModal.tsx implements `liveOnly` filtering that hides Channels/Plugins tabs
- Story 11.1 AC#3, Story 11.4 AC#2, Story 11.7 AC#3 all specify tab hiding behavior
- User feedback: "I want all options available from both views"

---

## Section 2: Impact Analysis

### Epic Impact

| Epic | Status | Impact |
|------|--------|--------|
| Epic 11 | in-progress | **Direct** - 3 stories need AC updates |

### Story Impact

| Story | Current Status | Change Required |
|-------|----------------|-----------------|
| 11.1 | review | Update AC#3, update code |
| 11.4 | ready-for-dev | Update AC#2, add AC#3 |
| 11.7 | ready-for-dev | Remove AC#3 |

### Artifact Conflicts

| Artifact | Conflict | Resolution |
|----------|----------|------------|
| epics.md | Key Features wording | Update to reflect unified modal |
| AdminModal.tsx | `liveOnly` filtering logic | Remove filtering |
| AdminModal.test.tsx | Tests for tab hiding | Update/remove tests |
| Story 11.1 file | Dev notes reference filtering | Update dev notes |
| Story 11.4 file | Dev notes reference filtering | Update dev notes |
| Story 11.7 file | Dev notes reference filtering | Update dev notes |

### Technical Impact

- **Code Changes:** Simplification - remove ~15 lines of filtering logic
- **Test Changes:** Update ~5 tests that verify tab hiding
- **No new dependencies**
- **No API changes**
- **No database changes**

---

## Section 3: Recommended Approach

### Selected Path: Direct Adjustment

Modify existing stories and code to remove context-dependent tab visibility. All four tabs will always be visible regardless of which view opens the admin modal.

### Rationale

1. **Simplifies implementation** - removing code is safer than adding it
2. **Better UX** - consistent admin experience across views
3. **Lower risk** - fewer conditional code paths
4. **Minimal rework** - Story 11.1 code update is straightforward

### Effort Estimate

- **Story file updates:** 15 minutes
- **Code changes:** 15 minutes
- **Test updates:** 20 minutes
- **Total:** ~50 minutes

### Risk Assessment

- **Risk Level:** Low
- **Mitigation:** Change is a simplification, reducing complexity

---

## Section 4: Detailed Change Proposals

### 4.1 Epic 11 Description Update (epics.md)

**Location:** Epic 11 Key Features section

```diff
 **Key Features:**
-- Unified admin modal accessible from both views
-- Channel selection moved into modal (Live TV tab)
+- Unified admin modal accessible from both views with identical functionality
+- Channel selection available from any view (control Live TV from ErsatzTV)
 - Real-time active user monitoring with separated Live/ErsatzTV sections
 - Stream bitrate usage per user and totals
-- Placeholder tabs for User Access and Plugins (future features)
+- Placeholder tabs for User Access and Plugins (accessible from any view)
 - Admin-only visibility (existing env variable auth)
```

### 4.2 Story 11.1 Updates

**File:** `_bmad-output/implementation-artifacts/11-1-admin-modal-component-tab-structure.md`

**Acceptance Criteria Change:**
```diff
 1. **Given** I am logged in as admin, **when** I click the admin button in the header, **then** a modal opens with tabs: "Channels", "Active Users", "User Access", "Plugins"
 2. **Given** the admin modal is open, **when** I click outside the modal or press Escape, **then** the modal closes
-3. **Given** I am on the ErsatzTV view, **when** I open the admin modal, **then** the "Channels" and "Plugins" tabs are hidden (Live TV only)
+3. **Given** I am on any view (Live TV or ErsatzTV), **when** I open the admin modal, **then** all four tabs are visible and functional
```

**Dev Notes Update:**
- Remove `liveOnly` property from Tab interface
- Remove `view` prop from AdminModalProps
- Remove `visibleTabs` filtering logic
- Update `effectiveActiveTab` to work with static tabs array

### 4.3 Story 11.4 Updates

**File:** `_bmad-output/implementation-artifacts/11-4-admin-button-ersatztvview-header.md`

**Acceptance Criteria Change:**
```diff
 1. **Given** I am logged in as admin on ErsatzTV, **when** the header renders, **then** I see the admin icon button at the same position as Live TV (left side)
-2. **Given** I click the admin button, **when** the modal opens, **then** only "Active Users" and "User Access" tabs are visible (no Channels/Plugins)
+2. **Given** I click the admin button, **when** the modal opens, **then** all four tabs are visible: "Channels", "Active Users", "User Access", "Plugins"
+3. **Given** I select a channel from the Channels tab while on ErsatzTV, **when** selection completes, **then** the Live TV channel changes for all viewers
```

**Dev Notes Update:**
- Remove `view="ersatztv"` prop from AdminModal usage
- Update tab visibility comments

### 4.4 Story 11.7 Updates

**File:** `_bmad-output/implementation-artifacts/11-7-placeholder-tabs-user-access-plugins.md`

**Acceptance Criteria Change:**
```diff
 1. **Given** I open the "User Access" tab, **when** the tab renders, **then** I see a placeholder message: "User access management coming soon"
-2. **Given** I am on Live TV and open the admin modal, **when** I navigate to the "Plugins" tab, **then** I see a placeholder message: "Plugins management coming soon"
-3. **Given** I am on ErsatzTV, **when** I open the admin modal, **then** the "Plugins" tab is NOT visible
+2. **Given** I open the admin modal from any view, **when** I navigate to the "Plugins" tab, **then** I see a placeholder message: "Plugins management coming soon"
```

**Dev Notes Update:**
- Remove tab visibility verification for ErsatzTV
- Update testing notes

### 4.5 AdminModal.tsx Code Changes

**File:** `frontend/src/components/AdminModal.tsx`

```diff
-type TabType = 'channels' | 'active-users' | 'user-access' | 'plugins'
-
-interface Tab {
-  id: TabType
-  label: string
-  liveOnly: boolean
-}
+type TabType = 'channels' | 'active-users' | 'user-access' | 'plugins'

 interface AdminModalProps {
   open: boolean
   onOpenChange: (open: boolean) => void
-  view: 'live' | 'ersatztv'
 }

-const tabs: Tab[] = [
-  { id: 'channels', label: 'Channels', liveOnly: true },
-  { id: 'active-users', label: 'Active Users', liveOnly: false },
-  { id: 'user-access', label: 'User Access', liveOnly: false },
-  { id: 'plugins', label: 'Plugins', liveOnly: true },
+const tabs: { id: TabType; label: string }[] = [
+  { id: 'channels', label: 'Channels' },
+  { id: 'active-users', label: 'Active Users' },
+  { id: 'user-access', label: 'User Access' },
+  { id: 'plugins', label: 'Plugins' },
 ]

-export function AdminModal({ open, onOpenChange, view }: AdminModalProps) {
-  const visibleTabs = useMemo(() =>
-    tabs.filter(tab => view === 'live' || !tab.liveOnly),
-    [view]
-  )
-
+export function AdminModal({ open, onOpenChange }: AdminModalProps) {
   const [activeTab, setActiveTab] = useState<TabType>('channels')
-
-  // Derive effective active tab - if current tab isn't visible, use first visible
-  const effectiveActiveTab = useMemo(() => {
-    if (visibleTabs.find(t => t.id === activeTab)) {
-      return activeTab
-    }
-    return visibleTabs[0]?.id || 'active-users'
-  }, [activeTab, visibleTabs])
```

**Also update:**
- Replace `effectiveActiveTab` with `activeTab` throughout
- Replace `visibleTabs` with `tabs` in map function

---

## Section 5: Implementation Handoff

### Change Scope Classification

**Minor** - Direct implementation by development team

### Handoff Recipients

| Role | Responsibility |
|------|----------------|
| Developer | Update AdminModal.tsx and tests |
| Developer | Update story files with new ACs |
| Developer | Update epics.md description |

### Implementation Checklist

- [ ] Update epics.md Epic 11 key features
- [ ] Update Story 11.1 acceptance criteria and dev notes
- [ ] Update Story 11.4 acceptance criteria and dev notes
- [ ] Update Story 11.7 acceptance criteria and dev notes
- [ ] Modify AdminModal.tsx to remove view prop and liveOnly filtering
- [ ] Update AdminModal.test.tsx - remove tab hiding tests, add all-tabs-visible tests
- [ ] Update MainView.tsx - remove view prop from AdminModal usage
- [ ] Run tests: `npm test`
- [ ] Run lint: `npm run lint`

### Success Criteria

1. Admin modal shows all 4 tabs when opened from Live TV view
2. Admin modal shows all 4 tabs when opened from ErsatzTV view
3. Channel selection from ErsatzTV view changes Live TV channel for all viewers
4. All existing tests pass (with updates)
5. No TypeScript errors

---

## Approval

**Approved:** Yes (YOLO mode)
**Date:** 2026-01-04
**Approver:** Jon

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-01-04 | Initial proposal created | Claude (correct-course workflow) |
| 2026-01-04 | Approved via YOLO mode | Jon |
