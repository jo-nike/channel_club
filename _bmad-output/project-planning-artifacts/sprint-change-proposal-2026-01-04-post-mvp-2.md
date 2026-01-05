# Sprint Change Proposal: Post-MVP Phase 2

**Date:** 2026-01-04
**Project:** iptv_viewer2
**Requested By:** Jon
**Status:** Pending Approval

---

## 1. Summary

This proposal defines **Epic 12: Post-MVP Phase 2**, a collection of enhancements building on the completed MVP and Post-MVP Phase 1 (Epics 1-11). The changes focus on:

- Consolidating the unified TV view as the root route
- Admin monitoring capabilities for backend services
- Enhanced TV remote/keyboard navigation for EPG
- Video highlight capture functionality
- UI polish and quality-of-life improvements

**Scope Classification:** Minor-to-Moderate
**Estimated Stories:** 7
**Breaking Changes:** Route change (`/tv` → `/`)

---

## 2. Impact Analysis

### Epic Impact
- **New Epic 12** added to project
- No changes to completed Epics 1-11
- Builds on existing infrastructure from Epics 6, 7, 9, 11

### Artifact Impacts
| Artifact | Impact |
|----------|--------|
| PRD | No changes required |
| Architecture | Minor - new env variables, new admin endpoints |
| UI/UX | Minor - new admin tab, header button, rounded corners |
| Routes | **Breaking** - `/tv` becomes `/`, old `/` removed |

### Technical Dependencies
- Existing EPG infrastructure (Epic 6, 7)
- Existing admin modal (Epic 11)
- Vidstack/hls.js for highlight capture
- ErsatzTV/Dispatcharr APIs (to be explored during story creation)

---

## 3. Recommended Approach

**Direct Adjustment** - Add new stories within a new Epic 12. No rollback or MVP scope changes required.

**Rationale:**
- All features are additive enhancements
- No conflicts with existing functionality
- Low-to-medium complexity per story
- Can be implemented incrementally

**Risk Assessment:** Low
**Timeline Impact:** None (new phase, not interrupting existing work)

---

## 4. Epic 12: Post-MVP Phase 2

### Epic Overview

Users enjoy a polished, consolidated viewing experience with enhanced admin monitoring, keyboard navigation, and video highlight capture.

**Environment Variables (New):**
- `HIGHLIGHT_BUFFER_SECONDS` - Highlight capture buffer duration (default: 60)

---

### Story 12.1: Retire Legacy MainView & Consolidate Routes

As a user,
I want the unified TV view to be the root route,
So that there's one consistent entry point to the application.

**Acceptance Criteria:**

**Given** the current route structure with `/` (old MainView) and `/tv` (unified view)
**When** this story is complete
**Then** the unified TV view is served at `/`
**And** the `/tv` route redirects to `/` for backwards compatibility
**And** the old MainView component is removed
**And** all dead code from the legacy separate views is cleaned up

**Given** a user bookmarked `/tv`
**When** they visit that URL
**Then** they are redirected to `/`

**Given** the admin modal
**When** opened from the unified view
**Then** all tabs are available (Channels, Active Users, User Access, Plugins, Status)

**Technical Notes:**
- Update React Router configuration
- Remove `MainView.tsx` and related components
- Update any hardcoded route references
- Update tests if applicable

---

### Story 12.2: Admin Status Tab - System Health Monitoring

As an admin,
I want to see ErsatzTV and Dispatcharr system status in the admin modal,
So that I can monitor service health and resource usage.

**Acceptance Criteria:**

**Given** I open the admin modal
**When** I navigate to the "Status" tab
**Then** I see status cards for ErsatzTV and Dispatcharr

**Given** ErsatzTV is reachable
**When** viewing its status card
**Then** I see: connection status (Online), active streams, transcoding sessions, CPU usage (if available via API)

**Given** Dispatcharr is reachable
**When** viewing its status card
**Then** I see: connection status (Online), active streams, health metrics (if available via API)

**Given** a service is unreachable
**When** viewing its status card
**Then** I see: connection status (Offline) with error indication

**Given** the status tab is open
**When** I remain on the tab
**Then** status refreshes automatically every 30 seconds

