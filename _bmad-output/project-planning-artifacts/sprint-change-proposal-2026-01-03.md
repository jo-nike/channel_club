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

## Amendment 2: Epic 7 - ErsatzTV Multi-Channel Movie View

**Date:** 2026-01-03
**Amendment Status:** APPROVED
**Change Type:** New Epic (Post-MVP Feature)
**Scope Classification:** Moderate

---

### Issue Summary

**Problem Statement:**
The current iptv_viewer2 application successfully implements live TV viewing via Dispatcharr, but lacks the multi-channel movie view feature that existed in the prototype (`/home/jon/Code/iptv_viewer`). This feature allows users to browse and watch continuous movie channels served via ErsatzTV, with a full EPG grid showing what's playing now and next across all channels.

**Context:**
- MVP (Epics 1-6) is complete and working well
- User wants to reimplement the ErsatzTV feature from the prototype
- This is a post-MVP enhancement, not a bug fix or scope change
- ErsatzTV server running at `http://192.168.50.108:8409`

---

### Impact Analysis

**Epic Impact:**
| Epic | Impact | Description |
|------|--------|-------------|
| Epics 1-6 | None | Existing functionality unaffected |
| **Epic 7 (NEW)** | Addition | New epic for ErsatzTV integration |

**Artifact Changes:**
| Artifact | Impact | Changes Needed |
|----------|--------|----------------|
| `epics.md` | Addition | Add Epic 7 with 13 stories |
| Config | Addition | Add ErsatzTV environment variables |
| PRD | None | Post-MVP feature |
| Architecture | Minor | Document ErsatzTV integration (optional) |

**Technical Impact:**
- **Backend:** New services (M3U parser, XMLTV parser, HLS proxy, API endpoints)
- **Frontend:** React Router, vidstack HLS player, new UI components
- **Dependencies:** Add `react-router-dom` to frontend

---

### Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Streaming Format | HLS Segmenter | Best program boundary handling |
| Player Library | vidstack | Already installed, supports HLS |
| Channel Parsing | M3U format | More metadata (logo, group, etc.) |
| Sync Mode | Independent | Simpler MVP, "movie night" mode deferred |
| Route | `/ersatztv` | Separate from live TV |

---

### Epic 7: Story Breakdown (13 Stories)

**Phase 1 - Backend Foundation (6 stories):**

**Story 7.1: ErsatzTV Configuration & Models**
- Add `ERSATZTV_M3U_URL`, `ERSATZTV_XMLTV_URL`, `ERSATZTV_BASE_URL` to config
- Create `backend/app/models/ersatztv.py` with EPGChannel, Programme models

**Story 7.2: M3U Parser Service**
- Port from `/home/jon/Code/iptv_viewer/app/epg/parser.py`
- Parse ErsatzTV M3U playlist
- Extract: channel_id, name, stream_url, logo_url, number, group
- 1-hour TTL caching

**Story 7.3: XMLTV Parser Service**
- Port from `/home/jon/Code/iptv_viewer/app/epg/xmltv_parser.py`
- Parse ErsatzTV XMLTV EPG data
- Extract: id, channel_id, title, description, start, stop, category
- 5-minute TTL caching

**Story 7.4: EPG Service Layer**
- Port from `/home/jon/Code/iptv_viewer/app/epg/service.py`
- Combine M3U and XMLTV data
- Provide: `get_channels()`, `get_current_programme()`, `get_programmes_by_channel()`

**Story 7.5: HLS Proxy Service**
- Port from `/home/jon/Code/iptv_viewer/app/streaming/hls_rewriter.py`
- Rewrite HLS manifest URLs to proxy through backend
- Base64 URL encoding for segment paths

**Story 7.6: ErsatzTV API Endpoints**
- Create `backend/app/routers/ersatztv.py`
- Endpoints: channels, programmes, current, stream, segments, logos

**Phase 2 - Frontend Foundation (3 stories):**

**Story 7.7: React Router Setup**
- Add `react-router-dom` dependency
- Configure `/` (live TV) and `/ersatztv` routes
- Auth protection on both routes

**Story 7.8: Vidstack HLS Player Component**
- Create `frontend/src/components/ersatztv/HLSVideoPlayer.tsx`
- Use vidstack for HLS playback
- Controls, buffering states, error handling

**Story 7.9: ErsatzTV Store & API Service**
- Create Zustand store for ErsatzTV state
- Create API service for ErsatzTV endpoints
- TypeScript interfaces

**Phase 3 - UI Components (4 stories):**

**Story 7.10: EPG Channel Sidebar**
- List channels with logo, name, number
- Show current programme per channel
- Click to select and play

**Story 7.11: EPG Grid Component**
- Time slots header (30-min intervals)
- Channel rows with programmes positioned by time
- "Now" marker line

**Story 7.12: Programme Details Modal**
- Title, time range, description, category
- "Watch" button to switch channel

**Story 7.13: ErsatzTV Main View**
- Header with back navigation
- HLS video player (vidstack)
- EPG grid below video
- Responsive design

---

### Environment Variables to Add

```bash
ERSATZTV_M3U_URL=http://192.168.50.108:8409/iptv/channels.m3u8
ERSATZTV_XMLTV_URL=http://192.168.50.108:8409/iptv/xmltv.xml
ERSATZTV_BASE_URL=http://192.168.50.108:8409
```

---

### Pre-Implementation Requirements

- [ ] Configure ErsatzTV to use **HLS Segmenter** streaming mode
- [ ] Verify ErsatzTV endpoints accessible from dev environment
- [ ] Add environment variables to `.env` file

---

### Implementation Order

```
Phase 1 (Backend - 6 stories):
  7.1 → 7.2 + 7.3 (parallel) → 7.4 → 7.5 → 7.6

Phase 2 (Frontend Foundation - 3 stories):
  7.7 → 7.8 + 7.9 (parallel)

Phase 3 (UI - 4 stories):
  7.10 + 7.11 + 7.12 (parallel) → 7.13
```

---

### Success Criteria

- [ ] Users can access `/ersatztv` route
- [ ] EPG grid displays all ErsatzTV channels with current/next programmes
- [ ] Clicking a channel starts HLS playback via vidstack
- [ ] Programme details modal shows full information
- [ ] Responsive design works on desktop and mobile

---

### Post-MVP Considerations (Deferred)

- Synced "movie night" mode (WebSocket coordination)
- Picture-in-picture mode
- Favorites/recently watched
- Quality selector for HLS streams

---

### Amendment 2 Approval

- [x] User approves Epic 7 addition
- [x] Epics file updated with Epic 7 (13 stories added)
- [x] Sprint status: Not required (post-MVP epic)

---

*Generated by Correct Course Workflow*
