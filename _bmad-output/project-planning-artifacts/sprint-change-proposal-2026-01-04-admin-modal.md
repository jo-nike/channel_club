# Sprint Change Proposal: Admin Modal & User Presence

**Date:** 2026-01-04
**Requested By:** Jon
**Status:** Approved

---

## 1. Issue Summary

### Problem Statement
Admin functionality is currently scattered and incomplete across the application:
- Live TV has channel selection via hamburger menu
- ErsatzTV has no admin controls
- No visibility into active users or bandwidth consumption
- No central place for future admin features (user access, plugins)

### Context
This is a **new feature request** to consolidate admin functionality into a unified modal accessible from both views. The change also introduces real-time user presence monitoring with stream bitrate tracking.

### Evidence/Rationale
- Admin needs visibility into who's watching what (operational need)
- Consistent UI pattern across both views improves UX
- Bitrate monitoring helps manage bandwidth usage
- Placeholder tabs signal future admin capabilities

---

## 2. Impact Analysis

### Epic Impact

| Epic | Impact Level | Description |
|------|--------------|-------------|
| Epic 6 | Minor | Story 6.5 (hamburger menu) becomes obsolete |
| Epic 7 | Minor | ErsatzTVView header gets admin button |
| **New Epic 11** | Major | New epic created for Admin Modal & User Presence |

### Story Impact

**New Stories (Epic 11):**
- 11.1: Admin Modal Component & Tab Structure
- 11.2: Channel Selection Tab (Live TV)
- 11.3: Admin Button in MainView Header
- 11.4: Admin Button in ErsatzTVView Header
- 11.5: Active Users & Bitrate Backend
- 11.6: Active Users Tab UI
- 11.7: Placeholder Tabs (User Access & Plugins)

### Artifact Conflicts

| Artifact | Change Required |
|----------|-----------------|
| epics.md | Add Epic 11 definition with 7 stories |
| sprint-status.yaml | Add Epic 11 tracking entries |
| MainView.tsx | Replace hamburger menu with admin button, remove sidebar drawer |
| ErsatzTVView.tsx | Add admin button to header |
| Backend | New presence tracking service and admin endpoint |

### Technical Impact

**Frontend Changes:**
- New `AdminModal` component with tabbed interface
- New `ActiveUsersTab` component with bitrate display
- New `useActiveUsers` hook for data fetching
- Modify `MainView.tsx` header (replace Menu with Settings icon)
- Modify `ErsatzTVView.tsx` header (add Settings icon)
- Update `ChannelList.tsx` with optional callback prop
- Add `formatDuration` utility function

**Backend Changes:**
- New `presence.py` service for tracking active users
- New `admin.py` router with `/api/admin/active-users` endpoint
- Modify WebSocket connection handling to track presence
- Track: userId, username, view, currentChannel, connectedSince, estimatedBitrate

---

## 3. Recommended Approach

### Selected Path: Direct Adjustment

**Rationale:**
- Additive feature with no breaking changes
- Reuses existing channel selection component
- Backend presence tracking is isolated addition
- Placeholder tabs minimize initial scope
- Can run in parallel with ongoing work

**Effort Estimate:** Medium
**Risk Level:** Low
**Timeline Impact:** Adds 7 new stories (Epic 11)

---

## 4. Detailed Change Proposals

### 4.1 Epic 11 Definition

Add to `_bmad-output/project-planning-artifacts/epics.md`:

```markdown
## Epic 11: Admin Modal & User Presence

Admins can access a centralized admin modal from both Live TV and ErsatzTV views,
providing channel control, real-time user presence monitoring with stream bitrate
usage, and placeholders for future admin features.

**Key Features:**
- Unified admin modal accessible from both views
- Channel selection moved into modal (Live TV tab)
- Real-time active user monitoring with separated Live/ErsatzTV sections
- Stream bitrate usage per user and totals
- Placeholder tabs for User Access and Plugins (future features)
- Admin-only visibility (existing env variable auth)
```

### 4.2 Sprint Status Update

Add to `_bmad-output/implementation-artifacts/sprint-status.yaml`:

