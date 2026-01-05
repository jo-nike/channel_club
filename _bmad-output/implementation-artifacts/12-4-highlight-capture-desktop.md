# Story 12.4: Highlight Capture (Desktop)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a desktop viewer,
I want to save the last minute of video with one click,
So that I can capture memorable moments from live streams.

## Acceptance Criteria

1. **Given** I am watching video on a desktop browser, **when** the video player renders, **then** I see a "Save Highlight" button in the video controls

2. **Given** I am watching video on a mobile browser, **when** the video player renders, **then** the "Save Highlight" button is NOT visible

3. **Given** I am watching and the buffer has accumulated, **when** I click "Save Highlight", **then** the last 60 seconds of video (configurable) is downloaded as an `.mp4` file, and the filename format is `highlight-{ISO-timestamp}.mp4`

4. **Given** I just started watching (less than buffer duration), **when** I click "Save Highlight", **then** whatever has been buffered so far is downloaded, and I see a brief toast indicating partial capture

5. **Given** the `VITE_HIGHLIGHT_BUFFER_SECONDS` env variable is set to 90, **when** the video player initializes, **then** the buffer retains 90 seconds instead of the default 60

6. **Given** I am on the Live TV view OR ErsatzTV view, **when** I click "Save Highlight", **then** the feature works identically on both views

## Tasks / Subtasks

