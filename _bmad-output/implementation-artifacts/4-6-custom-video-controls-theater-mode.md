# Story 4.6: Custom Video Controls & Theater Mode

Status: draft

## Story

As a viewer,
I want styled custom video controls and a theater mode,
So that I have an aesthetically pleasing viewing experience with the option to maximize my viewing area.

## Acceptance Criteria

1. **Given** I am watching a stream
   **When** the video player renders
   **Then** I see custom styled controls instead of native browser controls
   **And** controls include: play/pause, volume slider, mute button, fullscreen button, theater mode toggle

2. **Given** I am watching a stream with custom controls visible
   **When** I click the play/pause button
   **Then** playback toggles between playing and paused states
   **And** the button icon updates to reflect current state

3. **Given** I am watching a stream
   **When** I adjust the volume slider or click mute
   **Then** the audio volume changes accordingly
   **And** the volume icon reflects the current level (muted, low, high)

4. **Given** I am watching a stream
   **When** I click the fullscreen button
   **Then** the video enters browser fullscreen mode

5. **Given** I am in normal view mode
   **When** I click the theater mode toggle
   **Then** the video expands to fill the entire viewport
   **And** the header and channel sidebar are hidden
   **And** the theater mode button indicates active state

6. **Given** I am in theater mode
   **When** I click the theater mode toggle again (or press Escape)
   **Then** the view returns to normal layout with header and sidebar visible

7. **Given** I am watching a stream with custom controls
   **When** I haven't interacted for 3 seconds
   **Then** the controls fade out
   **And** moving mouse/pressing key brings them back (relates to Story 4.4)

8. **Given** I am navigating with keyboard/D-pad
   **When** I focus on video control buttons
   **Then** they have visible 10-foot UI focus indicators (min 44px targets)

## Tasks / Subtasks

