# Story 12.9: WebM Download Option

Status: done

## Story

As a user,
I want the option to download highlights in WebM format,
So that I can choose a more web-optimized format.

## Acceptance Criteria

1. **Given** the highlight modal is open, **when** I view the download options, **then** I see two buttons: "Download MP4" and "Download WebM"

2. **Given** I click "Download WebM", **when** the download initiates, **then** the highlight downloads as `highlight-{channel_id}-{ISO-timestamp}.webm`

3. **Given** the browser does not support WebM encoding, **when** the modal renders, **then** only "Download MP4" is shown (graceful degradation)

## Tasks / Subtasks

- [x] Task 1: Research WebM Conversion Options (AC: #2, #3)
  - [x] Investigate FFmpeg WebM encoding on backend
  - [x] Research ffmpeg.wasm for client-side conversion
  - [x] Assess performance impact and choose approach
  - [x] Document decision in Dev Notes

- [x] Task 2: Add Backend WebM Endpoint (if server-side chosen) (AC: #2)
  - [x] Add `GET /api/highlight/{channel_id}/webm` endpoint
  - [x] Use FFmpeg to remux/transcode to WebM (VP9 + Opus)
  - [x] Return WebM file with appropriate headers
  - [x] Add format parameter to existing endpoint alternatively

- [x] Task 3: Update API Service (AC: #2)
  - [x] Add `saveHighlightWebM(channelId)` function to `frontend/src/services/api.ts`
  - [x] Handle WebM response and blob creation

- [x] Task 4: Add WebM Detection Utility (AC: #3)
  - [x] Create function to detect WebM encoding support
  - [x] Check MediaRecorder.isTypeSupported for fallback info
  - [x] Export from utils or create dedicated hook

- [x] Task 5: Update HighlightModal with WebM Button (AC: #1, #3)
  - [x] Add "Download WebM" button next to "Download MP4"
  - [x] Conditionally render based on WebM support detection
  - [x] Handle WebM download with loading state
  - [x] Generate correct filename with .webm extension

- [x] Task 6: Write Backend Tests (if server-side) (AC: #2)
  - [x] Add WebM endpoint tests to `backend/tests/routers/test_highlight.py`
  - [x] Test successful WebM generation
  - [x] Test error handling

- [x] Task 7: Write Frontend Tests (AC: #1, #3)
  - [x] Update HighlightModal.test.tsx with WebM tests
  - [x] Test dual button rendering
  - [x] Test graceful degradation when WebM unsupported
  - [x] Test WebM download functionality

- [x] Task 8: Build and Test
  - [x] Run `uv run pytest` - all tests pass (441 tests)
  - [x] Run `npm run test` - all tests pass (729 tests)
  - [x] Run `npm run build` - builds successfully
  - [x] Manual testing - WebM download verified working

## Dev Notes

### Architecture Decision: Server-Side FFmpeg

**Recommended Approach:** Server-side WebM encoding using FFmpeg

**Rationale:**
1. FFmpeg is already installed and used for highlight capture (story 12-4)
2. Server-side avoids client CPU usage and memory constraints
3. Consistent output quality across all browsers
4. No additional frontend dependencies (ffmpeg.wasm is ~25MB)

**Alternative (Client-Side):**
- ffmpeg.wasm could be used but adds significant bundle size
- MediaRecorder WebM encoding requires re-encoding from MP4

### FFmpeg WebM Encoding Command

```bash
ffmpeg -i highlight.mp4 -c:v libvpx-vp9 -crf 30 -b:v 0 \
       -c:a libopus -b:a 128k \
       -movflags +faststart highlight.webm
```

For faster remux (if source is already compatible):
```bash
ffmpeg -i highlight.mp4 -c:v copy -c:a copy highlight.webm
```

### API Endpoint Options

**Option A: Separate Endpoint**
```
POST /api/highlight/{channel_id}        → MP4
POST /api/highlight/{channel_id}/webm   → WebM
```

**Option B: Format Parameter**
```
POST /api/highlight/{channel_id}?format=mp4
POST /api/highlight/{channel_id}?format=webm
```

**Recommendation:** Option B (format parameter) - cleaner, single endpoint

### Browser Support Detection

```typescript
function isWebMSupported(): boolean {
  // Check if browser can play WebM
  const video = document.createElement('video')
  return video.canPlayType('video/webm; codecs="vp9"') !== ''
}
```

### Modal Button Layout

```tsx
<DialogFooter className="flex gap-2">
  <Button onClick={handleDownloadMP4} disabled={isDownloading}>
    <Download className="mr-2 h-4 w-4" />
    Download MP4
  </Button>
  {isWebMSupported() && (
    <Button onClick={handleDownloadWebM} variant="outline" disabled={isDownloading}>
      <Download className="mr-2 h-4 w-4" />
      Download WebM
    </Button>
  )}
</DialogFooter>
```

### Project Structure Notes

**Files to Modify:**
- `backend/app/routers/highlight.py` - Add format parameter or WebM endpoint
- `backend/app/services/highlight.py` - Add WebM encoding method
- `frontend/src/services/api.ts` - Add WebM API function
- `frontend/src/components/HighlightModal.tsx` - Add WebM button

**Files to Create:**
- None (modifications only)

### Dependencies

- Depends on story 12-8 (Highlight Modal) - must be complete
- Uses existing FFmpeg infrastructure from story 12-4
- libvpx and libopus codecs must be available in FFmpeg build

### WebM vs MP4 Comparison

| Format | Pros | Cons |
|--------|------|------|
| MP4 (H.264) | Universal support, fast encoding | Larger file size |
| WebM (VP9) | Smaller files, open format | Slower encoding, less iOS support |

### References

- [Source: backend/app/services/highlight.py] - Existing FFmpeg implementation
- [Source: backend/app/routers/highlight.py] - Current MP4 endpoint
- [Source: frontend/src/components/HighlightModal.tsx] - Modal (from 12-8)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None

### Completion Notes List

- **Task 1 (Research):** Selected server-side FFmpeg approach over client-side ffmpeg.wasm. FFmpeg already in use for highlight capture. Server-side avoids 25MB client bundle and client CPU usage.
- **Task 2 (Backend):** Added `format` query parameter to `POST /api/highlight/{channel_id}`. Defaults to "mp4". Supports "webm" with VP9 video (libvpx-vp9) and Opus audio (libopus). WebM encoding uses fast settings (-deadline realtime, -cpu-used 4) with 120s timeout. Uses `asyncio.to_thread()` to run FFmpeg without blocking the event loop.
- **Task 3 (API Service):** Updated `saveHighlight()` to accept optional `format` parameter. Added `saveHighlightWebM()` convenience function. Export `HighlightFormat` type.
- **Task 4 (WebM Detection):** Added `isWebMSupported()` utility to `lib/utils.ts`. Checks video.canPlayType for 'video/webm; codecs="vp9"'.
- **Task 5 (UI):** Added "Download WebM" outline button next to "Download MP4" in HighlightModal. Button conditionally rendered based on WebM support. Both buttons disabled during any download.
- **Task 6 (Backend Tests):** Added 3 new tests: explicit mp4 format, webm format, invalid format (422).
- **Task 7 (Frontend Tests):** Added WebM Download Functionality test suite with 4 tests: dual button rendering, graceful degradation, WebM download trigger, button disable state.

### File List

**Modified:**
- `backend/app/services/highlight.py` - Added format parameter to save_highlight, WebM FFmpeg encoding
- `backend/app/routers/highlight.py` - Added format query parameter, WebM content-type handling
- `backend/tests/routers/test_highlight.py` - Added WebM endpoint tests
- `frontend/src/services/api.ts` - Added format parameter, saveHighlightWebM function, HighlightFormat type
- `frontend/src/lib/utils.ts` - Added isWebMSupported function
- `frontend/src/lib/utils.test.ts` - Added isWebMSupported tests
- `frontend/src/components/HighlightModal.tsx` - Added WebM button, conditional rendering
- `frontend/src/components/HighlightModal.test.tsx` - Added WebM Download Functionality tests

**Created:**
- None

### Change Log

- 2026-01-08: Fixed event loop blocking during WebM encoding - now uses asyncio.to_thread()
- 2026-01-07: Implemented WebM download option with server-side FFmpeg encoding (Story 12.9)
