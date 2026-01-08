# Story 12.8: Highlight Modal Replay Viewer

Status: review

## Story

As a viewer,
I want to preview highlights in a modal before downloading,
So that I can review the captured moment and scrub through it.

## Acceptance Criteria

1. **Given** I am watching video on desktop, **when** I click the "Highlight" button, **then** a modal opens with an embedded video player **and** the background video volume is lowered to 20%

2. **Given** the highlight modal is open, **when** I view the player, **then** I see the last 60 seconds (or configured buffer) of captured video **and** I can play/pause the replay **and** I can scrub forward/backward through the clip **and** playback controls include a timeline scrubber

3. **Given** the highlight modal is open, **when** I click "Download MP4", **then** the highlight downloads as `highlight-{channel_id}-{ISO-timestamp}.mp4`

4. **Given** the highlight modal is open, **when** I close the modal (X button, Escape, or click outside), **then** the modal closes **and** the background video volume restores to previous level

5. **Given** I am on mobile, **when** the video player renders, **then** the Highlight button is NOT visible (desktop only)

## Tasks / Subtasks

- [x] Task 1: Create HighlightModal Component (AC: #1, #2, #3, #4)
  - [x] Create `frontend/src/components/HighlightModal.tsx`
  - [x] Use shadcn/ui Dialog for modal structure
  - [x] Add close button (X), Escape key handling, click-outside to close
  - [x] Accept `isOpen`, `onClose`, `channelId`, `onVolumeChange` props
  - [x] Fetch highlight video from backend on open

- [x] Task 2: Implement Embedded Video Player (AC: #2)
  - [x] Use native HTML5 `<video>` element with controls
  - [x] Set video src to blob URL from saved highlight
  - [x] Enable native controls (play/pause, timeline scrub, volume)
  - [x] Auto-play on modal open
  - [x] Clean up blob URL on modal close

- [x] Task 3: Implement Volume Ducking (AC: #1, #4)
  - [x] Store previous volume on modal open
  - [x] Set background video volume to 20% when modal opens
  - [x] Restore previous volume when modal closes
  - [x] Pass volume control callback from parent component

- [x] Task 4: Add Download Button (AC: #3)
  - [x] Add "Download MP4" button below video player
  - [x] Reuse existing download logic from HighlightButton
  - [x] Show loading state during download
  - [x] Display toast on successful download

- [x] Task 5: Modify HighlightButton to Open Modal (AC: #1)
  - [x] Change click handler to open modal instead of direct download
  - [x] Pass channelId to modal
  - [x] Handle volume callback from modal

- [x] Task 6: Integrate with VideoControls (AC: #1, #5)
  - [x] Import HighlightModal
  - [x] Add modal state management
  - [x] Pass video element ref for volume control
  - [x] Keep mobile detection logic (desktop only)

- [x] Task 7: Integrate with ErsatzTVVideoControls (AC: #1, #5)
  - [x] Import HighlightModal
  - [x] Add modal state management
  - [x] Pass video element ref for volume control
  - [x] Keep mobile detection logic (desktop only)

- [x] Task 8: Write Frontend Tests
  - [x] Create `frontend/src/components/HighlightModal.test.tsx`
  - [x] Test modal open/close behavior
  - [x] Test volume ducking
  - [x] Test download functionality
  - [x] Test keyboard navigation (Escape to close)
  - [x] Update HighlightButton.test.tsx for new behavior

- [x] Task 9: Build and Test
  - [x] Run `npm run test` - all tests pass (723/723)
  - [x] Run `npm run build` - builds successfully
  - [x] Manual testing on desktop browsers

## Dev Notes

### Architecture

The modal builds on the existing highlight infrastructure from story 12-4. The server-side FFmpeg capture remains unchanged - this story only modifies the frontend UX.

**Data Flow:**
1. User clicks Highlight button → Modal opens
2. Modal fetches highlight from `POST /api/highlight/{channelId}`
3. Response is converted to blob URL for video playback
4. User can preview, scrub, then download
5. On close, blob URL is revoked

### Volume Ducking Pattern

```tsx
// In parent component (VideoControls or ErsatzTVVideoControls)
const videoRef = useRef<HTMLVideoElement>(null)
const [previousVolume, setPreviousVolume] = useState(1)

const handleModalOpen = () => {
  if (videoRef.current) {
    setPreviousVolume(videoRef.current.volume)
    videoRef.current.volume = 0.2
  }
}

const handleModalClose = () => {
  if (videoRef.current) {
    videoRef.current.volume = previousVolume
  }
}
```

### Modal Component Structure

```tsx
<Dialog open={isOpen} onOpenChange={onClose}>
  <DialogContent className="max-w-3xl">
    <DialogHeader>
      <DialogTitle>Highlight Preview</DialogTitle>
    </DialogHeader>

    <video
      ref={previewVideoRef}
      src={highlightBlobUrl}
      controls
      autoPlay
      className="w-full rounded-lg"
    />

    <DialogFooter>
      <Button onClick={handleDownload} disabled={isDownloading}>
        {isDownloading ? <Loader2 className="animate-spin" /> : <Download />}
        Download MP4
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### Project Structure Notes

**Files to Create:**
- `frontend/src/components/HighlightModal.tsx`
- `frontend/src/components/HighlightModal.test.tsx`

**Files to Modify:**
- `frontend/src/components/HighlightButton.tsx` - Change to open modal
- `frontend/src/components/VideoControls.tsx` - Add modal + volume control
- `frontend/src/components/ersatztv/ErsatzTVVideoControls.tsx` - Add modal + volume control

### Dependencies

- Builds on story 12-4 (Highlight Capture Desktop) - must be complete
- Uses existing `/api/highlight/{channelId}` endpoint
- Uses shadcn/ui Dialog component

### References

- [Source: _bmad-output/implementation-artifacts/12-4-highlight-capture-desktop.md] - Existing highlight implementation
- [Source: backend/app/routers/highlight.py] - API endpoints
- [Source: frontend/src/components/HighlightButton.tsx] - Current button implementation

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None

### Completion Notes List

- Created HighlightModal component with shadcn/ui Dialog for preview playback
- Modal fetches highlight video on open and converts to blob URL for video element
- Implemented volume ducking: background video volume reduces to 20% when modal opens, restores on close
- Download button reuses existing save logic with toast notifications for success/partial capture
- Modified HighlightButton to accept onOpenModal callback instead of direct download
- Integrated modal state management into both VideoControls and ErsatzTVVideoControls
- Used Vidstack remote API for volume control in ErsatzTV, direct videoRef for standard controls
- Created comprehensive test suite for HighlightModal (13 tests) covering all functionality
- Updated HighlightButton tests to reflect new modal-opening behavior (11 tests)
- All 723 frontend tests pass, build succeeds

### File List

**New Files:**
- frontend/src/components/HighlightModal.tsx
- frontend/src/components/HighlightModal.test.tsx

**Modified Files:**
- frontend/src/components/HighlightButton.tsx
- frontend/src/components/HighlightButton.test.tsx
- frontend/src/components/VideoControls.tsx
- frontend/src/components/ersatztv/ErsatzTVVideoControls.tsx

## Change Log

- 2026-01-07: Implemented Highlight Modal Replay Viewer (Story 12.8) - Added modal preview with video playback, volume ducking, and download functionality
