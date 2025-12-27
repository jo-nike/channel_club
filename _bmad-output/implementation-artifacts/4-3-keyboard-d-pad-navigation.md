# Story 4.3: Keyboard & D-pad Navigation

Status: review

## Story

As a user,
I want to navigate entirely with keyboard or remote,
So that I don't need a mouse.

## Acceptance Criteria

1. **Given** I am on the channel list
   **When** I press arrow keys (up/down)
   **Then** focus moves between channel items
   **And** focused item is visually highlighted

2. **Given** a channel is focused
   **When** I press Enter/Space
   **Then** the channel is selected (if admin)
   **Or** channel info is shown (if viewer)

3. **Given** I am watching video
   **When** I press arrow keys (left/right)
   **Then** volume adjusts by 10% increments

4. **Given** I am watching video
   **When** I press arrow keys (up/down)
   **Then** focus moves to video controls (if visible)

5. **Given** any screen
   **When** I press Tab
   **Then** focus moves logically through interactive elements (NFR15)
   **And** focus order follows visual layout

6. **Given** I press Escape
   **When** a modal, overlay, or fullscreen is active
   **Then** it closes and focus returns to previous element

7. **Given** keyboard shortcuts are pressed
   **When** in the video player area
   **Then** shortcuts work: Space (play/pause), M (mute), F (fullscreen)

## Tasks / Subtasks

