# Story 12.13: Mobile Video Controller Sticky Fix

Status: review

## Story

As a mobile user,
I want consistent video controller behavior,
So that controls work the same way on Live TV and ErsatzTV.

## Acceptance Criteria

1. **Given** I am on mobile viewing Live TV, **when** I interact with video controls, **then** controls appear and auto-hide after inactivity

2. **Given** I am on mobile viewing ErsatzTV, **when** I interact with video controls, **then** controls behave identically to Live TV (same show/hide timing)

3. **Given** I tap to show controls on either view, **when** controls are visible, **then** they are NOT "sticky" (they auto-hide after 3 seconds of inactivity)

4. **Given** I scroll or interact with EPG on ErsatzTV, **when** controls are visible, **then** they hide appropriately and don't interfere with scrolling

## Tasks / Subtasks

- [x] Task 1: Analyze Current Mobile Control Behavior (AC: #1, #2, #3, #4)
  - [x] Test current Live TV mobile controls behavior (auto-hide timing)
  - [x] Test current ErsatzTV mobile controls behavior (auto-hide timing)
  - [x] Identify differences in behavior between the two views
  - [x] Document the expected unified behavior (3s auto-hide)

- [x] Task 2: Review useAutoHide Hook Logic (AC: #3)
  - [x] Analyze `frontend/src/hooks/useAutoHide.ts` implementation
  - [x] Verify auto-hide timeout is consistent (3 seconds)
  - [x] Check if any conditions cause controls to become "sticky"
  - [x] Identify any mobile-specific logic differences

- [x] Task 3: Review VideoControls Component (AC: #1)
  - [x] Analyze `frontend/src/components/VideoControls.tsx` for mobile behavior
  - [x] Check touch event handling and control visibility logic
  - [x] Verify consistent behavior with `isMobile` prop

- [x] Task 4: Review ErsatzTVVideoControls Component (AC: #2)
  - [x] Analyze `frontend/src/components/ersatztv/ErsatzTVVideoControls.tsx`
  - [x] Compare implementation with VideoControls for differences
  - [x] Ensure same auto-hide timing and behavior

- [x] Task 5: Fix DualModeVideoPlayer Control Integration (AC: #1, #2)
  - [x] Review `frontend/src/components/tv/DualModeVideoPlayer.tsx`
  - [x] Ensure both LiveVideoPlayer and HLSVideoPlayerWrapper use consistent control handling
  - [x] Verify touch toggle behavior is identical for both player types

- [x] Task 6: Fix EPG Scroll Interference (AC: #4)
  - [x] Review TVView.tsx for control/EPG interaction on mobile
  - [x] Ensure EPG scroll doesn't trigger control visibility
  - [x] Test that swiping on EPG area doesn't affect video controls

- [x] Task 7: Testing and Verification
  - [x] Run `npm run build` to verify no errors
  - [x] Run `npm run test` to verify all tests pass
  - [x] Manual test on mobile device (or mobile emulation)
  - [x] Verify 3-second auto-hide timing on both views

## Dev Notes

### Current Architecture Analysis

The video control system uses a layered approach:

**Control Components:**
- `VideoControls.tsx` (line 27-153) - Controls for Live TV (mpegts.js player)
- `ErsatzTVVideoControls.tsx` - Controls for ErsatzTV (HLS/Vidstack player)

**Auto-hide Hook:**
- `useAutoHide.ts` - Hook that manages control visibility with timeout logic

**Player Wrapper:**
- `DualModeVideoPlayer.tsx` (line 35-79) - Switches between players based on channel type

### Key Files to Modify

| File | Purpose | Potential Issue |
|------|---------|-----------------|
| `frontend/src/hooks/useAutoHide.ts` | Auto-hide timeout logic | May have inconsistent timeout or "sticky" conditions |
| `frontend/src/components/VideoControls.tsx` | Live TV controls | Touch event handling may differ |
| `frontend/src/components/ersatztv/ErsatzTVVideoControls.tsx` | ErsatzTV controls | May not use same auto-hide parameters |
| `frontend/src/components/tv/DualModeVideoPlayer.tsx` | Player wrapper | May pass different props to control components |
| `frontend/src/components/tv/TVView.tsx` | Main view container | EPG/control event isolation |

### Expected Unified Behavior

1. **Tap to show**: Single tap on video area shows controls
2. **Auto-hide after 3s**: Controls fade out after 3 seconds of inactivity
3. **Touch interaction resets timer**: Any touch on controls resets the 3s timer
4. **EPG isolation**: Scrolling/interacting with EPG grid should NOT affect video controls

### Implementation Strategy

**Approach: Audit and Unify**

1. **Audit `useAutoHide.ts`**: Verify timeout is 3000ms consistently
2. **Check for "sticky" conditions**: Look for cases where auto-hide is prevented
3. **Unify control components**: Ensure both VideoControls and ErsatzTVVideoControls use identical auto-hide parameters
4. **Test EPG isolation**: Ensure event propagation doesn't cause unwanted control visibility changes

### Mobile Detection

Both control components use:
```tsx
const isTouchDevice = useMediaQuery('(pointer: coarse)')
const isMobileQuery = useMediaQuery('(max-width: 768px)')
const isMobile = isMobileProp || isMobileQuery || isTouchDevice
```

This should be consistent, but verify both components have identical logic.

### Auto-hide Timeout Constant

The auto-hide timeout should be defined as a constant (likely 3000ms = 3 seconds). Check that:
- Both player types use the same timeout value
- The timeout is not being overridden or extended inappropriately
- Touch events properly reset (not cancel) the timeout

### Testing Checklist

- [ ] Live TV controls appear on tap (mobile)
- [ ] Live TV controls auto-hide after 3 seconds
- [ ] ErsatzTV controls appear on tap (mobile)
- [ ] ErsatzTV controls auto-hide after 3 seconds
- [ ] Scrolling EPG doesn't show/hide video controls
- [ ] Both views: tapping controls keeps them visible (resets timer)
- [ ] Both views: controls hide during video playback (no user interaction)

### Project Structure Notes

- All changes should be within existing component/hook files
- No new files expected
- Follow existing Tailwind/React patterns
- Use `cn()` utility for conditional class merging if needed

### References

- [Source: frontend/src/components/VideoControls.tsx] - Live TV controls
- [Source: frontend/src/components/ersatztv/ErsatzTVVideoControls.tsx] - ErsatzTV controls
- [Source: frontend/src/hooks/useAutoHide.ts] - Auto-hide hook
- [Source: frontend/src/components/tv/DualModeVideoPlayer.tsx:35-79] - Player component
- [Source: frontend/src/components/tv/TVView.tsx:336-360] - EPG scroll container
- [Source: epics.md#Story-12.13] - Original story requirements

### Previous Story Intelligence

**From Story 12.7 (Rounded Corner UI Polish):**
- TVView structure is stable
- 663 frontend tests passing
- Build succeeds with no errors

**From Recent Git Commits:**
- `58c23f2` - highlight feature (video controls modified)
- `88e0b3a` - bunch of small fix + toast on channel change

### Architecture Compliance

- Uses React hooks pattern (useAutoHide)
- Uses existing component structure
- No new dependencies required
- Follows existing mobile detection patterns (`useMediaQuery`)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None - no issues encountered during implementation.

### Completion Notes List

**Root Cause Analysis:**
- Live TV (`LiveVideoPlayer`) had `handleVideoAreaClick` that called `toggleControls()` for touch devices
- ErsatzTV (`HLSControlsWrapper`) was missing this touch toggle handler
- Result: ErsatzTV controls appeared "sticky" because users couldn't tap to dismiss them

**Fix Applied:**
- Added touch toggle handler to `HLSControlsWrapper` in `DualModeVideoPlayer.tsx` (lines 463-485)
- Uses same pattern as `LiveVideoPlayer`: detect touch device and call `toggleControls()` on video area click
- EPG scroll isolation already correctly implemented (EPG in separate container from video player)

**Verification:**
- Build: ✓ Success with no errors
- Tests: ✓ All 704 tests pass
- Auto-hide timing: Consistent 3000ms (3 seconds) via `AUTO_HIDE_DELAY_MS` constant in `useAutoHide.ts`

### File List

- `frontend/src/components/tv/DualModeVideoPlayer.tsx` (modified)

### Change Log

- 2026-01-07: Added touch toggle handler to `HLSControlsWrapper` for consistent mobile control behavior between Live TV and ErsatzTV views
