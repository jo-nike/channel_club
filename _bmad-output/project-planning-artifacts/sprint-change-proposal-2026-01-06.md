# Sprint Change Proposal: Story 12-4 Highlight Capture

**Project:** iptv_viewer2
**Date:** 2026-01-06
**Triggered by:** Story 12-4 (Highlight Capture - Desktop)
**Status:** APPROVED
**Approved by:** Jon

---

## 1. Issue Summary

### Triggering Story
**Story 12-4: Highlight Capture (Desktop)** — In `review` status, blocked due to architectural limitations.

### Core Problem Statement
**Issue Type:** Failed approach requiring different solution

The browser-based canvas + MediaRecorder approach for capturing video highlights has **fundamental technical limitations** that cannot be resolved with incremental fixes:

| Issue | Root Cause | Fixable in Browser? |
|-------|-----------|---------------------|
| WebM corruption >60s | Init segment orphaned when trimming circular buffer | No — Format limitation |
| Audio muted when player muted | MSE streams bypass Web Audio API routing | No — MSE architecture |
| Quality degradation | Canvas re-encodes decoded video frames | No — Inherent to approach |
| Circular buffer broken | Restart clears chunks instead of rolling | No — WebM format limitation |
| First frame skip | Capture starts before video ready | Yes — Timing fix possible |

**Only 1 of 5 issues is solvable** with the current architecture.

### Supporting Evidence
From `12-4-highlight-capture-desktop.md` Dev Notes:
- Implemented canvas-based capture using MediaRecorder API
- All 723 automated tests pass
- Manual testing revealed corruption, audio issues, and quality problems
- Multiple attempted fixes (recorder restart, readyState checks, GainNode separation) failed

---

## 2. Impact Analysis

### Epic Impact
- **Epic 12 (Post-MVP Phase 2):** In-progress, can complete as planned with story modification
- **Other stories unaffected:** 12-1, 12-2, 12-5, 12-6, 12-7 are independent
- **No new epics required**
- **No epics deferred or removed**

### Artifact Conflicts

#### Architecture Changes Required

| Component | Current | Proposed |
|-----------|---------|----------|
| Capture location | Browser (canvas + MediaRecorder) | Backend (FFmpeg) |
| Buffer storage | Browser memory (JS refs) | Server memory or temp files |
| Save mechanism | Client-side Blob download | API endpoint returns MP4 file |
| New service | N/A | `ChannelRecorderService` |
| New endpoint | N/A | `POST /api/highlight/{channel_id}` |
| Dependencies | None | FFmpeg in Docker container |

#### UI/UX Impact
- **Minimal** — Button stays in same position
- Button behavior changes: click triggers API call instead of client-side save
- Progress indicator shows "Preparing..." instead of buffer fill ring

#### Other Artifacts

| Artifact | Impact |
|----------|--------|
| Dockerfile | Add FFmpeg installation |
| docker-compose.yml | May need volume for temp files |
| .env.example | Add `HIGHLIGHT_ENABLED=true/false` |
| Tests | Replace browser mocks with API mocks |

---

## 3. Recommended Approach

### Selected Path: Direct Adjustment (Server-Side Capture)

| Factor | Assessment |
|--------|------------|
| Approach | Add backend service, new API endpoint, modify frontend to call API |
| Timeline impact | +2-3 stories worth of work |
| Effort | Medium |
| Risk | Low — FFmpeg is proven technology |

### Rationale
1. Server-side FFmpeg is **boring technology that works** — proven reliable
2. Full quality preservation (no re-encoding)
3. Audio works correctly (direct from stream)
4. True circular buffer is trivial with MPEG-TS segments
5. Browser compatibility issues eliminated
6. Implementation effort is manageable

### Alternatives Considered

**Option 2: Rollback & Remove** — Viable but loses feature entirely
**Option 3: Defer to Later Phase** — Viable but feature may never ship

---

## 4. Detailed Change Proposals

### Story 12-4: REWRITE

#### OLD Acceptance Criteria (Browser-Based)
- Canvas-based capture with MediaRecorder
- Circular buffer of WebM chunks
- Client-side download

#### NEW Acceptance Criteria (Server-Based)

1. **Given** I am watching video on desktop, **when** the video player renders, **then** I see a "Save Highlight" button in controls

2. **Given** I am watching on mobile, **when** player renders, **then** the button is NOT visible

