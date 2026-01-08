# Sprint Change Proposal - Post-MVP Phase 2 & 3

**Date:** 2026-01-07
**Author:** Jon (via BMAD Correct Course workflow)
**Status:** Pending Approval

---

## Section 1: Issue Summary

### Problem Statement

During post-MVP improvement work on Epic 12, multiple enhancement opportunities and bug fixes were identified that need to be documented and organized for implementation by development agents.

### Context

- **Current Phase:** Post-MVP improvements
- **Active Epic:** Epic 12 (Post-MVP Phase 2)
- **Trigger:** User notes compilation requiring BMAD documentation

### Items Identified

| Category | Count | Items |
|----------|-------|-------|
| New Features | 2 | Highlight modal replay, WebSocket chat |
| Enhancements | 4 | WebM downloads, Themed tooltips, Channel grouping, Favicon |
| Bug Fixes | 4 | Control bar position, Mobile sticky controls, Admin panel layout, Bandwidth removal |
| Tech Debt | 1 | Python type hints with Ty |

---

## Section 2: Impact Analysis

### Epic Impact

| Epic | Impact | Details |
|------|--------|---------|
| Epic 11 | Modification | Story 11.6 updated to remove bandwidth display |
| Epic 12 | Extension | 8 new stories added (12.8-12.15) |
| Epic 13 | New | Created for Chat & Developer Experience (3 stories) |

### Artifact Conflicts

| Artifact | Status | Updates Required |
|----------|--------|------------------|
| PRD | Update | Add FR63-FR74 (12 new functional requirements) |
| Architecture | Update | Add chat WebSocket protocol, Ty tooling, new components |
| epics.md | Update | Modify 11.6, add 12.8-12.15, add Epic 13 |

### Technical Impact

- **Backend:** New chat service, type hints remediation, active users endpoint update
- **Frontend:** New components (ChatPanel, HighlightModal, ThemedTooltip), bug fixes
- **Infrastructure:** New environment variable `CHAT_ENABLED`

---

## Section 3: Recommended Approach

### Selected Path: Direct Adjustment

Extend Epic 12 with polish/fix stories and create Epic 13 for larger new features.

**Rationale:**
- Epic 12's theme is "polish and enhancement" - new stories align well
- Chat is a distinct feature warranting its own epic
- Type hints remediation is developer tooling, fits with chat in "Developer Experience"

### Effort Estimate

| Epic | Stories | Complexity | Effort |
|------|---------|------------|--------|
| Epic 12 extension | 8 stories | Low-Medium | Medium |
| Epic 13 | 3 stories | Medium | Medium |
| **Total** | 11 stories | - | Medium |

### Risk Assessment

| Risk | Level | Mitigation |
|------|-------|------------|
| WebM encoding browser support | Medium | Graceful degradation to MP4 only |
| Dispatcharr grouping API unknown | Medium | Pre-implementation research required |
| Chat complexity creep | Low | Feature-flagged, MVP scope defined |

---

## Section 4: Detailed Change Proposals

### 4.1 Story Modifications

#### Story 11.6: Active Users Tab UI (MODIFIED)

**OLD:**
```
- I see each user with: username, current channel, duration, bitrate (e.g., "8.5 Mbps")
- I see section subtotal: "2 users • 17.0 Mbps"
```

**NEW:**
```
- I see each user with: username, current channel, duration
- I see section count: "2 users"
```

**Rationale:** User requested removal of all bandwidth/bitrate information from Active Users tab.

---

### 4.2 New Epic 12 Stories

| Story | Title | Type | Priority |
|-------|-------|------|----------|
| 12.8 | Highlight Modal Replay Viewer | Feature | High |
| 12.9 | WebM Download Option | Enhancement | Medium |
| 12.10 | Themed CSS Tooltips | Polish | Medium |
| 12.11 | Favicon Setup | Polish | Low |
| 12.12 | Video Control Bar Position Consistency | Bug Fix | Medium |
| 12.13 | Mobile Video Controller Sticky Fix | Bug Fix | Medium |
| 12.14 | Admin Channel Grouping (Dispatcharr) | Enhancement | Medium |
| 12.15 | Admin Panel Mobile/TV Layout Fix | Bug Fix | High |

---

### 4.3 New Epic 13: Chat & Developer Experience

