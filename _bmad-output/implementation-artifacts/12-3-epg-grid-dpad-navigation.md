# Story 12.3: EPG Grid D-pad Navigation

Status: ready-for-dev

## Story

As a TV user,
I want to navigate the EPG grid and channel sidebar with arrow keys,
So that I can browse without needing a mouse.

## Acceptance Criteria

1. **Given** I am viewing the EPG grid, **when** I press ↑/↓ arrow keys, **then** focus moves between channel rows, the focused row is visually highlighted, and the grid scrolls to keep focused row visible

2. **Given** I am viewing the EPG grid, **when** I press ←/→ arrow keys, **then** focus moves between programme cells in time, the focused cell is visually highlighted, and the grid scrolls horizontally to keep focused cell visible

3. **Given** a programme cell is focused, **when** I press Enter or Space, **then** the programme details modal opens (not auto-play)

4. **Given** I am viewing the channel sidebar, **when** I press ↑/↓ arrow keys, **then** focus moves between channel items and the focused item is visually highlighted

5. **Given** a channel is focused in the sidebar, **when** I press Enter or Space, **then** that channel starts playing

6. **Given** I navigate away from the EPG grid and return, **when** the grid regains focus, **then** focus returns to the last focused position (or currently playing programme)

## Tasks / Subtasks