3. **Given** backend is recording the active channel, **when** I click "Save Highlight", **then** POST /api/highlight/{channel_id} is called, and I receive an MP4 file download of the last 60 seconds

4. **Given** less than 60 seconds have been recorded, **when** I click "Save Highlight", **then** I receive whatever is available with a toast indicating partial capture

5. **Given** VITE_HIGHLIGHT_BUFFER_SECONDS=90, **when** backend initializes, **then** the ring buffer retains 90 seconds

6. **Given** I am on Live TV OR ErsatzTV view, **when** I click "Save Highlight", **then** the feature works identically

#### New Technical Requirements
- Backend records the stream when any desktop client is watching
- FFmpeg ring buffer maintains last N seconds of the active channel
- API endpoint extracts and returns MP4 segment

---

### Architecture Addition: Highlight Capture Service

```
## Highlight Capture Service

### Overview
Server-side video capture enables saving the last N seconds of any active stream.

### Components
- ChannelRecorderService: Manages FFmpeg processes per active channel
- Ring buffer: Segment-based or fixed-duration recording
- /api/highlight/{channel_id}: Returns extracted MP4

### Implementation
1. When a channel becomes active (admin selects or first viewer):
   - Start FFmpeg process with segment muxer
   - Maintains 60s of segments (6 x 10s segments)

2. On POST /api/highlight:
   - Concatenate recent segments
   - Remux to MP4 with copy codec
   - Return file as download

3. Cleanup:
   - Stop recorder when no viewers for 60s
   - Delete temp segments on stop

### Environment Variables
- HIGHLIGHT_ENABLED: Enable/disable feature (default: true)
- HIGHLIGHT_BUFFER_SECONDS: Buffer duration (default: 60)
- HIGHLIGHT_SEGMENT_SECONDS: Segment size (default: 10)
```

---

### Files to Delete

| File | Reason |
|------|--------|
| `frontend/src/hooks/useHighlightCapture.ts` | Replace with API call |
| `frontend/src/hooks/useHighlightCapture.test.ts` | No longer needed |

### Files to Create

| File | Purpose |
|------|---------|
| `backend/app/services/highlight.py` | ChannelRecorderService |
| `backend/app/routers/highlight.py` | API endpoint |
| Backend tests for new service | |

### Files to Modify

| File | Change |
|------|--------|
| `Dockerfile` | Add FFmpeg installation |
| `frontend/src/components/HighlightButton.tsx` | Call API instead of hook |
| `frontend/src/components/VideoControls.tsx` | Simplify highlight integration |
| `frontend/src/components/ersatztv/ErsatzTVVideoControls.tsx` | Simplify highlight integration |
| `.env.example` files | Add new environment variables |

---

## 5. Implementation Handoff

### Change Scope Classification
**Moderate** — Requires story rewrite and new backend service

### Task Breakdown

1. **Task 1: Create ChannelRecorderService**
   - FFmpeg process management
   - Ring buffer with segment-based recording
   - Cleanup on viewer disconnect

2. **Task 2: Create /api/highlight endpoint**
   - Extract segments and concatenate
   - Remux to MP4
   - Return file download

3. **Task 3: Update Dockerfile**
   - Add FFmpeg installation

4. **Task 4: Simplify frontend**
   - Replace useHighlightCapture hook with API call
   - Update HighlightButton to call endpoint

5. **Task 5: Delete old implementation**
   - Remove canvas/MediaRecorder code
   - Remove old tests

6. **Task 6: Update tests**
   - Backend API tests
   - Frontend API mock tests

7. **Task 7: Manual verification**
   - MP4 downloads with audio
   - Quality matches source
   - Works on both views
   - Desktop only

### Success Criteria
- MP4 downloads correctly with audio
- Quality matches source (no re-encoding in final output)
- Works on both Live TV and ErsatzTV views
- Desktop only (mobile hidden)
- Partial capture works when <60s available

---

## 6. Summary

| Item | Value |
|------|-------|
| **Issue** | Browser-based highlight capture has fundamental limitations |
| **Recommended Path** | Server-side FFmpeg capture |
| **Scope** | Moderate — story rewrite + new backend service |
| **Epic Impact** | Story 12-4 only |
| **PRD Impact** | None — feature preserved, implementation changes |
| **Risk** | Low — FFmpeg is proven technology |
| **Approval** | Approved by Jon on 2026-01-06 |

---

## Change Log

- 2026-01-06: Sprint Change Proposal created and approved
