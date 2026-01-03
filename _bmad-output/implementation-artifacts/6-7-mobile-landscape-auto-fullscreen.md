# Story 6.7: Mobile Landscape Auto-Fullscreen

Status: review

## Story

As a mobile user,
I want the video to automatically enter fullscreen when I rotate my device to landscape,
so that I get an immersive viewing experience without manual interaction.

## Acceptance Criteria

1. **Landscape rotation triggers fullscreen**: When viewing video on a mobile device in portrait mode and rotating to landscape orientation, the video player automatically enters fullscreen mode
2. **Smooth transition**: The transition is smooth without jarring layout shifts
3. **Portrait rotation exits fullscreen**: When in auto-fullscreen mode (landscape) and rotating back to portrait orientation, the video exits fullscreen automatically and the normal app layout is restored
4. **Desktop/tablet excluded**: On desktop or tablet (>768px), auto-fullscreen behavior is disabled
5. **Controls remain accessible**: When auto-fullscreen is triggered, video controls remain accessible
6. **Manual exit possible**: User can manually exit fullscreen if desired (tap or swipe)

## Tasks / Subtasks

- [x] Task 1: Create useOrientationFullscreen hook (AC: #1, #2, #3, #4)
  - [x] Create `frontend/src/hooks/useOrientationFullscreen.ts`
  - [x] Detect mobile device using media query `(max-width: 768px)` AND `(pointer: coarse)`
  - [x] Use Screen Orientation API (`screen.orientation`) for orientation detection
  - [x] Add fallback to `window.matchMedia('(orientation: landscape)')` for broader support
  - [x] Listen for `orientationchange` or `screen.orientation.change` events
  - [x] Request fullscreen on landscape, exit fullscreen on portrait
  - [x] Track whether fullscreen was triggered by orientation (vs manual) to prevent conflicts
- [x] Task 2: Integrate hook into VideoPlayer component (AC: #5, #6)
  - [x] Import and use `useOrientationFullscreen` in VideoPlayer
  - [x] Pass containerRef to the hook for fullscreen element
  - [x] Ensure manual fullscreen exit still works
  - [x] Preserve existing keyboard shortcut (F for fullscreen)
- [x] Task 3: Handle edge cases (AC: #2, #6)
  - [x] Handle case where fullscreen request is denied (browser policy)
  - [x] Handle case where user manually exits fullscreen in landscape (don't re-enter)
  - [x] Debounce orientation changes to prevent rapid toggling
  - [x] Handle iOS Safari fullscreen quirks if any
- [x] Task 4: Add tests (all ACs)
  - [x] Unit test hook with mocked Screen Orientation API
  - [x] Test that desktop users are not affected
  - [x] Test that orientation change triggers fullscreen toggle

## Dev Notes

### Architecture Compliance

- **Component location**: `frontend/src/components/VideoPlayer.tsx`
- **New hook location**: `frontend/src/hooks/useOrientationFullscreen.ts`
- **Styling**: Tailwind CSS (existing player styles)
- **Naming**: camelCase with `use` prefix for hooks
- **Export**: Named export for hook

### Technical Implementation

**Screen Orientation API Approach:**

The [Screen Orientation API](https://developer.mozilla.org/en-US/docs/Web/API/Screen/orientation) is the modern way to detect orientation changes:

```typescript
// Detect orientation type
if ('orientation' in screen) {
  screen.orientation.addEventListener('change', () => {
    const isLandscape = screen.orientation.type.startsWith('landscape')
    // Handle orientation change
  })
}
```

**Fallback for older browsers:**

```typescript
// Fallback using matchMedia
const landscapeQuery = window.matchMedia('(orientation: landscape)')
landscapeQuery.addEventListener('change', (e) => {
  const isLandscape = e.matches
  // Handle orientation change
})
```

**Mobile detection:**

```typescript
// Combine viewport width with touch capability
const isMobile = () => {
  const isSmallScreen = window.matchMedia('(max-width: 768px)').matches
  const isTouchDevice = window.matchMedia('(pointer: coarse)').matches
  return isSmallScreen && isTouchDevice
}
```

**Hook signature:**

```typescript
interface UseOrientationFullscreenOptions {
  containerRef: RefObject<HTMLElement>
  enabled?: boolean // Allow disabling the feature
}

interface UseOrientationFullscreenReturn {
  isOrientationFullscreen: boolean // Currently in orientation-triggered fullscreen
}

export function useOrientationFullscreen(options: UseOrientationFullscreenOptions): UseOrientationFullscreenReturn
```

**Key implementation details:**

1. Track `wasTriggeredByOrientation` state to differentiate from manual fullscreen
2. If user manually exits fullscreen while in landscape, set a flag to prevent auto-re-entry until they go back to portrait
3. Use `document.fullscreenElement` to check current fullscreen state
4. Use `containerRef.current.requestFullscreen()` and `document.exitFullscreen()`

**Integration into VideoPlayer:**

The hook should be used in `VideoPlayerInner` component (where containerRef exists):

```typescript
// In VideoPlayerInner
useOrientationFullscreen({
  containerRef,
  enabled: true, // Could be made configurable via settings later
})
```

### Previous Story Intelligence (6-6)

From 6-6 (Logout Button Fix):
- Successfully used responsive Tailwind classes (`px-4 md:px-6`, `text-base md:text-lg`)
- Used `whitespace-nowrap` and `shrink-0` for preventing layout issues
- Verified 44px minimum touch target (h-12 = 48px)
- All tests pass with Vitest

### Existing Fullscreen Handling

Current VideoPlayer.tsx already has fullscreen handling (lines 129-138):

```typescript
// Fullscreen toggle
const handleFullscreenToggle = useCallback(() => {
  const container = containerRef.current
  if (!container) return

  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {})
  } else {
    container.requestFullscreen().catch(() => {})
  }
}, [])
```

And fullscreen change tracking (lines 152-161):

```typescript
useEffect(() => {
  const handleFullscreenChange = () => {
    setIsFullscreen(!!document.fullscreenElement)
  }

  document.addEventListener('fullscreenchange', handleFullscreenChange)
  return () => {
    document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }
}, [])
```

The new hook should integrate with this existing state, not duplicate it.

### Browser Compatibility Notes

**Screen Orientation API Support:**
- Chrome: Full support
- Firefox: Full support
- Safari: Limited (use matchMedia fallback)
- Edge: Full support

**Fullscreen API:**
- All modern browsers support it
- Safari iOS: Uses `webkitRequestFullscreen` (may need vendor prefix check)

**iOS Safari Considerations:**
- iOS Safari has quirky fullscreen behavior for video
- The video element may need to use `videoElement.webkitEnterFullscreen()` on iOS
- Test on actual iOS device

### Project Structure Notes

Files to create/modify:
- `frontend/src/hooks/useOrientationFullscreen.ts` - NEW hook
- `frontend/src/hooks/useOrientationFullscreen.test.ts` - NEW tests
- `frontend/src/components/VideoPlayer.tsx` - Import and use hook

### Testing Requirements

**Unit tests for useOrientationFullscreen:**
```typescript
describe('useOrientationFullscreen', () => {
  it('should not enable on desktop (>768px)')
  it('should not enable on non-touch devices')
  it('should request fullscreen on landscape orientation')
  it('should exit fullscreen on portrait orientation')
  it('should not re-enter fullscreen if user manually exited')
  it('should handle missing Screen Orientation API gracefully')
})
```

### References

- [Source: frontend/src/components/VideoPlayer.tsx#129-138] - Existing fullscreen toggle
- [Source: frontend/src/components/VideoPlayer.tsx#152-161] - Fullscreen change tracking
- [Source: _bmad-output/project-context.md#10-Foot-UI-Rules] - Touch target requirements
- [MDN: Screen Orientation API](https://developer.mozilla.org/en-US/docs/Web/API/Screen/orientation)
- [videojs-landscape-fullscreen npm](https://www.npmjs.com/package/videojs-landscape-fullscreen) - Reference implementation pattern

### Key Considerations

1. **Don't break existing functionality**: Manual fullscreen button and F key shortcut must continue working
2. **Mobile-only feature**: Desktop and tablet users should not experience any changes
3. **Graceful degradation**: If APIs not available, feature simply doesn't activate
4. **No jarring UX**: Smooth transitions, debounce rapid changes
5. **User control**: User can always manually exit fullscreen

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None - implementation completed without issues.

### Completion Notes List

- Created `useOrientationFullscreen` hook that automatically enters fullscreen when mobile users rotate to landscape
- Hook uses Screen Orientation API with matchMedia fallback for broad browser support
- Mobile detection uses both viewport width (max-width: 768px) AND touch capability (pointer: coarse)
- Implemented debouncing (100ms) to prevent rapid fullscreen toggling on quick orientation changes
- Added manual exit tracking - if user exits fullscreen while in landscape, won't auto-re-enter until they return to portrait
- Added webkit-prefixed fallbacks for Safari compatibility (webkitRequestFullscreen, webkitExitFullscreen, webkitfullscreenchange)
- Integrated hook into VideoPlayerInner component - existing manual fullscreen (F key) continues to work
- Added global matchMedia and screen.orientation mocks to test setup for consistent test behavior
- All 8 hook tests pass: desktop exclusion, non-touch exclusion, fullscreen enter/exit, manual exit handling, API fallback, disabled prop, debouncing
- All 328 frontend tests pass, build successful, lint clean

### File List

- frontend/src/hooks/useOrientationFullscreen.ts (NEW)
- frontend/src/hooks/useOrientationFullscreen.test.ts (NEW)
- frontend/src/components/VideoPlayer.tsx (MODIFIED - added hook import and usage)
- frontend/src/test/setup.ts (MODIFIED - added matchMedia and screen.orientation mocks)

### Change Log

- 2026-01-03: Implemented mobile landscape auto-fullscreen feature (Story 6-7)
