# Sprint Change Proposal: Epic 6 - UI Polish & EPG Integration

**Date:** 2026-01-03
**Requested By:** Jon
**Status:** APPROVED
**Scope Classification:** Minor (Development team implementation)

---

## 1. Issue Summary

### Problem Statement
Post-MVP enhancement request following successful completion of Epics 1-5. User requests UI refinements and EPG integration to improve the viewing experience.

### Context
- All 5 original epics completed successfully
- Application is deployed and functional
- These are planned v2 enhancements (EPG was explicitly marked as v2 in original PRD)

### Requested Changes
1. **Viewer Role - Channel List Removal**: Viewers should not see channel list at all
2. **Admin Role - Hamburger Menu**: Replace pinned sidebar with collapsible menu on ALL breakpoints
3. **Full-Screen Video**: Video player takes entire width (minus header) for both roles
4. **Header Redesign**:
   - Reduce header height by 50%
   - Rename "IPTV Viewer" → "Jon's place"
   - Display current channel name in header
   - Display EPG "now playing" info from Dispatcharr
5. **Bug Fix**: Logout button text overflow issue

---

## 2. Impact Analysis

### Epic Impact
| Epic | Status | Impact |
|------|--------|--------|
| Epic 1-5 | Complete | No changes needed |
| Epic 6 | NEW | Created with 6 stories |

### Artifact Impact
| Artifact | Impact | Action |
|----------|--------|--------|
| PRD | EPG moves from out-of-scope to in-scope | Updated |
| Architecture | New EPG service, endpoint, data flow | Updated |
| Epics | Add Epic 6 with 6 stories | Updated |
| Sprint Status | Add Epic 6 tracking | Updated |

### Technical Impact
- **Backend**: New EPG service with XMLTV parsing and 24h caching
- **Frontend**: Header component changes, role-based UI visibility
- **API**: New endpoint `GET /api/epg/now-playing`

---

## 3. Recommended Approach

### Selected Path: Direct Adjustment

**Rationale:**
- Additive changes with no breaking changes to existing code
- Clear scope and well-defined requirements
- Low risk - existing functionality unaffected
- Natural progression from MVP to v2 features

### Effort Estimate
- **Stories:** 6
- **Complexity:** Medium
- **Risk Level:** Low

---

## 4. Detailed Change Proposals

### 4.1 PRD Update
**File:** `product-brief-iptv_viewer2-2025-12-23.md`

- Move EPG from "Out of Scope" to "Epic 6 - In Progress"
- Update v2 Enhancements section with Epic 6 features
- Document viewer channel list removal and admin hamburger menu

### 4.2 Architecture Update
**File:** `architecture.md`

Add new section documenting:
- EPG service (`backend/app/services/epg_service.py`)
- New endpoint `GET /api/epg/now-playing`
- Response format with currentProgram/nextProgram
- 24h caching strategy
- UI changes (header, role-based visibility)

### 4.3 Epics Update
**File:** `epics.md`

Add Epic 6 with stories:
- 6.1: Header Redesign & Branding
- 6.2: EPG Backend Service
- 6.3: EPG Display in Header
- 6.4: Viewer Role - Remove Channel List
- 6.5: Admin Role - Hamburger Menu
- 6.6: Logout Button Fix

### 4.4 Sprint Status Update
**File:** `sprint-status.yaml`

Add Epic 6 and all stories with `backlog` status.

---

## 5. Implementation Handoff

### Scope Classification: Minor

Changes can be implemented directly by development team.

### Handoff Recipients
- **Dev Agent**: Implement Epic 6 stories

### Implementation Sequence
1. Story 6.2: EPG Backend Service (foundation)
2. Story 6.1: Header Redesign & Branding
3. Story 6.3: EPG Display in Header (depends on 6.1, 6.2)
4. Story 6.4: Viewer Role - Remove Channel List
5. Story 6.5: Admin Role - Hamburger Menu
6. Story 6.6: Logout Button Fix

### Success Criteria
- [ ] Header displays "Jon's place" with 50% reduced height
- [ ] Current channel name visible in header
- [ ] EPG "now playing" displays next to channel name
- [ ] Viewers see video only (no channel list)
- [ ] Admins access channels via hamburger menu on all breakpoints
- [ ] Logout button text does not overflow
- [ ] All existing functionality continues to work

---

## 6. Approval

**User Approval:** APPROVED
**Date:** 2026-01-03
**Approved By:** Jon

### Changes Applied:
- [x] PRD updated (Epic 6 features documented)
- [x] Architecture updated (EPG service, endpoint, UI changes)
- [x] Epics updated (Epic 6 with 6 stories added)
- [x] Sprint Status updated (Epic 6 tracking added)

---

## Amendment 1: Story 6.7 Addition

**Date:** 2026-01-03
**Amendment Status:** APPROVED

### Issue Summary
New feature request to add automatic fullscreen behavior on mobile devices when user rotates to landscape orientation.

### Impact Analysis
- **Epic Impact:** Minor addition to Epic 6 (add Story 6.7)
- **Existing Stories:** None affected
- **Technical:** Frontend-only, uses Screen Orientation API + Vidstack fullscreen API

### Story 6.7: Mobile Landscape Auto-Fullscreen

As a mobile user,
I want the video to automatically enter fullscreen when I rotate my device to landscape,
So that I get an immersive viewing experience without manual interaction.

**Acceptance Criteria:**

**Given** I am viewing video on a mobile device in portrait mode
**When** I rotate my device to landscape orientation
**Then** the video player automatically enters fullscreen mode
**And** the transition is smooth without jarring layout shifts

**Given** I am in auto-fullscreen mode (landscape)
**When** I rotate my device back to portrait orientation
**Then** the video exits fullscreen automatically
**And** the normal app layout is restored

**Given** I am on a desktop or tablet (>768px)
**When** I would trigger orientation change
**Then** auto-fullscreen behavior is disabled (desktop/tablet excluded)

**Given** auto-fullscreen is triggered
**When** entering fullscreen
**Then** video controls remain accessible
**And** I can manually exit fullscreen if desired (tap or swipe)

### Implementation Notes
- Use `screen.orientation` API to detect landscape mode
- Call Vidstack's `enterFullscreen()` on orientation change
- Only activate on mobile viewports (<768px)
- Graceful degradation if API not supported

### Amendment Approval
- [x] User approves Story 6.7 addition
- [x] Epics file updated
- [x] Sprint status updated

---

*Generated by Correct Course Workflow*