- [ ] Task 1: Create Custom Controls Component Structure (AC: #1)
  - [ ] Create `frontend/src/components/VideoControls.tsx` component
  - [ ] Define props interface: videoRef, isPlaying, volume, isMuted, isTheaterMode, callbacks
  - [ ] Add container with styled control bar at bottom of video
  - [ ] Write unit tests for component rendering

- [ ] Task 2: Implement Play/Pause Control (AC: #2)
  - [ ] Create PlayPauseButton component
  - [ ] Wire to video element play()/pause() methods
  - [ ] Add play and pause icons (use Lucide icons: Play, Pause)
  - [ ] Handle autoplay blocked state gracefully
  - [ ] Write tests for play/pause toggle

- [ ] Task 3: Implement Volume Controls (AC: #3)
  - [ ] Create VolumeControl component with slider and mute button
  - [ ] Wire to video element volume and muted properties
  - [ ] Add volume icons (Volume, Volume1, Volume2, VolumeX for muted)
  - [ ] Slider updates volume in real-time
  - [ ] Store volume preference in localStorage
  - [ ] Write tests for volume state management

- [ ] Task 4: Implement Fullscreen Button (AC: #4)
  - [ ] Create FullscreenButton component
  - [ ] Use Fullscreen API (requestFullscreen / exitFullscreen)
  - [ ] Add fullscreen icons (Maximize, Minimize)
  - [ ] Detect fullscreen state changes
  - [ ] Write tests for fullscreen toggle

- [ ] Task 5: Implement Theater Mode (AC: #5, #6)
  - [ ] Add theaterMode state to a UI store or lift to MainView
  - [ ] Create TheaterModeButton component with icon (Expand, Shrink)
  - [ ] When active: hide header, hide sidebar, video fills viewport
  - [ ] Add Escape key listener to exit theater mode
  - [ ] Preserve theater mode preference in localStorage
  - [ ] Update MainView to conditionally render header/sidebar based on theater mode
  - [ ] Write tests for theater mode toggle

- [ ] Task 6: Auto-Hide Controls (AC: #7)
  - [ ] Add idle detection (3s timeout)
  - [ ] Fade out controls when idle (opacity transition)
  - [ ] Show controls on mouse move, key press, or touch
  - [ ] Keep controls visible when paused
  - [ ] Hide cursor when controls hidden (desktop)
  - [ ] Write tests for auto-hide behavior

- [ ] Task 7: 10-Foot UI & Keyboard Navigation (AC: #8)
  - [ ] All buttons min 44px touch/focus targets
  - [ ] Add focus-visible ring styling for keyboard navigation
  - [ ] Ensure Tab order is logical (play → volume → fullscreen → theater)
  - [ ] Add keyboard shortcuts: Space (play/pause), M (mute), F (fullscreen), T (theater)
  - [ ] Write tests for keyboard navigation

- [ ] Task 8: Integration & Polish
  - [ ] Integrate VideoControls into VideoPlayer component
  - [ ] Remove `controls` attribute from native video element
  - [ ] Style control bar with semi-transparent background
  - [ ] Add smooth transitions and hover states
  - [ ] Test on desktop, mobile, TV browsers
  - [ ] Verify mpegts.js stream playback still works
  - [ ] Run full test suite - all tests must pass

## Dev Notes

### Architecture Compliance

**Component Location:** `frontend/src/components/VideoControls.tsx`
- Named export: `export function VideoControls()`
- Uses Lucide React for icons (already in project via shadcn/ui)
- Follow existing component patterns in codebase

**State Management:**
- Local state for controls visibility (auto-hide)
- Zustand store for theater mode (persisted) - consider adding to existing UI store or creating `uiStore`
- Video state (playing, volume, muted) derived from video element

### Current VideoPlayer Structure

The current implementation uses mpegts.js with native browser controls:

```typescript
// frontend/src/components/VideoPlayer.tsx
<video
  ref={videoRef}
  controls       // <-- REMOVE this
  autoPlay
  className="h-full w-full"
/>
```

Replace native controls with custom `<VideoControls />` overlay.

### Proposed Component Structure

```
VideoPlayer.tsx
├── VideoPlayerInner
│   ├── <video> (no controls attribute)
│   ├── <BufferingOverlay />
│   ├── <ErrorOverlay />
│   └── <VideoControls />
│       ├── <PlayPauseButton />
│       ├── <VolumeControl />
│       │   ├── <MuteButton />
│       │   └── <VolumeSlider />
│       ├── <FullscreenButton />
│       └── <TheaterModeButton />
```

### Theater Mode Implementation

**MainView Changes:**

```typescript
// frontend/src/components/MainView.tsx
import { useUIStore } from '@/stores/uiStore'

export function MainView() {
  const isTheaterMode = useUIStore((s) => s.isTheaterMode)

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Conditionally hide header in theater mode */}
      {!isTheaterMode && (
        <header>...</header>
      )}

      <main className="flex-1 flex overflow-hidden min-h-0">
        {/* Video takes full width in theater mode */}
        <div className={cn(
          "flex-1 bg-black flex items-center justify-center",
          isTheaterMode && "absolute inset-0 z-50"
        )}>
          <VideoPlayer />
        </div>

        {/* Conditionally hide sidebar in theater mode */}
        {!isTheaterMode && (
          <aside>...</aside>
        )}
      </main>
    </div>
  )
}
```

### UI Store for Theater Mode

```typescript
// frontend/src/stores/uiStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UIState {
  isTheaterMode: boolean
  setTheaterMode: (value: boolean) => void
  toggleTheaterMode: () => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      isTheaterMode: false,
      setTheaterMode: (value) => set({ isTheaterMode: value }),
      toggleTheaterMode: () => set((s) => ({ isTheaterMode: !s.isTheaterMode })),
    }),
    { name: 'ui-storage' }
  )
)
```

### Control Bar Styling

```css
/* Semi-transparent gradient background */
.video-controls {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 1rem;
  background: linear-gradient(transparent, rgba(0,0,0,0.8));
  display: flex;
  align-items: center;
  gap: 1rem;
  transition: opacity 0.3s ease;
}

.video-controls.hidden {
  opacity: 0;
  pointer-events: none;
}

/* 10-foot UI button sizing */
.control-button {
  min-width: 48px;
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.5rem;
  transition: background-color 0.2s;
}

.control-button:hover {
  background-color: rgba(255,255,255,0.1);
}

.control-button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px rgb(78 156 246 / 0.8);
}
```

### Lucide Icons to Use

```typescript
import {
  Play,
  Pause,
  Volume2,    // High volume
  Volume1,    // Low volume
  VolumeX,    // Muted
  Maximize,   // Enter fullscreen
  Minimize,   // Exit fullscreen
  Expand,     // Enter theater mode
  Shrink,     // Exit theater mode
} from 'lucide-react'
```

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space | Toggle play/pause |
| M | Toggle mute |
| F | Toggle fullscreen |
| T | Toggle theater mode |
| Escape | Exit theater mode / exit fullscreen |
| Arrow Up/Down | Volume up/down |
| Arrow Left/Right | Seek (if applicable for live streams) |

### Auto-Hide Logic

```typescript
const [controlsVisible, setControlsVisible] = useState(true)
const timeoutRef = useRef<number>()

const showControls = useCallback(() => {
  setControlsVisible(true)
  if (timeoutRef.current) clearTimeout(timeoutRef.current)
  if (isPlaying) {
    timeoutRef.current = window.setTimeout(() => {
      setControlsVisible(false)
    }, 3000)
  }
}, [isPlaying])

useEffect(() => {
  const handleActivity = () => showControls()
  window.addEventListener('mousemove', handleActivity)
  window.addEventListener('keydown', handleActivity)
  return () => {
    window.removeEventListener('mousemove', handleActivity)
    window.removeEventListener('keydown', handleActivity)
  }
}, [showControls])
```

### Testing Strategy

**Unit Tests:**
- VideoControls renders all buttons
- PlayPauseButton toggles state
- VolumeControl slider changes volume
- Mute button toggles muted state
- Fullscreen button calls requestFullscreen
- Theater mode button toggles store state

**Integration Tests:**
- Controls overlay appears on video
- Auto-hide works after 3 seconds
- Keyboard shortcuts work
- Theater mode hides header/sidebar

**Manual Testing:**
- Verify styling looks good on desktop/mobile/TV
- Test 10-foot UI with actual TV remote
- Verify mpegts.js streams still play correctly
- Test all keyboard shortcuts

### Dependencies

- `lucide-react` - Already installed via shadcn/ui
- `zustand` with `persist` middleware - Already in use
- `mpegts.js` - Existing player, no changes needed to stream handling

### Files to Create

- `frontend/src/components/VideoControls.tsx`
- `frontend/src/components/VideoControls.test.tsx`
- `frontend/src/stores/uiStore.ts`
- `frontend/src/stores/uiStore.test.ts`

### Files to Modify

- `frontend/src/components/VideoPlayer.tsx` - Remove native controls, add VideoControls
- `frontend/src/components/MainView.tsx` - Add theater mode conditional rendering
- `frontend/src/index.css` - Add control bar styling (if not using Tailwind only)

### Related Stories

- Story 4.4: Auto-Hide Video Controls - Overlaps with Task 6, ensure consistency
- Story 4.3: Keyboard & D-pad Navigation - Overlaps with Task 7
- Story 2.3: Video Player with HLS Support - Base implementation we're enhancing

### Anti-Patterns to Avoid

- Do NOT use default exports for components
- Do NOT break mpegts.js stream playback
- Do NOT use inline styles - use Tailwind classes
- Do NOT hardcode timeout values - use constants
- Do NOT forget cleanup in useEffect hooks
- Do NOT block keyboard events from reaching video element when needed

## Dev Agent Record

### Agent Model Used

(To be filled during implementation)

### Completion Notes List

(To be filled during implementation)

### File List

(To be filled during implementation)
