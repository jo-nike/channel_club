# Sprint Change Proposal: Post-MVP Documentation Reconciliation

**Date:** 2026-01-04
**Requested By:** Jon
**Status:** Approved (Batch Mode)
**Change Type:** Documentation Reconciliation

---

## Section 1: Issue Summary

### Problem Statement

During rapid MVP iteration, Epics 7-11 were implemented with changes and additions that outpaced documentation updates. The BMAD artifacts (Product Brief, Requirements Inventory, Architecture decisions) describe the original MVP scope (Epics 1-6) but don't accurately reflect the current implemented state.

### Core Problem Type

**Misunderstanding of original requirements** → Implementation evolved beyond documented specs through natural iteration

### Evidence

Based on comprehensive codebase audit of Epics 7-11:

| Epic | Documented State | Actual State |
|------|------------------|--------------|
| Epic 7 (ErsatzTV) | Stories documented | Fully implemented with additional features |
| Epic 8 (Plex Auth) | Stories documented | Fully implemented |
| Epic 9 (Logging) | Stories documented | Fully implemented |
| Epic 10 (PWA) | Stories documented | Fully implemented |
| Epic 11 (Admin Modal) | Stories documented | Fully implemented |

**Product Brief Gaps:**
- Still describes "MVP Scope" as Epics 1-5
- Future Vision lists Epics 6-8 as "planned" or "in progress"
- Out of Scope table includes features now implemented
- Authentication section still says "hardcoded credentials"
- Technical stack missing: loguru, vite-plugin-pwa
- Host Journey says "Monitor active viewers (optional future feature)" - now implemented

**Requirements Inventory Gaps:**
- Only has FR1-26 covering Epics 1-5
- No FRs for Epics 6-11 features
- Environment variables list is incomplete
- API endpoints list is incomplete
- Missing ErsatzTV, Plex, PWA, Admin requirements

---

## Section 2: Impact Analysis

### Artifact Impact Summary

| Artifact | Impact Level | Changes Needed |
|----------|--------------|----------------|
| Product Brief | **Major** | Restructure MVP/Post-MVP sections, update Future Vision, update tech stack |
| epics.md Requirements | **Major** | Add FR27-60+ for Epics 6-11, update env vars, update API list |
| sprint-status.yaml | **Minor** | Update all statuses from "review" to "done" |

### No Code Changes Required

This is purely a documentation reconciliation - the code is the source of truth.

---

## Section 3: Recommended Approach

### Selected Path: Direct Adjustment

Apply comprehensive updates to all three artifacts to reflect implemented reality.

### Rationale

1. Code is already complete and working
2. Documentation must match reality for post-MVP development
3. No architectural changes needed
4. Clean slate for future feature planning

---

## Section 4: Detailed Change Proposals

### 4.1 Product Brief Updates

#### 4.1.1 Update Executive Summary

Add after existing paragraph:

```markdown
**Post-MVP Enhancements (Delivered):** The application now includes ErsatzTV movie channel browsing with full EPG grid, Plex OAuth authentication, comprehensive logging infrastructure, PWA installability, and real-time admin dashboard with user presence monitoring.
```

#### 4.1.2 Add New Section: "Delivered Features (Post-MVP)"

Insert after "MVP Scope" section:

```markdown
## Delivered Features (Post-MVP)

The following features were implemented beyond the original MVP scope:

### Epic 6: UI Polish & EPG Integration
- Redesigned header with current channel/programme display
- EPG now-playing information fetched from Dispatcharr XMLTV
- Role-based UI (viewers see video only, no channel list)
- Admin hamburger menu with collapsible channel drawer
- Mobile landscape auto-fullscreen
- Theme picker (light/dark/system)

### Epic 7: ErsatzTV Multi-Channel Movie View
- Separate `/tv` route for ErsatzTV movie channels
- Full EPG grid showing all channels with current/next programmes
- M3U playlist parsing with channel metadata
- XMLTV EPG data parsing and caching
- HLS proxy with URL rewriting for security
- Independent browsing (no multi-client sync)
- Theatre mode with resizable EPG section
- Programme details modal

### Epic 8: Plex Authentication
- Feature-flagged authentication (both methods can be enabled/disabled)
- Plex OAuth popup flow for token acquisition
- QR code login for TV mode
- Server access validation against Plex API
- Role assignment: server owner = admin, configurable defaults
- Coexists with local credential auth

### Epic 9: Comprehensive Logging
- Backend structured logging with loguru (JSON or pretty format)
- Frontend logging utility with configurable levels
- Request/response logging for all API calls
- WebSocket connection lifecycle logging
- Per-service context binding

### Epic 10: Progressive Web App
- Web App Manifest for installability
- Service Worker with Workbox (precaching + runtime caching)
- Standalone display mode (no browser chrome)
- Install prompt UX with 7-day dismiss cooldown
- Offline-capable app shell

### Epic 11: Admin Modal & User Presence
- Unified admin modal accessible from both views
- Real-time active user monitoring
- Stream bitrate tracking per user and totals
- Separated Live TV / ErsatzTV user sections
- Placeholder tabs for User Access and Plugins
- Session-based presence tracking with stale cleanup
```

