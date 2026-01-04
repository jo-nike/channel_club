# Sprint Change Proposal: Progressive Web App (PWA) Support

**Date:** 2026-01-04
**Project:** iptv_viewer2
**Proposed by:** Jon
**Change Type:** New Requirement
**Scope Classification:** Minor

---

## 1. Issue Summary

### Problem Statement
The IPTV viewer would benefit from Progressive Web App (PWA) capabilities to provide a more app-like experience on mobile and TV devices. Currently users access the app via browser URL, which shows browser chrome and doesn't feel native.

### Context
- Identified during sprint review as an enhancement opportunity
- All 8 existing epics are in-progress with stories in review status
- No blocking issues or conflicts with current work

### Evidence & Rationale
| Factor | Assessment |
|--------|------------|
| User Experience | PWA removes browser chrome, enhances TV 10-foot experience |
| Installation | Friends can install to home screen without app store |
| Mobile | Complements existing mobile features (auto-fullscreen) |
| Effort | Low - vite-plugin-pwa handles most boilerplate |

---

## 2. Impact Analysis

### Epic Impact
| Epic | Status | Impact |
|------|--------|--------|
| Epic 1-8 | In-progress | **No impact** - PWA is additive |
| **New Epic 9** | Proposed | Add PWA capabilities |

### Story Impact
- No existing stories affected
- 3 new stories proposed in Epic 9

### Artifact Conflicts
| Artifact | Status |
|----------|--------|
| epics.md | **Update required** - add Epic 9 |
| sprint-status.yaml | **Update required** - add Epic 9 tracking |
| PRD | N/A - not present |
| Architecture | N/A - not present |
| UX Design | N/A - not present |

### Technical Impact
| Area | Impact |
|------|--------|
| Frontend | Add vite-plugin-pwa, manifest.json, service worker |
| Backend | None |
| Docker | None - service worker is static asset |
| API | None |

---

## 3. Recommended Approach

### Selected Path: Add New Epic

**Rationale:**
1. **Clean separation** - PWA doesn't fit existing epic themes
2. **Low effort** - 3 stories, approximately 1-2 development sessions
3. **Low risk** - vite-plugin-pwa is well-documented
4. **High value** - Significantly improves TV/mobile experience
5. **No blockers** - Current review work continues unaffected

### Effort & Risk Assessment
| Factor | Level |
|--------|-------|
| Implementation Effort | Low |
| Technical Risk | Low |
| Timeline Impact | None |
| Team Disruption | None |

---

## 4. Detailed Change Proposals

### Proposal 1: Add Epic 9 to epics.md

**File:** `_bmad-output/project-planning-artifacts/epics.md`
**Location:** End of file (after Epic 8)

```markdown
---

## Epic 9: Progressive Web App (PWA)

Users can install the app on their devices for a native-like experience with offline-capable shell and enhanced TV integration.

**Key Features:**
- Web App Manifest for installability
- Service Worker for app shell caching
- Standalone display mode (no browser chrome)
- Install prompt UX
- Optimized icons for various platforms

**Technical Approach:**
- Use vite-plugin-pwa for generation
- NetworkFirst strategy for API, CacheFirst for static assets
- Minimal offline support (login state, UI shell)

---

### Story 9.1: PWA Manifest & Icons

As a user,
I want the app to be installable on my device,
So that I can launch it like a native app without browser chrome.

**Acceptance Criteria:**

**Given** I visit the app on mobile or desktop
**When** the browser detects the PWA manifest
**Then** browser shows "Add to Home Screen" option

**Given** the manifest.json file
**When** inspected
**Then** it includes: name, short_name, icons (192x192, 512x512), start_url, display: standalone, theme_color, background_color

**Given** I install the PWA
**When** I launch from home screen
**Then** app opens in standalone mode without browser UI

---

### Story 9.2: Service Worker & Caching

As a user,
I want the app shell to load quickly,
So that I see UI immediately even on slow connections.

**Acceptance Criteria:**

**Given** vite-plugin-pwa is configured
**When** the app builds
**Then** a service worker is generated with precaching for app shell assets

**Given** static assets (JS, CSS, images)
**When** requested after first load
**Then** they are served from cache (CacheFirst strategy)

**Given** API requests
**When** fetching channels or streams
**Then** network is preferred with optional fallback (NetworkFirst)

**Given** the user is offline
**When** they launch the installed PWA
**Then** they see the app shell with "Network unavailable" message

---

### Story 9.3: Install Prompt UX

As a user,
I want to be prompted to install the app,
So that I know the install option exists.

**Acceptance Criteria:**

**Given** I am on a supported browser and haven't installed the PWA
**When** I visit the app
**Then** an unobtrusive install prompt appears (banner or button)

**Given** I click "Install" on the prompt
**When** the browser install flow triggers
**Then** the app is added to my device

**Given** I have already installed or dismissed
**When** I visit again
**Then** the install prompt does not reappear

**Given** I am on a TV browser
**When** viewing the app
**Then** install prompt is keyboard/d-pad accessible
```

---

### Proposal 2: Update sprint-status.yaml

**File:** `_bmad-output/implementation-artifacts/sprint-status.yaml`
**Location:** After Epic 8 entries

```yaml
  # Epic 9: Progressive Web App (PWA)
  epic-9: backlog
  9-1-pwa-manifest-icons: backlog
  9-2-service-worker-caching: backlog
  9-3-install-prompt-ux: backlog
  epic-9-retrospective: optional
```

---

## 5. Implementation Handoff

### Scope Classification: Minor

This change can be implemented directly by the development team without requiring backlog reorganization or strategic replan.

### Handoff Plan

| Role | Responsibility |
|------|---------------|
| **Developer** | Implement Epic 9 stories using `/create-story` workflow |
| **User (Jon)** | Approve this proposal, then apply edits to artifacts |

### Action Items

1. **Immediate:** Apply Edit Proposal 1 - Add Epic 9 to epics.md
2. **Immediate:** Apply Edit Proposal 2 - Add Epic 9 entries to sprint-status.yaml
3. **When ready:** Run `/create-story` to generate story 9.1 file
4. **Develop:** Implement PWA using vite-plugin-pwa

### Success Criteria

- [ ] PWA installable on Chrome (desktop & mobile)
- [ ] PWA installable on Android TV browsers
- [ ] Standalone mode launches without browser chrome
- [ ] Install prompt appears for new users
- [ ] App shell loads from cache on repeat visits

---

## Approval

**Status:** Approved
**Approved by:** Jon
**Date:** 2026-01-04

---

## Post-Approval Notes

**Adjustment:** During application, Epic 9 was discovered to already contain "Comprehensive Logging & Observability". PWA was renumbered to **Epic 10** accordingly.

Files updated:
- `_bmad-output/project-planning-artifacts/epics.md` - Added Epic 10 (PWA)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` - Added Epic 9 & 10 tracking entries
