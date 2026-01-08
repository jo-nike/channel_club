# Story 12.10: Themed CSS Tooltips

Status: dev-complete

## Story

As a user,
I want tooltips to match the application theme,
so that the UI feels cohesive and polished.

## Acceptance Criteria

1. **Given** any element with a tooltip in the application **When** I hover over it (or focus on keyboard) **Then** a styled tooltip appears matching the current theme (light/dark)

2. **Given** I am in dark mode **When** a tooltip appears **Then** it uses dark theme colors (dark background, light text) using CSS variables `--popover` and `--popover-foreground`

3. **Given** I am in light mode **When** a tooltip appears **Then** it uses light theme colors (light background, dark text) using CSS variables `--popover` and `--popover-foreground`

4. **Given** any tooltip **When** it renders **Then** it has consistent styling: rounded corners (`rounded-md`), subtle shadow (`shadow-md`), smooth fade animation (150ms) **And** positioning is smart (avoids viewport edges)

## Tasks / Subtasks

- [x] Task 1: Install shadcn/ui Tooltip component (AC: #4)
  - [x] Subtask 1.1: Run `npx shadcn@latest add tooltip` in frontend directory
  - [x] Subtask 1.2: Verify `frontend/src/components/ui/tooltip.tsx` is created
  - [x] Subtask 1.3: Ensure Radix UI Tooltip dependency is added to package.json

- [x] Task 2: Add TooltipProvider to application root (AC: #4)
  - [x] Subtask 2.1: Import `TooltipProvider` from `@/components/ui/tooltip`
  - [x] Subtask 2.2: Wrap application in `<TooltipProvider delayDuration={300}>` in App.tsx or main.tsx
  - [x] Subtask 2.3: Verify provider wraps all routes and components

- [x] Task 3: Replace native `title` attributes with Tooltip component (AC: #1, #2, #3)
  - [x] Subtask 3.1: Update `HighlightButton.tsx` - replace `title={tooltipText}` with Tooltip component
  - [x] Subtask 3.2: Update `VideoControls.tsx` - add tooltips to Play/Pause, Mute, Volume, Fullscreen, Theater buttons
  - [x] Subtask 3.3: Update `ErsatzTVVideoControls.tsx` - add tooltips to video control buttons
  - [x] Subtask 3.4: Update `ThemePicker.tsx` - add tooltip to theme picker button
  - [x] Subtask 3.5: Update `NotificationToggle.tsx` - add tooltip showing enabled/disabled state
  - [x] Subtask 3.6: Update `ConnectionStatus.tsx` - add tooltip showing connection state details
  - [x] Subtask 3.7: Update `TVView.tsx` - add tooltip to Refresh video button
  - [x] Subtask 3.8: Update `EPGChannelSidebar.tsx` - add tooltips to collapsed channel buttons
  - [x] Subtask 3.9: Update `TVChannelSidebar.tsx` - add tooltips to collapsed channel buttons
  - [x] Subtask 3.10: Update `EPGGrid.tsx` - add tooltips to channel switch buttons
  - [x] Subtask 3.11: Update `TVEPGGrid.tsx` - add tooltips to channel switch buttons

- [x] Task 4: Ensure theme-aware styling (AC: #2, #3)
  - [x] Subtask 4.1: Verify TooltipContent uses `bg-popover text-popover-foreground` classes
  - [x] Subtask 4.2: Test in both light and dark modes
  - [x] Subtask 4.3: Verify CSS variables from `index.css` are applied correctly

- [x] Task 5: Write unit tests (AC: #1, #2, #3, #4)
  - [x] Subtask 5.1: Create/update tests for tooltip visibility on hover
  - [x] Subtask 5.2: Test tooltip accessibility (keyboard focus)
  - [x] Subtask 5.3: Test theme switching affects tooltip colors

## Dev Notes

### Current State Analysis

- **Current tooltips**: Using native HTML `title` attribute (browser-default styling)
- **Affected files**:
  - `frontend/src/components/HighlightButton.tsx` (line 96-97: `title={tooltipText}`)
  - `frontend/src/components/VideoControls.tsx` (no explicit tooltips, only aria-labels)
  - Other components use aria-labels without visible tooltips

### shadcn/ui Tooltip Usage Pattern

```tsx
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

<Tooltip>
  <TooltipTrigger asChild>
    <button aria-label="Play">
      <Play className="h-6 w-6" />
    </button>
  </TooltipTrigger>
  <TooltipContent>
    <p>Play video</p>
  </TooltipContent>
</Tooltip>
```

### Theme Variables (from index.css)

The project already defines theme-aware CSS variables:

**Light mode (`:root`):**
- `--popover: oklch(1 0 0)` (white)
- `--popover-foreground: oklch(0.145 0 0)` (near-black)

**Dark mode (`.dark`):**
- `--popover: oklch(0.205 0 0)` (dark gray)
- `--popover-foreground: oklch(0.985 0 0)` (near-white)

### Project Structure Notes

- Tooltip component will be created at: `frontend/src/components/ui/tooltip.tsx`
- TooltipProvider should wrap the app in `App.tsx` or `main.tsx`
- Follow existing shadcn/ui component patterns in `frontend/src/components/ui/`

### Testing Standards

- Use Vitest for frontend tests
- Co-locate test files: `HighlightButton.test.tsx`, `VideoControls.test.tsx`
- Mock Radix UI portal for testing tooltip rendering

### References

- [Source: _bmad-output/architecture.md#Implementation-Patterns--Consistency-Rules] - shadcn/ui usage patterns
- [Source: frontend/src/index.css#L47-L114] - Theme CSS variables
- [Source: frontend/src/components/HighlightButton.tsx#L85-97] - Current tooltip implementation

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

N/A

### Completion Notes List

1. Installed `@radix-ui/react-tooltip` package and created `frontend/src/components/ui/tooltip.tsx` component following shadcn/ui patterns
2. Added `TooltipProvider` wrapper in `main.tsx` with 300ms delay to enable tooltips app-wide
3. Replaced all native HTML `title` attributes with themed Tooltip components across:
   - Video controls (play/pause, mute, volume, fullscreen, theater mode)
   - Header controls (refresh video, theme picker, notifications, connection status)
   - Channel sidebars (collapsed channel buttons)
   - EPG grids (channel switch buttons)
4. Tooltips use theme-aware CSS variables (`bg-popover`, `text-popover-foreground`) from `index.css`
5. Created `frontend/src/test/utils.tsx` with custom render function that wraps components with TooltipProvider for testing
6. Updated all test files to use the custom render function - all 704 tests pass

### File List

**New Files:**
- `frontend/src/components/ui/tooltip.tsx` - shadcn/ui Tooltip component
- `frontend/src/test/utils.tsx` - Custom test render function with TooltipProvider

**Modified Files:**
- `frontend/package.json` - Added @radix-ui/react-tooltip dependency
- `frontend/src/main.tsx` - Added TooltipProvider wrapper
- `frontend/src/test/setup.ts` - Added cleanup after each test
- `frontend/src/components/HighlightButton.tsx` - Added Tooltip
- `frontend/src/components/VideoControls.tsx` - Added Tooltips to all buttons
- `frontend/src/components/ersatztv/ErsatzTVVideoControls.tsx` - Added Tooltips to all buttons
- `frontend/src/components/ThemePicker.tsx` - Added Tooltip
- `frontend/src/components/NotificationToggle.tsx` - Added Tooltip
- `frontend/src/components/ConnectionStatus.tsx` - Added Tooltip
- `frontend/src/components/tv/TVView.tsx` - Added Tooltip to refresh button
- `frontend/src/components/ersatztv/EPGChannelSidebar.tsx` - Added Tooltips to collapsed channel buttons
- `frontend/src/components/tv/TVChannelSidebar.tsx` - Added Tooltips to collapsed channel buttons
- `frontend/src/components/ersatztv/EPGGrid.tsx` - Added Tooltips to channel switch buttons
- `frontend/src/components/tv/TVEPGGrid.tsx` - Added Tooltips to channel switch buttons
- All test files updated to use custom render from `@/test/utils`