```yaml
  # Epic 11: Admin Modal & User Presence
  epic-11: backlog
  11-1-admin-modal-component-tab-structure: backlog
  11-2-channel-selection-tab-live-tv: backlog
  11-3-admin-button-mainview-header: backlog
  11-4-admin-button-ersatztvview-header: backlog
  11-5-active-users-bitrate-backend: backlog
  11-6-active-users-tab-ui: backlog
  11-7-placeholder-tabs-user-access-plugins: backlog
  epic-11-retrospective: optional
```

### 4.3 MainView.tsx Header Modification

**File:** `frontend/src/components/MainView.tsx`

**OLD:**
```tsx
{/* Menu button - left side for admin */}
{isAdmin && (
  <button
    ref={sidebarTriggerRef}
    onClick={(e) => {
      sidebarTriggerRef.current = e.currentTarget
      setSidebarOpen(true)
    }}
    className="..."
    aria-label="Open channel list"
  >
    <Menu className="h-4 w-4 shrink-0" />
  </button>
)}
```

**NEW:**
```tsx
{/* Admin button - left side for admin */}
{isAdmin && (
  <button
    onClick={() => setAdminModalOpen(true)}
    className="..."
    aria-label="Open admin panel"
  >
    <Settings className="h-4 w-4 shrink-0" />
  </button>
)}
```

**Additional:**
- Remove sidebar drawer code (lines 184-223)
- Remove mobile FAB (lines 226-238)
- Add `<AdminModal>` component

### 4.4 ErsatzTVView.tsx Header Modification

**File:** `frontend/src/components/ersatztv/ErsatzTVView.tsx`

**NEW (add before ThemePicker):**
```tsx
{/* Admin button - same position as MainView */}
{isAdmin && (
  <button
    onClick={() => setAdminModalOpen(true)}
    className="h-8 w-8 flex items-center justify-center bg-secondary..."
    aria-label="Open admin panel"
  >
    <Settings className="h-4 w-4 shrink-0" />
  </button>
)}
```

### 4.5 New Components

| Component | File | Purpose |
|-----------|------|---------|
| AdminModal | `frontend/src/components/AdminModal.tsx` | Modal with tabs, adapts to view |
| ActiveUsersTab | `frontend/src/components/admin/ActiveUsersTab.tsx` | User list with bitrate |
| useActiveUsers | `frontend/src/hooks/useActiveUsers.ts` | Data fetching hook |

### 4.6 Backend Changes

| File | Change |
|------|--------|
| `backend/app/services/presence.py` | NEW - User presence tracking |
| `backend/app/routers/admin.py` | NEW - Admin endpoints |
| `backend/app/main.py` | Register admin router |
| `backend/app/routers/websocket.py` | Track presence on connect/disconnect |

**API Response Format:**
```json
{
  "liveUsers": [
    {"username": "...", "channel": "...", "connectedSince": "...", "bitrateMbps": 8.5}
  ],
  "ersatztvUsers": [
    {"username": "...", "channel": "...", "connectedSince": "...", "bitrateMbps": 12.0}
  ],
  "totals": {
    "liveCount": 2,
    "ersatztvCount": 3,
    "liveBitrateMbps": 17.0,
    "ersatztvBitrateMbps": 36.0,
    "totalBitrateMbps": 53.0
  }
}
```

---

## 5. Implementation Handoff

### Change Scope: Minor to Moderate

This change can be implemented directly by the development team without requiring backlog reorganization or architectural review.

### Implementation Order

1. **Story 11.1** - AdminModal component structure
2. **Story 11.3** - MainView admin button (can parallel with 11.4)
3. **Story 11.4** - ErsatzTVView admin button
4. **Story 11.2** - Channel selection tab (move existing)
5. **Story 11.5** - Backend presence tracking
6. **Story 11.6** - Active Users UI
7. **Story 11.7** - Placeholder tabs

### Success Criteria

- [ ] Admin button visible on both views (admin only)
- [ ] Modal opens with correct tabs per view
- [ ] Channel selection works from modal (Live TV)
- [ ] Active users displayed with separated sections
- [ ] Bitrate shown per user and as totals
- [ ] Modal closes on channel selection or Escape
- [ ] Placeholder tabs display coming soon messages

