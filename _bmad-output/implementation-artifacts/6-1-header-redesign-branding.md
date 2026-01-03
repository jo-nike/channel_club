# Story 6.1: Header Redesign & Branding

Status: review

## Story

As a user,
I want a slimmer, cleaner header with the current channel displayed,
so that more screen space is dedicated to video content.

## Acceptance Criteria

1. **Header height reduced by 50%**: Change padding from `p-4` to `p-2` in the header element
2. **Title changed**: Display "Jon's place" instead of "IPTV Viewer"
3. **Current channel name displayed**: Show the currently selected channel name in the header
4. **No channel fallback**: When no channel is selected, show "No channel selected" or leave empty
5. **Responsive layout maintained**: All changes work correctly across mobile/tablet/desktop breakpoints

## Tasks / Subtasks

- [x] Task 1: Reduce header height (AC: #1)
  - [x] Change header padding from `p-4` to `p-2` in MainView.tsx
  - [x] Verify header looks good with reduced padding
- [x] Task 2: Update branding (AC: #2)
  - [x] Change h1 text from "IPTV Viewer" to "Jon's place"
  - [x] Update mobile emoji representation if needed
- [x] Task 3: Display current channel name (AC: #3, #4)
  - [x] Import useChannelStore to access currentChannel
  - [x] Add channel name display element next to title
  - [x] Handle null case with "No channel selected" text
- [x] Task 4: Verify responsive behavior (AC: #5)
  - [x] Test on mobile breakpoint
  - [x] Test on tablet breakpoint
  - [x] Test on desktop breakpoint
- [x] Task 5: Update tests
  - [x] Update MainView.test.tsx for new header content

## Dev Notes

### Architecture Compliance

- **Component location**: `frontend/src/components/MainView.tsx` (existing file, modify header section)
- **Store access**: Use existing `useChannelStore` from `@/stores/channelStore`
- **Styling**: Use Tailwind CSS classes, follow existing patterns

### Technical Implementation

**Current header structure** (MainView.tsx lines 79-111):
```tsx
<header className="flex justify-between items-center p-4 bg-background border-b">
  <div className="flex items-center gap-4">
    <h1 className="text-2xl font-bold hidden md:block">IPTV Viewer</h1>
    <span className="md:hidden text-2xl">📺</span>
    <ConnectionStatus status={status} onReconnect={reconnect} />
  </div>
  ...
</header>
```

**Target structure**:
```tsx
<header className="flex justify-between items-center p-2 bg-background border-b">
  <div className="flex items-center gap-4">
    <h1 className="text-xl font-bold hidden md:block">Jon's place</h1>
    <span className="md:hidden text-xl">📺</span>
    {/* Channel name display */}
    <span className="text-muted-foreground text-sm truncate max-w-[200px]">
      {currentChannel?.name || 'No channel selected'}
    </span>
    <ConnectionStatus status={status} onReconnect={reconnect} />
  </div>
  ...
</header>
```

### Key Changes

1. `p-4` → `p-2` (header padding)
2. `text-2xl` → `text-xl` (adjust text size for slimmer header)
3. "IPTV Viewer" → "Jon's place"
4. Add `currentChannel?.name` display

### Store Import

Add to imports:
```tsx
import { useChannelStore } from '@/stores/channelStore'
```

Add to component:
```tsx
const currentChannel = useChannelStore((s) => s.currentChannel)
```

### Project Structure Notes

- Alignment: Modifies existing MainView.tsx header section only
- No new files needed
- Uses existing store patterns

### Testing Requirements

- Update MainView.test.tsx to test for "Jon's place" text
- Add test for channel name display
- Mock channelStore in tests

### References

- [Source: frontend/src/components/MainView.tsx#79-111] - Current header implementation
- [Source: frontend/src/stores/channelStore.ts] - Channel store with currentChannel
- [Source: _bmad-output/architecture.md#Frontend-Organization] - Component patterns

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

- No issues encountered during implementation

### Completion Notes List

- **Task 1 Complete**: Changed header padding from `p-4` to `p-2` for slimmer design
- **Task 2 Complete**: Updated title from "IPTV Viewer" to "Jon's place", reduced text size from `text-2xl` to `text-xl`
- **Task 3 Complete**: Added `useChannelStore` import and `currentChannel` state accessor. Added channel name display with truncation (`max-w-[200px]`) and "No channel selected" fallback
- **Task 4 Complete**: Verified via code inspection - responsive classes (`hidden md:block`, breakpoint-aware sidebar) remain functional
- **Task 5 Complete**: Updated all test references from "IPTV Viewer" to "Jon's place", added tests for channel name display in header and header padding verification

### File List

- frontend/src/components/MainView.tsx (modified)
- frontend/src/components/MainView.test.tsx (modified)

### Change Log

- 2026-01-03: Implemented header redesign - reduced padding, updated branding, added current channel display