- [ ] Task 1: Create useHighlightCapture Hook (AC: #1, #3, #4, #5)
  - [ ] Create `frontend/src/hooks/useHighlightCapture.ts`
  - [ ] Implement canvas-based video capture with MediaRecorder
  - [ ] Create circular buffer to store last N seconds of chunks
  - [ ] Read buffer duration from `VITE_HIGHLIGHT_BUFFER_SECONDS` env var (default 60)
  - [ ] Implement `startCapture(videoElement)` to begin continuous recording
  - [ ] Implement `saveHighlight()` to download accumulated buffer as MP4
  - [ ] Handle partial capture when buffer < configured duration
  - [ ] Implement codec detection (MP4 for Chrome/Edge, WebM fallback for Firefox)
  - [ ] Return `{ isCapturing, bufferSeconds, saveHighlight, startCapture, stopCapture }`

- [ ] Task 2: Create HighlightButton Component (AC: #1, #2)
  - [ ] Create `frontend/src/components/HighlightButton.tsx`
  - [ ] Use `Video` or `Download` icon from lucide-react
  - [ ] Hide on mobile/touch devices (use `useMediaQuery('(pointer: coarse)')`)
  - [ ] Match existing control button styling (48px min target, focus-visible ring)
  - [ ] Show tooltip with buffer status on hover
  - [ ] Disable button while saving is in progress

- [ ] Task 3: Add Environment Variable (AC: #5)
  - [ ] Add `VITE_HIGHLIGHT_BUFFER_SECONDS=60` to `frontend/.env.example`
  - [ ] Add `VITE_HIGHLIGHT_BUFFER_SECONDS=60` to root `.env.example`
  - [ ] Document in both files with comment
  - [ ] Update `frontend/src/lib/config.ts` or create if needed

- [ ] Task 4: Integrate into VideoControls.tsx (AC: #1, #6)
  - [ ] Import HighlightButton component
  - [ ] Add button between volume controls and fullscreen button
  - [ ] Pass videoRef to enable capture functionality
  - [ ] Only render when not mobile (`!isMobile`)
  - [ ] Wire up useHighlightCapture hook

- [ ] Task 5: Integrate into ErsatzTVVideoControls.tsx (AC: #1, #6)
  - [ ] Import HighlightButton component
  - [ ] Add button in same position as VideoControls
  - [ ] Wire up to Vidstack video element via ref or context
  - [ ] Only render when not mobile

- [ ] Task 6: Add Toast Notification (AC: #4)
  - [ ] Use existing toast/sonner component if available
  - [ ] Show success toast with filename when download starts
  - [ ] Show info toast for partial capture with duration saved
  - [ ] Show error toast if capture fails

- [ ] Task 7: Write Tests (AC: #1-6)
  - [ ] Create `frontend/src/hooks/useHighlightCapture.test.ts`
  - [ ] Test buffer accumulation logic
  - [ ] Test codec detection
  - [ ] Test partial capture scenario
  - [ ] Mock MediaRecorder API
  - [ ] Create `frontend/src/components/HighlightButton.test.tsx`
  - [ ] Test visibility based on device type
  - [ ] Test click handler
  - [ ] Update `VideoControls.test.tsx` with highlight button tests
  - [ ] Update `ErsatzTVVideoControls.test.tsx` with highlight button tests

- [ ] Task 8: Verify and Test
  - [ ] Run `npm run build` - no errors
  - [ ] Run `npm run test` - all tests pass
  - [ ] Manual test: Button visible on desktop Chrome
  - [ ] Manual test: Button hidden on mobile (use devtools)
  - [ ] Manual test: Click saves MP4 file
  - [ ] Manual test: Partial capture toast appears when < 60 sec watched
  - [ ] Manual test: Works on Live TV view
  - [ ] Manual test: Works on ErsatzTV view
  - [ ] Manual test: Firefox downloads WebM (fallback)

## Dev Notes

### Technical Approach: Canvas + MediaRecorder

Based on 2025-2026 research, the most viable browser-native approach for HLS stream capture is:

1. **Capture video frames to canvas** using `requestAnimationFrame` loop
2. **Create MediaStream from canvas** using `canvas.captureStream(15)` (15 FPS for performance)
3. **Record with MediaRecorder** using circular buffer of chunks
4. **Trim buffer to last N seconds** before download

**Why not direct video.captureStream()?**
- HLS streams played via hls.js or native browser may have CORS restrictions
- Canvas approach works universally regardless of stream source

### Implementation Architecture

```typescript
// Hook structure
interface HighlightCaptureState {
  isCapturing: boolean
  bufferSeconds: number  // Current buffer duration
  maxBufferSeconds: number  // Configured max
  isSaving: boolean
}

interface HighlightCaptureActions {
  startCapture: (video: HTMLVideoElement, canvas: HTMLCanvasElement) => void
  stopCapture: () => void
  saveHighlight: () => Promise<void>
}
```

### Codec Detection Pattern

```typescript
const getSupportedMimeType = (): string => {
  const types = [
    'video/mp4; codecs="avc1.42E01E"',  // H.264 - Chrome/Edge/Safari
    'video/webm; codecs=vp9',             // VP9 - Firefox/Chrome
    'video/webm',                          // Basic WebM fallback
  ]
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ''  // Browser default
}
```

### Circular Buffer Implementation

```typescript
interface ChunkWithTime {
  data: Blob
  timestamp: number  // When this chunk was recorded
}

// On new chunk:
chunks.push({ data: event.data, timestamp: Date.now() })

// Trim old chunks:
const cutoffTime = Date.now() - (maxBufferSeconds * 1000)
while (chunks.length > 0 && chunks[0].timestamp < cutoffTime) {
  chunks.shift()
}
```

### Current Video Player Analysis

**VideoPlayer.tsx (Live TV - mpegts.js):**
- Uses `mpegts.Player` for MPEG-TS streams
- videoRef is `useRef<HTMLVideoElement>(null)` at line 40
- VideoControls receives `videoRef` as prop (line 274-290)
- Controls positioned at `bottom-12` or `bottom-24` in theater mode

**HLSVideoPlayer.tsx (ErsatzTV - Vidstack):**
- Uses `@vidstack/react` MediaPlayer component
- Vidstack manages video element internally
- PlayerControlsWrapper accesses video via `useMediaRemote()`
- Need to get video element from Vidstack for capture

**Control Button Styling (must match):**
```tsx
className="control-button flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/80"
```

### Mobile Detection Pattern (existing)

```typescript
// From VideoControls.tsx:40-43
const isTouchDevice = useMediaQuery('(pointer: coarse)')
const isMobileQuery = useMediaQuery('(max-width: 768px)')
const isMobile = isMobileProp || isMobileQuery || isTouchDevice
```

### Environment Variable Access

```typescript
// Frontend env vars via Vite
const BUFFER_SECONDS = parseInt(
  import.meta.env.VITE_HIGHLIGHT_BUFFER_SECONDS || '60',
  10
)
```

### Browser Compatibility Notes

| Browser | MediaRecorder MP4 | Canvas captureStream | Status |
|---------|-------------------|---------------------|--------|
| Chrome 52+ | Yes | Yes | Full support |
| Edge 79+ | Yes | Yes | Full support |
| Firefox 43+ | No (WebM only) | Yes | WebM fallback |
| Safari 14+ | Partial | Partial | May require testing |

### Filename Format

```typescript
const getHighlightFilename = (): string => {
  const now = new Date()
  const iso = now.toISOString().replace(/[:.]/g, '-')  // Safe for filesystem
  return `highlight-${iso}.mp4`
}
// Example: highlight-2026-01-05T10-30-45-123Z.mp4
```

### Performance Considerations

1. **Canvas FPS**: Use 15-20 FPS (not 30) to reduce CPU load
2. **Chunk timeslice**: 100-200ms chunks for manageable buffer size
3. **Memory**: 60 seconds at 15 FPS ~ 100-150MB memory (acceptable)
4. **Start/stop**: Begin capture when video starts playing, stop on unmount

### Project Structure Notes

**Files to Create:**
- `frontend/src/hooks/useHighlightCapture.ts` - Main capture hook
- `frontend/src/hooks/useHighlightCapture.test.ts` - Hook tests
- `frontend/src/components/HighlightButton.tsx` - UI component
- `frontend/src/components/HighlightButton.test.tsx` - Component tests

**Files to Modify:**
- `frontend/src/components/VideoControls.tsx` - Add button
- `frontend/src/components/ersatztv/ErsatzTVVideoControls.tsx` - Add button
- `frontend/.env.example` - Add VITE_HIGHLIGHT_BUFFER_SECONDS
- `.env.example` - Add VITE_HIGHLIGHT_BUFFER_SECONDS

### Previous Story Intelligence (12-3)

From story 12-3 (EPG Grid D-pad Navigation):
- Use `focus-visible:ring-2 focus-visible:ring-ring` for focus states
- Maintain 44px minimum touch targets (10-foot UI requirement)
- Co-locate test files with source files
- Pattern: Create hooks for complex stateful logic

### Potential Risks

1. **CORS on canvas** - If video source has restrictive CORS, canvas may be "tainted"
   - Mitigation: Try/catch and show user-friendly error

2. **Memory consumption** - Long buffer durations could exhaust memory
   - Mitigation: Cap buffer at 120 seconds max, clear on component unmount

3. **Safari compatibility** - Safari's MediaRecorder support is limited
   - Mitigation: Graceful degradation, hide button if MediaRecorder not fully supported

4. **Vidstack video access** - May need custom approach to get video element
   - Mitigation: Research Vidstack API for video element access

### References

- [Source: frontend/src/components/VideoControls.tsx:1-135] - Current control button patterns
- [Source: frontend/src/components/ersatztv/ErsatzTVVideoControls.tsx:1-143] - Vidstack control integration
- [Source: frontend/src/components/VideoPlayer.tsx:1-337] - Live TV player (mpegts.js)
- [Source: frontend/src/components/ersatztv/HLSVideoPlayer.tsx:1-214] - ErsatzTV player (Vidstack)
- [Source: _bmad-output/project-context.md] - Naming conventions, TypeScript rules
- [Source: _bmad-output/project-planning-artifacts/epics.md#story-124] - Original requirements
- [Source: frontend/.env.example] - Environment variable patterns

### Testing Checklist

- [ ] `npm run build` succeeds
- [ ] `npm run test` passes
- [ ] Button visible on desktop (manual test)
- [ ] Button hidden on mobile (manual test)
- [ ] MP4 downloads on Chrome/Edge (manual test)
- [ ] WebM downloads on Firefox (manual test)
- [ ] Partial capture toast works (manual test)
- [ ] Works on Live TV view (manual test)
- [ ] Works on ErsatzTV view (manual test)
- [ ] No console errors during capture (manual test)
- [ ] Memory stable during long sessions (manual test)

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-01-05: Story 12.4 created by BMad workflow - ready for implementation