**Pre-Implementation Research (Story Creation Phase):**
- [ ] Explore ErsatzTV Swagger/API for: `/api/statistics`, transcoding endpoints, health endpoints
- [ ] Explore Dispatcharr Swagger at `:9191/swagger/` for: stream stats, health endpoints
- [ ] Document available endpoints and response schemas
- [ ] Finalize which stats are displayable based on API availability

**Technical Notes:**
- New backend endpoints: `GET /api/admin/status/ersatztv`, `GET /api/admin/status/dispatcharr`
- Frontend: New `StatusTab` component in admin modal
- Handle graceful degradation when APIs don't expose certain stats

---

### Story 12.3: EPG Grid D-pad Navigation

As a TV user,
I want to navigate the EPG grid and channel sidebar with arrow keys,
So that I can browse without needing a mouse.

**Acceptance Criteria:**

**Given** I am viewing the EPG grid
**When** I press ↑/↓ arrow keys
**Then** focus moves between channel rows
**And** the focused row is visually highlighted
**And** the grid scrolls to keep focused row visible

**Given** I am viewing the EPG grid
**When** I press ←/→ arrow keys
**Then** focus moves between programme cells in time
**And** the focused cell is visually highlighted
**And** the grid scrolls horizontally to keep focused cell visible

**Given** a programme cell is focused
**When** I press Enter or Space
**Then** the programme details modal opens (not auto-play)

**Given** I am viewing the channel sidebar
**When** I press ↑/↓ arrow keys
**Then** focus moves between channel items
**And** the focused item is visually highlighted

**Given** a channel is focused in the sidebar
**When** I press Enter or Space
**Then** that channel starts playing

**Given** I navigate away from the EPG grid and return
**When** the grid regains focus
**Then** focus returns to the last focused position (or currently playing programme)

**Technical Notes:**
- Use `tabIndex`, `onKeyDown` handlers on grid cells and sidebar items
- Track focused position in component state
- Implement `scrollIntoView` for off-screen focus
- Build on existing 10-foot UI patterns from Epic 4

---

### Story 12.4: Highlight Capture (Desktop)

As a desktop viewer,
I want to save the last minute of video with one click,
So that I can capture memorable moments from live streams.

**Acceptance Criteria:**

**Given** I am watching video on a desktop browser
**When** the video player renders
**Then** I see a "Save Highlight" button in the video controls

**Given** I am watching video on a mobile browser
**When** the video player renders
**Then** the "Save Highlight" button is NOT visible

**Given** I am watching and the buffer has accumulated
**When** I click "Save Highlight"
**Then** the last 60 seconds of video (configurable) is downloaded as an `.mp4` file
**And** the filename format is `highlight-{ISO-timestamp}.mp4`

**Given** I just started watching (less than buffer duration)
**When** I click "Save Highlight"
**Then** whatever has been buffered so far is downloaded
**And** I see a brief toast indicating partial capture (e.g., "Saved 23 seconds")

**Given** the `HIGHLIGHT_BUFFER_SECONDS` env variable is set to 90
**When** the video player initializes
**Then** the buffer retains 90 seconds instead of the default 60

**Given** I am on the Live TV view OR ErsatzTV view
**When** I click "Save Highlight"
**Then** the feature works identically on both views

**Environment Variables:**
- `HIGHLIGHT_BUFFER_SECONDS` - Buffer duration in seconds (default: 60)
- Add to: root `.env`, `backend/.env`, `frontend/.env`, all `.env.example` files

**Technical Notes:**
- Hook into hls.js segment loading events
- Maintain circular buffer of ArrayBuffer segments
- On save: concatenate segments, remux TS→MP4 (use libraries like `mux.js` or `mp4box.js`)
- Create Blob and trigger download
- Desktop detection via user agent or screen size

---

### Story 12.5: Live Channel Change Notification

As a viewer,
I want optional toast notifications when the Live channel changes,
So that I know what's now playing without actively checking.

**Acceptance Criteria:**

**Given** I am viewing any page in the app
**When** I look at the header
**Then** I see a notification toggle button (bell icon) between the theme picker and logout

**Given** notifications are disabled (default)
**When** the Live channel changes via WebSocket
**Then** no toast is shown