- [ ] Task 1: Create useDpadNavigation Hook (AC: #1, #2, #4)
  - [ ] Create `frontend/src/hooks/useDpadNavigation.ts`
  - [ ] Implement keyboard event handling for ↑, ↓, ←, →, Enter, Space
  - [ ] Track focused position with `{row: number, col: number}` state
  - [ ] Implement scroll-into-view logic for focused elements
  - [ ] Return focus handlers and current focused position
  - [ ] Add boundary clamping (don't wrap, stop at edges)

- [ ] Task 2: Add Focus State Management to tvStore (AC: #6)
  - [ ] Add `focusedPosition: {row: number, col: number} | null` to tvStore
  - [ ] Add `setFocusedPosition(pos)` action
  - [ ] Add `clearFocusedPosition()` action
  - [ ] Persist focus state when navigating away and returning

- [ ] Task 3: Update TVEPGGrid with D-pad Support (AC: #1, #2, #3)
  - [ ] Import useDpadNavigation hook
  - [ ] Add `tabIndex={0}` and `role="grid"` to grid container
  - [ ] Pass `onKeyDown` handler from hook to container
  - [ ] Highlight focused row with visual indicator (e.g., `ring-2 ring-primary`)
  - [ ] Highlight focused programme cell distinctly
  - [ ] Implement `scrollIntoView()` for focused elements
  - [ ] Trigger `onProgrammeClick` on Enter/Space (opens modal, NOT auto-play)

- [ ] Task 4: Update TVChannelSidebar with D-pad Support (AC: #4, #5)
  - [ ] Add keyboard navigation to channel list
  - [ ] Highlight focused channel item with visible focus ring
  - [ ] Trigger channel selection on Enter/Space
  - [ ] Ensure focus management between sidebar and grid

- [ ] Task 5: Implement Focus Restoration (AC: #6)
  - [ ] Save focused position to tvStore when focus leaves grid
  - [ ] Restore focus position when grid regains focus
  - [ ] Default to currently playing channel row if no saved position
  - [ ] Scroll to restored focus position

- [ ] Task 6: Add Focus Visual Indicators (AC: #1, #2, #4)
  - [ ] Update `ChannelRow` component with focused state styling
  - [ ] Update `ProgrammeBox` component with focused state styling
  - [ ] Update `ChannelItem` in sidebar with focused state styling
  - [ ] Use `focus-visible:ring-2 focus-visible:ring-ring` pattern (existing project convention)
  - [ ] Ensure 44px minimum touch/focus targets (10-foot UI requirement)

- [ ] Task 7: Write Tests for D-pad Navigation (AC: #1-6)
  - [ ] Create `frontend/src/hooks/useDpadNavigation.test.ts`
  - [ ] Test arrow key movement in all directions
  - [ ] Test boundary behavior (first/last row/col)
  - [ ] Test Enter/Space activation
  - [ ] Test focus restoration
  - [ ] Update `TVEPGGrid.test.tsx` with keyboard navigation tests
  - [ ] Update `TVChannelSidebar.test.tsx` with keyboard tests

- [ ] Task 8: Verify and Test
  - [ ] Run `npm run build` - no errors
  - [ ] Run `npm run test` - all tests pass
  - [ ] Manual test: Arrow keys navigate grid rows
  - [ ] Manual test: Arrow keys navigate programme cells
  - [ ] Manual test: Enter opens programme modal (NOT auto-play)
  - [ ] Manual test: Sidebar keyboard navigation works
  - [ ] Manual test: Focus is visually highlighted (44px targets)
  - [ ] Manual test: Focus restores when returning to grid

## Dev Notes

### Current EPG Grid Implementation Analysis

**TVEPGGrid.tsx (lines 1-341):**
- Grid uses absolute positioning with `ROW_HEIGHT = 64` and `SLOT_WIDTH = 150`
- Channel rows render with `ChannelRow` component (line 127-158)
- Programme cells render with `ProgrammeBox` component (line 262-309)
- Buttons already have `focus:outline-none focus-visible:ring-2 focus-visible:ring-ring` (lines 200, 289)
- No current keyboard navigation - only mouse click handlers
- Grid container ref exists at line 32: `const containerRef = useRef<HTMLDivElement>(null)`

**TVChannelSidebar.tsx (lines 1-333):**
- Channel list in `<ul>` with `role="list"` (line 118)
- Individual channels are buttons with focus styling (lines 206-214)
- Already has `focus-visible:ring-2 focus-visible:ring-ring` pattern
- No keyboard navigation between items currently

### D-pad Navigation Architecture

**Keyboard Event Handling Pattern:**
```tsx
// Pattern to follow from project
const handleKeyDown = (e: React.KeyboardEvent) => {
  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault()
      moveFocus(-1, 0)
      break
    case 'ArrowDown':
      e.preventDefault()
      moveFocus(1, 0)
      break
    case 'ArrowLeft':
      e.preventDefault()
      moveFocus(0, -1)
      break
    case 'ArrowRight':
      e.preventDefault()
      moveFocus(0, 1)
      break
    case 'Enter':
    case ' ':
      e.preventDefault()
      activateFocused()
      break
  }
}
```

**Focus Management State:**
```tsx
// Add to tvStore (stores/tvStore.ts)
interface TVStoreState {
  // ... existing state
  focusedPosition: { row: number; col: number } | null
  setFocusedPosition: (pos: { row: number; col: number } | null) => void
}
```

**Scroll Into View Pattern:**
```tsx
// Use native scrollIntoView with smooth behavior
focusedRef.current?.scrollIntoView({
  behavior: 'smooth',
  block: 'nearest',
  inline: 'nearest',
})
```

### Project Conventions to Follow

**From project-context.md:**
- Named exports for all components: `export function EPGGrid()`
- Hook files camelCase with `use` prefix: `useDpadNavigation.ts`
- Minimum touch target: 44px (10-foot UI requirement)
- All interactive elements must have visible focus states
- Full keyboard/D-pad navigation required (NFR15)

**From architecture.md:**
- Zustand store pattern: `export const useTVStore = create<TVStoreState>((set) => ({...}))`
- Test files co-located: `useDpadNavigation.test.ts`
- Use Tailwind focus states: `focus-visible:ring-2 focus-visible:ring-ring`

### Focus State Visual Design

**Focused Row (Channel):**
```tsx
className={`... ${isFocused ? 'ring-2 ring-primary bg-primary/5' : ''}`}
```

**Focused Programme Cell:**
```tsx
className={`... ${isFocused ? 'ring-2 ring-primary scale-105 z-10' : ''}`}
```

**Focused Sidebar Channel:**
```tsx
className={`... ${isFocused ? 'ring-2 ring-primary' : ''}`}
```

### Grid Navigation Logic

**Row Focus (↑/↓):**
- Move between channels (rows) vertically
- Keep column position when moving rows
- Clamp to first/last row (no wrap)

**Column Focus (←/→):**
- Move between programmes in current row
- Programmes may have variable widths based on duration
- Calculate which programme contains the current time offset
- Clamp to first/last programme in row (no wrap)

**Programme Index Calculation:**
```tsx
// Find programme at time position in row
const getProgrammeIndexAtTime = (
  programmes: ErsatzTVProgramme[],
  timeOffset: number
): number => {
  for (let i = 0; i < programmes.length; i++) {
    const prog = programmes[i]
    const progLeft = calculateTimeOffset(new Date(prog.start), startTime)
    const progRight = progLeft + calculateDurationWidth(new Date(prog.start), new Date(prog.stop))
    if (timeOffset >= progLeft && timeOffset < progRight) {
      return i
    }
  }
  return 0
}
```

### Enter/Space Behavior

**EPG Grid Programme:**
- Enter/Space should call `onProgrammeClick(programme, channel)`
- This opens the ProgrammeDetailsModal (NOT auto-play)
- User must click "Watch" in modal to start playback

**Channel Sidebar:**
- Enter/Space should call channel selection
- This DOES start playback immediately

### Previous Story Intelligence (12-2)

**Key Patterns Established:**
- StatusTab component uses `useEffect` with 30-second interval
- Admin modal tabs use named exports
- shadcn/ui Card components for consistent styling
- Backend service pattern with loguru logging

### Files to Create

- `frontend/src/hooks/useDpadNavigation.ts` - D-pad navigation hook
- `frontend/src/hooks/useDpadNavigation.test.ts` - Hook tests

### Files to Modify

- `frontend/src/stores/tvStore.ts` - Add focus state management
- `frontend/src/components/tv/TVEPGGrid.tsx` - Add keyboard handlers
- `frontend/src/components/tv/TVChannelSidebar.tsx` - Add keyboard handlers
- `frontend/src/components/tv/TVEPGGrid.test.tsx` - Update with keyboard tests
- `frontend/src/components/tv/TVChannelSidebar.test.tsx` - Update with keyboard tests

### References

- [Source: frontend/src/components/tv/TVEPGGrid.tsx:1-341] - Current EPG grid implementation
- [Source: frontend/src/components/tv/TVChannelSidebar.tsx:1-333] - Current sidebar implementation
- [Source: frontend/src/stores/tvStore.ts] - TV store for state management
- [Source: _bmad-output/project-context.md] - 10-foot UI rules, naming conventions
- [Source: _bmad-output/architecture.md] - NFR15: Full keyboard/D-pad navigation
- [Source: _bmad-output/project-planning-artifacts/epics.md#story-123] - Original requirements

### Testing Checklist

- [ ] `npm run build` succeeds
- [ ] `npm run test` passes
- [ ] Arrow keys move focus between rows (manual test)
- [ ] Arrow keys move focus between programmes (manual test)
- [ ] Enter/Space opens modal (NOT auto-play) (manual test)
- [ ] Sidebar keyboard navigation works (manual test)
- [ ] Focus visible with 44px targets (manual test)
- [ ] Focus restores when returning (manual test)
- [ ] No console errors (manual test)

### Potential Risks

1. **Variable Programme Widths** - Programmes have different durations/widths
   - Mitigation: Track column by time offset, not index
2. **Scroll Performance** - Smooth scrolling may be janky
   - Mitigation: Use `behavior: 'instant'` if performance issues
3. **Focus Trapping** - User may get stuck in grid
   - Mitigation: Allow Tab to move focus out, only arrow keys for internal nav
4. **Live Channel Row** - Live channel has different structure
   - Mitigation: Handle live channel row specially in navigation logic

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-01-04: Story 12.3 created by BMad workflow - ready for implementation