### Handoff Recipients

| Role | Responsibility |
|------|----------------|
| Developer | Implement all 7 stories |
| Tester | Verify acceptance criteria |

---

## Approval

**Proposal Status:** ✅ Approved
**Approved By:** Jon
**Approval Date:** 2026-01-04

---

## Appendix: Full Story Definitions

### Story 11.1: Admin Modal Component & Tab Structure

As an admin,
I want a modal dialog with multiple tabs,
So that I can access all admin functions from one place.

**Acceptance Criteria:**

- Given I am logged in as admin, when I click the admin button in the header, then a modal opens with tabs: "Channels", "Active Users", "User Access", "Plugins"
- Given the admin modal is open, when I click outside the modal or press Escape, then the modal closes
- Given I am on the ErsatzTV view, when I open the admin modal, then the "Channels" and "Plugins" tabs are hidden (Live TV only)

---

### Story 11.2: Channel Selection Tab (Live TV)

As an admin,
I want to select channels from within the admin modal,
So that channel control is consolidated with other admin functions.

**Acceptance Criteria:**

- Given I am on Live TV view and open the admin modal, when I navigate to the "Channels" tab, then I see the existing channel list component
- Given I select a channel from the modal, when selection completes, then the channel changes for all viewers and the modal closes automatically

---

### Story 11.3: Admin Button in MainView Header

As an admin on Live TV,
I want an admin button replacing the hamburger menu,
So that I can access the admin modal.

**Acceptance Criteria:**

- Given I am logged in as admin on Live TV, when the header renders, then I see an admin icon button (replacing the hamburger menu) and clicking it opens the admin modal
- Given I am logged in as viewer, when the header renders, then I do NOT see the admin button

---

### Story 11.4: Admin Button in ErsatzTVView Header

As an admin on ErsatzTV,
I want the same admin button in the header,
So that I have consistent access to admin functions.

**Acceptance Criteria:**

- Given I am logged in as admin on ErsatzTV, when the header renders, then I see the admin icon button at the same position as Live TV (left side)
- Given I click the admin button, when the modal opens, then only "Active Users" and "User Access" tabs are visible (no Channels/Plugins)

---

### Story 11.5: Active Users & Bitrate Backend

As the system,
I want to track connected users, their activity, and stream bitrate usage,
So that admins can monitor who is watching and bandwidth consumption.

**Acceptance Criteria:**

- Given a user connects via WebSocket, when they are authenticated, then their presence is tracked: userId, username, view (live/ersatztv), currentChannel, connectedSince, estimatedBitrate
- Given an admin requests active users, when GET `/api/admin/active-users` is called, then return structured response with liveUsers, ersatztvUsers, and totals
- Given a user disconnects, when their WebSocket closes, then they are removed from the active users list
- Given a user changes channels, when the channel updates, then their tracked currentChannel and estimatedBitrate update

---

### Story 11.6: Active Users Tab UI

As an admin,
I want to see who is currently watching and their bandwidth usage,
So that I can monitor usage and resource consumption.

**Acceptance Criteria:**

- Given I open the "Active Users" tab, when the tab renders, then I see two sections: "Live TV" and "ErsatzTV" and total bandwidth summary at the top
- Given users are connected to Live TV, when viewing the Live TV section, then I see each user with: username, current channel, duration, bitrate and section subtotal
- Given users are connected to ErsatzTV, when viewing the ErsatzTV section, then I see each user with: username, current channel, duration, bitrate and section subtotal
- Given no users are connected to a view, when viewing that section, then I see "No active users" message

---

### Story 11.7: Placeholder Tabs (User Access & Plugins)

As an admin,
I want placeholder tabs for future features,
So that the UI structure is ready for expansion.

**Acceptance Criteria:**

- Given I open the "User Access" tab, when the tab renders, then I see a placeholder message: "User access management coming soon"
- Given I am on Live TV and open the admin modal, when I navigate to the "Plugins" tab, then I see a placeholder message: "Plugins management coming soon"
- Given I am on ErsatzTV, when I open the admin modal, then the "Plugins" tab is NOT visible