#### 4.1.3 Update "Out of Scope" Table

Replace current table with:

```markdown
| Feature | Status | Notes |
|---------|--------|-------|
| ~~EPG/Program Guide~~ | **Delivered** | Epic 6 (Live TV header) + Epic 7 (ErsatzTV grid) |
| ~~User registration~~ | **Delivered** | Plex OAuth in Epic 8 |
| ~~Viewer count display~~ | **Delivered** | Epic 11 Active Users tab |
| Multi-channel viewer selection | Deferred | Contradicts admin-controls model |
| Chat functionality | Deferred | v2 consideration |
| Recording/DVR | Never | Handled by Dispatcharr + Plex |
| FFmpeg transcoding | Never | Dispatcharr handles streams |
| VPN management | Never | Not needed with proxy architecture |
| M3U/EPG source management | Never | Done in Dispatcharr/ErsatzTV admin |
```

#### 4.1.4 Update "Future Vision" Section

Replace with:

```markdown
### Future Vision

#### Delivered (Epics 6-11) ✅
- EPG now-playing in header (Epic 6)
- Role-based UI - viewers see video only (Epic 6)
- Admin hamburger menu (Epic 6)
- Theme picker (Epic 6)
- ErsatzTV movie channels with EPG grid (Epic 7)
- Plex OAuth authentication (Epic 8)
- Feature-flagged auth methods (Epic 8)
- Comprehensive logging (Epic 9)
- PWA installability (Epic 10)
- Admin dashboard with user presence (Epic 11)
- Real-time bitrate monitoring (Epic 11)

#### v2 Possibilities
- Simple chat sidebar for viewing parties
- Multiple concurrent viewing rooms
- ErsatzTV synchronized movie night mode
- Integration with Discord for event coordination

#### Explicitly Not Planned
- Replacing Dispatcharr/ErsatzTV functionality
- Complex user management (beyond Plex)
- Payment/subscription features
- Public access (always invite-only)
```

#### 4.1.5 Update "Proposed Solution" Tech Stack

Add to bullet list:

```markdown
- **loguru** for structured backend logging
- **vite-plugin-pwa** for Progressive Web App support
```

#### 4.1.6 Update Host Journey Step 3

Change from:
```markdown
- Monitor active viewers (optional future feature)
```
To:
```markdown
- Monitor active viewers in Admin Modal (Epic 11)
```

#### 4.1.7 Update Key Differentiators

Add new items:

```markdown
6. **PWA Installable**: Friends can install to home screen for app-like experience
7. **ErsatzTV Integration**: Browse movie channels independently with full EPG
8. **Plex Auth**: Friends with Plex access can sign in without credentials
9. **Admin Dashboard**: Real-time visibility into active users and bandwidth
```

---

### 4.2 Epics.md Requirements Inventory Updates

#### 4.2.1 Add New Functional Requirements

Add after FR26:

```markdown
**UI Polish & Branding (FR27-32):**
- FR27: Header displays current channel name and programme
- FR28: Admin can access channel selection via modal
- FR29: Viewers see video-only UI without channel list
- FR30: Mobile devices auto-fullscreen on landscape rotation
- FR31: Users can switch between light/dark/system themes
- FR32: EPG data fetched and cached from Dispatcharr XMLTV

**ErsatzTV Integration (FR33-42):**
- FR33: Users can navigate to ErsatzTV view at /tv route
- FR34: System parses M3U playlists from ErsatzTV
- FR35: System parses XMLTV EPG data from ErsatzTV
- FR36: Users can browse EPG grid with all channels
- FR37: Users can view programme details in modal
- FR38: Users can select channel from sidebar or grid
- FR39: System proxies HLS streams with URL rewriting
- FR40: EPG data auto-refreshes every 5 minutes
- FR41: Users can resize EPG section with drag handle
- FR42: Channel logos proxied through backend

**Plex Authentication (FR43-48):**
- FR43: Users can authenticate via Plex OAuth popup
- FR44: System validates Plex tokens against Plex API
- FR45: System verifies user has access to configured Plex server
- FR46: Server owner automatically receives admin role
- FR47: Auth methods can be independently enabled/disabled
- FR48: Login UI adapts based on enabled auth methods

**Logging & Observability (FR49-52):**
- FR49: Backend logs all operations with structured format
- FR50: Frontend logs API calls and WebSocket events
- FR51: Log level configurable via environment variables
- FR52: Logs output in JSON (production) or pretty (development) format

**Progressive Web App (FR53-56):**
- FR53: App installable via browser Add to Home Screen
- FR54: Installed app runs in standalone mode without browser chrome
- FR55: App shell cached for fast subsequent loads
- FR56: Install prompt shown to new users

**Admin Dashboard (FR57-62):**
- FR57: Admin can access modal from any view
- FR58: Admin can see active users separated by view type
- FR59: Admin can see estimated bitrate per user
- FR60: Admin can see total bandwidth usage
- FR61: User presence tracked via WebSocket connection
- FR62: Stale users automatically cleaned up after timeout
```

#### 4.2.2 Update Environment Configuration

Add new variables:

```markdown
**Epic 6-11 Environment Variables:**
- `LOG_LEVEL` - Backend log level (DEBUG, INFO, WARNING, ERROR)
- `LOG_FORMAT` - Backend format (json, pretty)
- `VITE_LOG_LEVEL` - Frontend log level (debug, info, warn, error)
- `LOCAL_AUTH_ENABLED` - Enable local credential auth (true/false)
- `PLEX_AUTH_ENABLED` - Enable Plex OAuth auth (true/false)
- `PLEX_SERVER_TOKEN` - Admin's Plex server token
- `PLEX_SERVER_MACHINE_ID` - Plex server machine identifier
- `PLEX_DEFAULT_ROLE` - Default role for Plex users (viewer/admin)
- `PLEX_ADMIN_USERS_STR` - Comma-separated admin usernames
- `ERSATZTV_M3U_URL` - ErsatzTV M3U playlist URL
- `ERSATZTV_XMLTV_URL` - ErsatzTV XMLTV EPG URL
- `ERSATZTV_BASE_URL` - ErsatzTV server base URL
```

#### 4.2.3 Update API Boundaries

Add new endpoints:

```markdown
**Epic 6 Endpoints:**
- GET /api/epg/now-playing?channel_id=<uuid> - Get current programme

**Epic 7 Endpoints:**
- GET /api/ersatztv/channels - List all ErsatzTV channels
- GET /api/ersatztv/programmes/{channel_id}?hours=6 - Get programmes
- GET /api/ersatztv/current/{channel_id} - Get current/next programme
- GET /api/ersatztv/stream/{channel_id} - Get HLS manifest (proxied)
- GET /api/ersatztv/segments/{encoded_url} - Proxy HLS segments
- GET /api/ersatztv/logos/{channel_id} - Proxy channel logos

**Epic 8 Endpoints:**
- POST /api/auth/plex - Authenticate via Plex token
- GET /api/auth/config - Get enabled auth methods

**Epic 11 Endpoints:**
- GET /api/admin/active-users - Get active user presence data
```

#### 4.2.4 Add FR Coverage Map Entries

Add to table:

```markdown
| FR27-32 | Epic 6 | UI Polish & EPG header display |
| FR33-42 | Epic 7 | ErsatzTV integration |
| FR43-48 | Epic 8 | Plex authentication |
| FR49-52 | Epic 9 | Logging infrastructure |
| FR53-56 | Epic 10 | PWA support |
| FR57-62 | Epic 11 | Admin dashboard & presence |

**Coverage:** 62/62 FRs mapped (100%)
```

---

### 4.3 Sprint Status Updates

Change all epic statuses from `in-progress` to `done`.
Change all story statuses from `review` to `done`.

---

## Section 5: Implementation Handoff

### Change Scope: Documentation Only

No code changes required. Apply edits to:
1. `product-brief-iptv_viewer2-2025-12-23.md`
2. `epics.md` (Requirements Inventory section)
3. `sprint-status.yaml`

### Success Criteria

- [ ] Product Brief accurately describes delivered features
- [ ] Requirements Inventory includes FR27-62
- [ ] All environment variables documented
- [ ] All API endpoints documented
- [ ] Sprint status reflects completion state

---

## Approval

**Approved:** Yes
**Date:** 2026-01-04
**Approver:** Jon