**Given** notifications are enabled
**When** the Live channel changes via WebSocket
**Then** a toast appears: "Live channel set to: {channel_name} - {programme_title}"
**And** the toast auto-fades after 5 seconds
**And** the toast is NOT manually dismissible (auto-fade only)

**Given** I click the notification bell
**When** it toggles
**Then** the icon changes (filled = enabled, outline = disabled)
**And** my preference is saved to localStorage

**Given** I reload the page
**When** the app initializes
**Then** my notification preference is restored from localStorage

**Given** no EPG data is available for the channel
**When** the notification shows
**Then** only the channel name is displayed (no programme title)

**Technical Notes:**
- New Zustand store slice for notification preferences
- Toast component (shadcn/ui or custom)
- Bell icon in header (visible on all views)
- Listen to WebSocket `channel_update` messages

---

### Story 12.6: Channel Card EPG Display

As an admin,
I want to see what's currently playing on each channel in the admin modal,
So that I can make informed channel selection choices.

**Acceptance Criteria:**

**Given** I open the admin modal "Channels" tab
**When** the channel list renders
**Then** each channel card shows: logo, number, name, current programme title, progress bar

**Given** a channel has EPG data
**When** its card renders
**Then** the current programme title is displayed
**And** a mini progress bar shows how far into the programme (visual width based on elapsed/total time)

**Given** a channel has no EPG data
**When** its card renders
**Then** "No programme info" is displayed in place of the title
**And** no progress bar is shown

**Given** I open the admin modal
**When** EPG data is fetched
**Then** current programmes for all visible channels are loaded (batch or lazy)

**Given** a programme ends while the modal is open
**When** the next programme starts
**Then** the card updates to show the new programme (refresh interval or WebSocket)

**Technical Notes:**
- Extend existing ChannelCard component
- Reuse `/api/epg/now-playing` endpoint (possibly add batch variant)
- Progress bar: calculate `(now - start) / (end - start) * 100%`

---

### Story 12.7: Rounded Corner UI Polish

As a user,
I want smooth visual transitions where the header, video player, and sidebar meet,
So that the UI feels polished and modern.

**Acceptance Criteria:**

**Given** I am viewing the unified TV view
**When** I look at the junction where header, video player, and channel sidebar meet
**Then** the corners are rounded/smoothed instead of sharp 90° angles

**Given** the sidebar is in collapsed state
**When** viewing the junction
**Then** the rounded corners are appropriately styled for collapsed layout

**Given** the sidebar is in expanded state
**When** viewing the junction
**Then** the rounded corners are appropriately styled for expanded layout

**Given** I am on any screen size (desktop, tablet, mobile)
**When** viewing the junction
**Then** the rounded corners adapt appropriately to the layout

**Technical Notes:**
- CSS changes only (Tailwind classes)
- Apply `rounded-*` classes to header, sidebar, and player container edges
- May need wrapper elements or pseudo-elements for complex junction
- Test both sidebar states

---

## 5. Implementation Handoff

**Scope Classification:** Minor-to-Moderate
**Handoff To:** Development team for direct implementation

### Recommended Implementation Order:

1. **12.1** - Route consolidation (foundational, unblocks others)
2. **12.7** - UI polish (quick win, low risk)
3. **12.6** - Channel card EPG (builds on existing, low complexity)
4. **12.5** - Notifications (standalone, low complexity)
5. **12.3** - D-pad navigation (medium complexity, improves TV experience)
6. **12.2** - Status tab (requires API research first)
7. **12.4** - Highlight capture (highest complexity, save for last)

### Pre-Implementation Tasks:

- [ ] Story 12.2: Research ErsatzTV/Dispatcharr APIs before creating detailed story
- [ ] Story 12.4: Evaluate hls.js segment access and MP4 remuxing libraries

### Success Criteria:

- All 7 stories implemented and tested
- Route `/` serves unified TV view
- Admin status tab shows live service health
- EPG fully navigable via keyboard/remote
- Highlight capture works on desktop for both views
- UI polish complete with smooth junctions

---

## 6. Approval

**Prepared by:** Claude (Correct Course Workflow)
**Date:** 2026-01-04

- [x] **User Approval:** Jon (2026-01-04)

---

*This document was generated by the BMad Method Correct Course workflow.*