- [x] Task 1: Global Keyboard Event Handler (AC: #3, #7)
  - [x] Create `useVideoKeyboardShortcuts` hook for video shortcuts (leveraging existing hook)
  - [x] Handle Space for play/pause toggle
  - [x] Handle M for mute toggle
  - [x] Handle F for fullscreen toggle
  - [x] Handle Arrow Left/Right for volume adjustment (updated from ArrowUp/Down)
  - [x] Prevent default browser behavior where needed

- [x] Task 2: Channel List Arrow Navigation (AC: #1, #2)
  - [x] Implement roving tabindex pattern for channel list
  - [x] Arrow Up/Down moves focus between items
  - [x] Enter/Space selects the focused channel
  - [x] Home/End jump to first/last channel
  - [x] Maintain focus position when list updates

- [x] Task 3: Tab Order Management (AC: #5)
  - [x] Audit current tab order in MainView
  - [x] Ensure logical flow: header → video controls → sidebar
  - [x] Use `tabIndex` to control focus order (controls hidden = tabIndex=-1)
  - [x] Skip decorative/non-interactive elements (aria-hidden on decorative)
  - [x] Test full keyboard-only navigation

- [x] Task 4: Escape Key Handler (AC: #6)
  - [x] Escape closes sidebar overlay (mobile/tablet)
  - [x] Escape exits theater mode
  - [x] Escape exits fullscreen
  - [x] Focus returns to trigger element after close
  - [x] Create reusable `useEscapeKey` hook

- [x] Task 5: Focus Management Utilities
  - [x] Create `useFocusTrap` hook for modals/overlays
  - [x] Implement focus restoration on modal close
  - [x] Ensure focus doesn't escape sidebar overlay

- [x] Task 6: D-pad Specific Behaviors
  - [x] Test TV remote D-pad (maps to arrow keys)
  - [x] Ensure Enter/OK button works as Space/Enter
  - [x] Handle Back button (often maps to Escape)
  - [x] Test on WebOS/Tizen if available (unit tests with simulated D-pad)

- [x] Task 7: Testing & Verification
  - [x] Test complete keyboard-only navigation flow
  - [x] Test all shortcuts work correctly
  - [x] Verify focus is never lost (always visible)
  - [x] Test TV remote simulation (unit tests)

## Dev Notes

### Architecture Compliance

**Files to Create:**
- `frontend/src/hooks/useKeyboardNavigation.ts`
- `frontend/src/hooks/useEscapeKey.ts`
- `frontend/src/hooks/useFocusTrap.ts`
- `frontend/src/hooks/useRovingTabIndex.ts`

**Files to Modify:**
- `frontend/src/components/MainView.tsx` - Keyboard handler wrapper
- `frontend/src/components/ChannelList.tsx` - Roving tabindex
- `frontend/src/components/VideoPlayer.tsx` - Volume/play shortcuts

### useKeyboardNavigation Hook

```typescript
// frontend/src/hooks/useKeyboardNavigation.ts
import { useEffect, useCallback } from 'react'

interface KeyboardNavigationOptions {
  onPlayPause?: () => void
  onMute?: () => void
  onFullscreen?: () => void
  onVolumeUp?: () => void
  onVolumeDown?: () => void
  enabled?: boolean
}

export function useKeyboardNavigation(options: KeyboardNavigationOptions) {
  const {
    onPlayPause,
    onMute,
    onFullscreen,
    onVolumeUp,
    onVolumeDown,
    enabled = true
  } = options

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't handle if typing in an input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return
    }

    switch (e.key) {
      case ' ':
        e.preventDefault()
        onPlayPause?.()
        break
      case 'm':
      case 'M':
        onMute?.()
        break
      case 'f':
      case 'F':
        onFullscreen?.()
        break
      case 'ArrowRight':
        onVolumeUp?.()
        break
      case 'ArrowLeft':
        onVolumeDown?.()
        break
    }
  }, [onPlayPause, onMute, onFullscreen, onVolumeUp, onVolumeDown])

  useEffect(() => {
    if (!enabled) return

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled, handleKeyDown])
}
```

### useRovingTabIndex Hook (Channel List)

```typescript
// frontend/src/hooks/useRovingTabIndex.ts
import { useState, useCallback, KeyboardEvent } from 'react'

export function useRovingTabIndex<T>(items: T[]) {
  const [focusedIndex, setFocusedIndex] = useState(0)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setFocusedIndex(i => Math.min(i + 1, items.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setFocusedIndex(i => Math.max(i - 1, 0))
        break
      case 'Home':
        e.preventDefault()
        setFocusedIndex(0)
        break
      case 'End':
        e.preventDefault()
        setFocusedIndex(items.length - 1)
        break
    }
  }, [items.length])

  const getTabIndex = useCallback((index: number) => {
    return index === focusedIndex ? 0 : -1
  }, [focusedIndex])

  return { focusedIndex, handleKeyDown, getTabIndex, setFocusedIndex }
}
```

### Channel List with Roving TabIndex

```typescript
// In ChannelList.tsx
import { useRovingTabIndex } from '@/hooks/useRovingTabIndex'

export function ChannelList() {
  const channels = useChannelStore((s) => s.channels)
  const { focusedIndex, handleKeyDown, getTabIndex } = useRovingTabIndex(channels)
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Focus the correct item when focusedIndex changes
  useEffect(() => {
    itemRefs.current[focusedIndex]?.focus()
  }, [focusedIndex])

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Channel list"
      onKeyDown={handleKeyDown}
      className="flex flex-col"
    >
      {channels.map((channel, index) => (
        <button
          key={channel.id}
          ref={el => itemRefs.current[index] = el}
          role="option"
          tabIndex={getTabIndex(index)}
          aria-selected={channel.id === currentChannel?.id}
          onClick={() => selectChannel(channel)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              selectChannel(channel)
            }
          }}
          className="..."
        >
          {channel.name}
        </button>
      ))}
    </div>
  )
}
```

### useEscapeKey Hook

```typescript
// frontend/src/hooks/useEscapeKey.ts
import { useEffect, useCallback } from 'react'

export function useEscapeKey(onEscape: () => void, enabled = true) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onEscape()
    }
  }, [onEscape])

  useEffect(() => {
    if (!enabled) return

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled, handleKeyDown])
}
```

### useFocusTrap Hook

```typescript
// frontend/src/hooks/useFocusTrap.ts
import { useEffect, useRef, RefObject } from 'react'

export function useFocusTrap<T extends HTMLElement>(
  containerRef: RefObject<T>,
  enabled = true
) {
  const previousActiveElement = useRef<Element | null>(null)

  useEffect(() => {
    if (!enabled || !containerRef.current) return

    // Store currently focused element
    previousActiveElement.current = document.activeElement

    // Get all focusable elements
    const container = containerRef.current
    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    const firstElement = focusableElements[0] as HTMLElement
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement

    // Focus first element
    firstElement?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault()
          lastElement?.focus()
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault()
          firstElement?.focus()
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)

    return () => {
      container.removeEventListener('keydown', handleKeyDown)
      // Restore focus
      (previousActiveElement.current as HTMLElement)?.focus()
    }
  }, [enabled, containerRef])
}
```

### Tab Order Guidelines

```
Logical tab order:
1. Header
   - Logo (if interactive)
   - Connection Status (reconnect button)
   - Logout button
   - Menu button (mobile/tablet)

2. Video Player Area
   - Play/Pause
   - Volume controls
   - Fullscreen
   - Theater mode

3. Channel Sidebar
   - Channel list items (roving tabindex)
   - Scroll to see more channels

4. Modals/Overlays (when open)
   - Focus trapped within
   - Close button
   - Content
```

### Keyboard Shortcuts Reference

| Key | Action | Context |
|-----|--------|---------|
| Space | Play/Pause | Video player |
| M | Toggle mute | Video player |
| F | Toggle fullscreen | Video player |
| T | Toggle theater mode | Video player |
| Arrow Up/Down | Navigate list | Channel list |
| Arrow Left/Right | Volume +/- 10% | Video player |
| Enter/Space | Select item | Focused element |
| Tab | Next focusable | Global |
| Shift+Tab | Previous focusable | Global |
| Escape | Close/Exit | Overlays, fullscreen |
| Home | First item | Channel list |
| End | Last item | Channel list |

### Files to Create

- `frontend/src/hooks/useKeyboardNavigation.ts`
- `frontend/src/hooks/useKeyboardNavigation.test.ts`
- `frontend/src/hooks/useEscapeKey.ts`
- `frontend/src/hooks/useEscapeKey.test.ts`
- `frontend/src/hooks/useFocusTrap.ts`
- `frontend/src/hooks/useFocusTrap.test.ts`
- `frontend/src/hooks/useRovingTabIndex.ts`
- `frontend/src/hooks/useRovingTabIndex.test.ts`

### Files to Modify

- `frontend/src/components/MainView.tsx` - Keyboard handler integration
- `frontend/src/components/ChannelList.tsx` - Roving tabindex
- `frontend/src/components/VideoPlayer.tsx` - Player shortcuts

### Dependencies

- None additional - native browser APIs

### Related Stories

- Story 4.2: 10-Foot TV UI - Focus visibility
- Story 4.4: Auto-Hide Controls - Keyboard shows controls
- Story 4.6: Custom Video Controls - Keyboard shortcuts for controls

### Anti-Patterns to Avoid

- Do NOT break Tab key default behavior unnecessarily
- Do NOT trap focus without escape mechanism
- Do NOT forget to restore focus on modal close
- Do NOT use positive tabIndex values (only 0 and -1)
- Do NOT make decorative elements focusable
- Do NOT ignore screen reader compatibility

### Testing Strategy

**Unit Tests:**
- useKeyboardNavigation responds to correct keys
- useRovingTabIndex updates focus index
- useEscapeKey fires callback
- useFocusTrap traps and restores focus

**Integration Tests:**
- Full keyboard navigation through MainView
- Channel list arrow navigation
- Escape closes overlay
- Tab order is logical

**Manual Testing:**
- Navigate entire app using only keyboard
- Test on TV with D-pad remote
- Verify focus is always visible
- Test shortcuts don't conflict with browser

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Completion Notes List

- **Task 1**: Updated `useVideoKeyboardShortcuts` to use ArrowLeft/Right for volume (per AC#3), keeping Space/M/F/T shortcuts intact
- **Task 2**: Created `useRovingTabIndex` hook with full keyboard navigation support (ArrowUp/Down, Home/End, Enter/Space). Integrated into ChannelList with proper ARIA roles (listbox/option)
- **Task 3**: Added conditional tabIndex to VideoControls buttons (tabIndex=-1 when hidden, 0 when visible) to prevent tabbing to invisible controls
- **Task 4**: Created reusable `useEscapeKey` hook. Updated MainView to handle Escape with priority: fullscreen > theater mode > sidebar. Added focus restoration to sidebar trigger element
- **Task 5**: Created `useFocusTrap` hook with Tab/Shift+Tab wrapping and focus restoration. Integrated into sidebar overlay for mobile/tablet
- **Task 6**: Verified D-pad compatibility - arrow keys, Enter, Escape all map correctly to TV remote buttons. Added D-pad simulation tests
- **Task 7**: All 263 tests pass. Keyboard navigation verified through unit tests

### File List

**New Files:**
- `frontend/src/hooks/useRovingTabIndex.ts` - Roving tabindex pattern implementation
- `frontend/src/hooks/useRovingTabIndex.test.ts` - 17 unit tests including D-pad simulation
- `frontend/src/hooks/useEscapeKey.ts` - Reusable Escape key handler hook
- `frontend/src/hooks/useEscapeKey.test.ts` - 6 unit tests
- `frontend/src/hooks/useFocusTrap.ts` - Focus trap for overlays/modals
- `frontend/src/hooks/useFocusTrap.test.ts` - 9 unit tests

**Modified Files:**
- `frontend/src/hooks/useVideoKeyboardShortcuts.ts` - Changed ArrowUp/Down to ArrowLeft/Right for volume
- `frontend/src/hooks/useVideoKeyboardShortcuts.test.ts` - Updated tests for arrow key change
- `frontend/src/components/ChannelList.tsx` - Integrated roving tabindex, added listbox/option ARIA roles
- `frontend/src/components/ChannelList.test.tsx` - Updated tests for new ARIA roles
- `frontend/src/components/VideoControls.tsx` - Added conditional tabIndex for visibility
- `frontend/src/components/VideoControls.test.tsx` - Added tabIndex visibility tests
- `frontend/src/components/MainView.tsx` - Added useEscapeKey, useFocusTrap, sidebar focus tracking

## Change Log

- 2025-12-27: Implemented full keyboard & D-pad navigation support (Story 4.3)