| Story | Title | Type | Priority |
|-------|-------|------|----------|
| 13.1 | WebSocket Chat Backend | Feature | Medium |
| 13.2 | Chat UI Component | Feature | Medium |
| 13.3 | Python Type Hints with Ty | Tech Debt | Medium |

---

### 4.4 PRD Updates

**New Functional Requirements:**

| FR | Description | Epic |
|----|-------------|------|
| FR63 | Users can optionally send and receive chat messages while watching | 13 |
| FR64 | Chat messages are broadcast to all connected users in real-time | 13 |
| FR65 | Users can toggle chat visibility without interrupting video playback | 13 |
| FR66 | Chat feature can be enabled/disabled via environment configuration | 13 |
| FR67 | Users can preview captured highlights in a modal before downloading | 12 |
| FR68 | Users can scrub (seek forward/backward) through highlight previews | 12 |
| FR69 | Users can download highlights in MP4 or WebM format | 12 |
| FR70 | All tooltips display with theme-consistent styling (light/dark mode) | 12 |
| FR71 | Application displays a custom favicon in browser tabs | 12 |
| FR72 | Video control bar maintains consistent position across playback modes | 12 |
| FR73 | Admin can view channels organized in collapsible groups | 12 |
| FR74 | Admin panel displays correctly on mobile and TV devices without overlap | 12 |

---

### 4.5 Architecture Updates

**New Environment Variables:**
- `CHAT_ENABLED` - Enable/disable chat feature (default: false)

**New WebSocket Message Types:**
```
Client → Server: {"type": "chat_message", "content": "string"}
Server → Client: {"type": "chat_message", "username": "string", "content": "string", "timestamp": "ISO8601", "messageId": "uuid"}
Server → Client: {"type": "chat_history", "messages": [...]}
```

**New Components:**
- `frontend/src/components/ChatPanel.tsx`
- `frontend/src/components/ChatMessage.tsx`
- `frontend/src/components/HighlightModal.tsx`
- `frontend/src/components/ThemedTooltip.tsx`
- `backend/app/services/chat_service.py`

**Tooling:**
- Astral Ty for Python type checking
- All future Python code requires complete type annotations

---

## Section 5: Implementation Handoff

### Scope Classification: Moderate

Changes require backlog reorganization but no fundamental replan.

### Handoff Recipients

| Role | Responsibility |
|------|----------------|
| Development Team | Implement stories 12.8-12.15, 13.1-13.3 |
| Development Team | Update Story 11.6 implementation |

### Implementation Order (Suggested)

**Phase 1: Quick Wins (Epic 12 polish)**
1. Story 12.11 - Favicon Setup
2. Story 12.10 - Themed CSS Tooltips
3. Story 12.12 - Control Bar Position Fix

**Phase 2: Bug Fixes (Epic 12)**
4. Story 12.13 - Mobile Controller Sticky Fix
5. Story 12.15 - Admin Panel Layout Fix
6. Story 11.6 - Remove bandwidth (update)

**Phase 3: Features (Epic 12)**
7. Story 12.8 - Highlight Modal Replay
8. Story 12.9 - WebM Download Option
9. Story 12.14 - Channel Grouping (requires research)

**Phase 4: Epic 13**
10. Story 13.3 - Python Type Hints (can run parallel)
11. Story 13.1 - Chat Backend
12. Story 13.2 - Chat UI

### Success Criteria

- [ ] All new stories have implementation artifacts created
- [ ] PRD updated with FR63-FR74
- [ ] Architecture document updated with chat protocol and tooling
- [ ] epics.md updated with all new stories
- [ ] Story 11.6 implementation updated to remove bandwidth
- [ ] Type checking passes with `ty check backend/app`

---

## Approval

**Status:** APPROVED

- [x] User approves Sprint Change Proposal (2026-01-07)
- [x] PRD updated with FR63-FR74
- [x] Architecture document updated with chat protocol and Ty tooling
- [x] epics.md updated with Story 11.6 modification, Stories 12.8-12.15, Epic 13

---

## Appendix: Files to Update

| File | Action |
|------|--------|
| `_bmad-output/prd.md` | Append FR63-FR74 |
| `_bmad-output/architecture.md` | Append chat protocol, Ty tooling section |
| `_bmad-output/project-planning-artifacts/epics.md` | Modify 11.6, append 12.8-12.15, append Epic 13 |
