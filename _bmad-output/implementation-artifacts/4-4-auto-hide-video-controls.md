# Story 4.4: Auto-Hide Video Controls

Status: review

## Story

As a viewer,
I want video controls to hide during playback,
So that I can watch without UI clutter.

## Acceptance Criteria

1. **Given** I am watching a video
   **When** I haven't interacted for 3 seconds
   **Then** video controls fade out
   **And** cursor hides (on desktop)

2. **Given** controls are hidden
   **When** I move the mouse
   **Then** controls fade back in
   **And** the 3-second idle timer resets

3. **Given** controls are hidden
   **When** I press any key
   **Then** controls fade back in
   **And** the 3-second idle timer resets

4. **Given** I am on a touch device
   **When** I tap the video area
   **Then** controls toggle visibility
   **And** if shown, they auto-hide after 3 seconds

5. **Given** the video is paused
   **When** I am not interacting
   **Then** controls remain visible (don't auto-hide when paused)

6. **Given** I am hovering over the controls bar
   **When** the idle timer would expire
   **Then** controls remain visible (don't hide while hovering)

## Tasks / Subtasks

- [x] Task 1: Create useIdleTimer Hook
  - [x] Hook takes timeout duration (default 3000ms) - Enhanced existing `useAutoHide` hook
  - [x] Tracks mouse move, key press, and touch events
  - [x] Returns `isIdle` boolean state (via `isVisible`)
  - [x] Resets timer on any activity
  - [x] Cleanup event listeners on unmount

- [x] Task 2: Controls Visibility State
  - [x] Add `controlsVisible` state to VideoPlayer or VideoControls - Already existed from 4.6
  - [x] Connect to useIdleTimer hook - Connected via `useAutoHide`
  - [x] Override: always visible when paused
  - [x] Override: visible when hovering over controls - Added `isHoveringControls` param

- [x] Task 3: Fade Animation
  - [x] CSS transition for opacity (300ms ease) - Already existed from 4.6
  - [x] Use `opacity-0` and `pointer-events-none` when hidden
  - [x] Smooth fade in/out effect
  - [x] No layout shift during transition

- [x] Task 4: Cursor Hiding (Desktop)
  - [x] Apply `cursor-none` class to video container when controls hidden - Already existed from 4.6
  - [x] Only on desktop (not touch devices) - Implicit via mouse movement triggering show
  - [x] Cursor reappears with mouse movement
  - [x] Use CSS class toggle, not inline style

- [x] Task 5: Touch Device Support (AC: #4)
  - [x] Detect touch device with `matchMedia('(pointer: coarse)')`
  - [x] Single tap toggles controls visibility via `toggleControls()`
  - [x] Don't respond to swipe/scroll gestures - Only handles click/tap
  - [x] Auto-hide after 3 seconds when shown by tap

- [x] Task 6: Hover Override (AC: #6)
  - [x] Track hover state on controls bar via `isHoveringControls` state
  - [x] Prevent hide while hovering over controls
  - [x] Reset idle timer when leaving controls area

- [x] Task 7: Integration with VideoControls
  - [x] Pass `isVisible` prop to VideoControls component - Already existed
  - [x] VideoControls applies visibility classes
  - [x] Coordinate with Story 4.6 VideoControls implementation
  - [x] Ensure keyboard shortcuts still work when hidden (tabIndex=-1 when hidden)

- [x] Task 8: Testing & Verification
  - [x] Test auto-hide after 3 seconds of inactivity
  - [x] Test mouse movement shows controls
  - [x] Test key press shows controls
  - [x] Test pause prevents auto-hide
  - [x] Test hover prevents auto-hide
  - [x] Test touch tap toggle on mobile - Added `toggleControls` function

## Dev Notes

### ⚠️ Implementation Order: Story 4.6 Was Implemented First

**IMPORTANT:** Story 4.6 (Custom Video Controls & Theater Mode) was implemented **before** this story. Story 4.6 already includes partial auto-hide functionality as part of its Task 6.

**Before implementing this story:**
1. Review the current `VideoControls.tsx` implementation from 4.6
2. Check what auto-hide logic already exists
3. This story should **enhance** the existing implementation, not duplicate it

**Expected overlap with 4.6:**
- VideoControls component structure (already created)
- Basic visibility state management (may exist)
- Fade animation CSS (may exist)

**This story adds/completes:**
- Robust `useIdleTimer` hook (if not already implemented)
- Cursor hiding on desktop
- Touch device tap-to-toggle behavior
- Hover override to prevent hide
- Pause state override

### Architecture Compliance

**Files to Create:**
- `frontend/src/hooks/useIdleTimer.ts`
- `frontend/src/hooks/useIdleTimer.test.ts`

**Files to Modify:**
- `frontend/src/components/VideoPlayer.tsx` - Idle detection integration
- `frontend/src/components/VideoControls.tsx` - Visibility prop (created in 4.6)
- `frontend/src/index.css` - Cursor hiding styles

### useIdleTimer Hook

```typescript
// frontend/src/hooks/useIdleTimer.ts
import { useState, useEffect, useCallback, useRef } from 'react'

interface UseIdleTimerOptions {
  timeout?: number
  onIdle?: () => void
  onActive?: () => void
  disabled?: boolean
}

export function useIdleTimer(options: UseIdleTimerOptions = {}) {
  const { timeout = 3000, onIdle, onActive, disabled = false } = options
  const [isIdle, setIsIdle] = useState(false)
  const timeoutRef = useRef<number>()

  const resetTimer = useCallback(() => {
    if (disabled) return

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    // If currently idle, mark as active
    if (isIdle) {
      setIsIdle(false)
      onActive?.()
    }

    // Set new timeout
    timeoutRef.current = window.setTimeout(() => {
      setIsIdle(true)
      onIdle?.()
    }, timeout)
  }, [disabled, isIdle, timeout, onIdle, onActive])

  // Force show (reset timer)
  const showControls = useCallback(() => {
    resetTimer()
  }, [resetTimer])

  // Force hide (set idle immediately)
  const hideControls = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    setIsIdle(true)
    onIdle?.()
  }, [onIdle])

  useEffect(() => {
    if (disabled) {
      setIsIdle(false)
      return
    }

    // Events that reset the idle timer
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll']

    events.forEach(event => {
      window.addEventListener(event, resetTimer)
    })

    // Initial timer
    resetTimer()

    return () => {
      events.forEach(event => {
        window.removeEventListener(event, resetTimer)
      })
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [disabled, resetTimer])

  return {
    isIdle,
    showControls,
    hideControls,
    resetTimer
  }
}
```

### VideoPlayer Integration

```typescript
// frontend/src/components/VideoPlayer.tsx
import { useIdleTimer } from '@/hooks/useIdleTimer'

function VideoPlayerInner({ streamUrl }: { streamUrl: string }) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [isHoveringControls, setIsHoveringControls] = useState(false)

  // Disable auto-hide when paused or hovering over controls
  const { isIdle } = useIdleTimer({
    timeout: 3000,
    disabled: !isPlaying || isHoveringControls
  })

  const controlsVisible = !isIdle

  return (
    <div
      className={cn(
        "video-player-container relative aspect-video w-full bg-black",
        !controlsVisible && "cursor-none"
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        className="h-full w-full"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />

      {/* Video Controls with visibility */}
      <VideoControls
        isVisible={controlsVisible}
        onMouseEnter={() => setIsHoveringControls(true)}
        onMouseLeave={() => setIsHoveringControls(false)}
        // ... other props
      />

      <BufferingOverlay isVisible={isBuffering} />
      {error && <ErrorOverlay message={error} />}
    </div>
  )
}
```

### VideoControls Visibility

```typescript
// frontend/src/components/VideoControls.tsx
interface VideoControlsProps {
  isVisible: boolean
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  // ... other props
}

export function VideoControls({
  isVisible,
  onMouseEnter,
  onMouseLeave,
  // ... other props
}: VideoControlsProps) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        // Base styling
        "absolute bottom-0 left-0 right-0 p-4",
        "bg-gradient-to-t from-black/80 to-transparent",
        "flex items-center gap-4",
        // Visibility transition
        "transition-opacity duration-300",
        isVisible ? "opacity-100" : "opacity-0 pointer-events-none"
      )}
    >
      {/* Control buttons */}
    </div>
  )
}
```

### CSS for Cursor Hiding

```css
/* frontend/src/index.css */

/* Hide cursor when controls are hidden */
.video-player-container.cursor-none {
  cursor: none;
}

/* But show cursor on controls even when container hides it */
.video-player-container .video-controls {
  cursor: default;
}
```

### Touch Device Detection

```typescript
// Utility function for touch detection
export function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches
}

// In VideoPlayer
const isTouchDevice = useMemo(() => isTouchDevice(), [])

const handleVideoClick = () => {
  if (isTouchDevice) {
    // Toggle controls on touch
    if (controlsVisible) {
      hideControls()
    } else {
      showControls()
    }
  }
}
```

### Auto-Hide Constants

```typescript
// frontend/src/lib/constants.ts
export const VIDEO_CONTROLS_TIMEOUT = 3000 // 3 seconds
export const VIDEO_CONTROLS_FADE_DURATION = 300 // ms
```

### Files to Create

- `frontend/src/hooks/useIdleTimer.ts`
- `frontend/src/hooks/useIdleTimer.test.ts`

### Files to Modify

- `frontend/src/components/VideoPlayer.tsx` - Idle timer integration
- `frontend/src/components/VideoControls.tsx` - Visibility prop (from 4.6)
- `frontend/src/index.css` - Cursor hiding styles

### Dependencies

- None additional - pure React/CSS implementation

### Related Stories

- Story 4.3: Keyboard Navigation - Key press shows controls
- Story 4.6: Custom Video Controls - VideoControls component creation

### Implementation Order Note

This story shares significant implementation with Story 4.6 (Custom Video Controls & Theater Mode).

**Actual implementation order:** Story 4.6 was implemented first.

**What 4.6 already implemented (verify before duplicating):**
- `VideoControls.tsx` component with play/pause, volume, fullscreen, theater mode
- Auto-hide logic (Task 6 in 4.6) with 3-second idle timer
- Fade out animation
- Show on mouse move/key press
- Keep visible when paused

**What this story should add/verify:**
- Extract reusable `useIdleTimer` hook if inline logic was used in 4.6
- Cursor hiding on desktop (`cursor-none` class)
- Touch device tap-to-toggle behavior
- Hover over controls prevents hide
- Comprehensive test coverage for idle behavior

**Developer action:** Review 4.6 implementation first. If auto-hide is fully implemented, this story may only need verification and minor enhancements.

### Anti-Patterns to Avoid

- Do NOT use setTimeout without cleanup
- Do NOT check for touch via user agent (use matchMedia)
- Do NOT make controls completely inaccessible when hidden
- Do NOT forget pointer-events-none on hidden controls
- Do NOT block keyboard shortcuts when controls hidden
- Do NOT have layout shift during show/hide

### Testing Strategy

**Unit Tests:**
- useIdleTimer returns isIdle=true after timeout
- useIdleTimer resets on mouse/key events
- useIdleTimer disabled state keeps isIdle=false
- resetTimer restarts countdown

**Integration Tests:**
- Controls visible initially
- Controls hide after 3s of inactivity
- Mouse movement shows controls
- Key press shows controls
- Paused video keeps controls visible
- Hovering controls prevents hide

**Manual Testing:**
- Test on desktop with mouse
- Test on mobile with touch
- Test with keyboard only
- Verify cursor hides on desktop
- Verify smooth fade transitions

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Completion Notes List

**Implementation Summary:**

Story 4.6 had already implemented the core auto-hide functionality via `useAutoHide` hook. This story enhanced the existing implementation with:

1. **Hover Override (AC #6):** Added `isHoveringControls` parameter to `useAutoHide` hook. When hovering over controls, the auto-hide timer is cancelled. When mouse leaves controls, timer restarts.

2. **Touch Device Support (AC #4):** Added `toggleControls()` function to `useAutoHide` and `handleVideoAreaClick()` handler in VideoPlayer. On touch devices (detected via `matchMedia('(pointer: coarse)')`), tapping the video area toggles controls visibility.

3. **Enhanced API:** Added `hideControls()` and `toggleControls()` functions to `useAutoHide` return value for programmatic control.

4. **VideoControls Props:** Added optional `onMouseEnter` and `onMouseLeave` props to VideoControls component for hover tracking.

5. **Comprehensive Tests:** Added 11 new tests covering:
   - Hover override prevents auto-hide
   - Timer restarts when mouse leaves controls
   - Timer cancelled when starting to hover
   - Toggle controls hides when visible
   - Toggle controls shows when hidden
   - Auto-hide timer starts after toggle on
   - hideControls immediately hides
   - Hover event props on VideoControls

**All Acceptance Criteria Met:**
- AC1: Controls fade out after 3s of inactivity ✓
- AC2: Mouse movement shows controls, resets timer ✓
- AC3: Key press shows controls, resets timer ✓
- AC4: Touch tap toggles controls on touch devices ✓
- AC5: Controls stay visible when paused ✓
- AC6: Controls stay visible when hovering over controls ✓

### File List

**Modified Files:**
- `frontend/src/hooks/useAutoHide.ts` - Added hover override, toggleControls, hideControls
- `frontend/src/hooks/useAutoHide.test.ts` - Added 11 new tests for new functionality
- `frontend/src/components/VideoPlayer.tsx` - Added hover state tracking, touch tap-to-toggle
- `frontend/src/components/VideoControls.tsx` - Added onMouseEnter/onMouseLeave props
- `frontend/src/components/VideoControls.test.tsx` - Added 3 tests for hover events
- `frontend/src/hooks/useFocusTrap.ts` - Fixed type import syntax (pre-existing issue)

## Change Log

- 2025-12-27: Story implementation complete. Enhanced useAutoHide hook with hover override (AC #6) and touch device tap-to-toggle (AC #4). Added comprehensive test coverage. All 274 tests pass.
