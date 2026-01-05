# Story 12.7: Rounded Corner UI Polish

Status: review

## Story

As a user,
I want smooth visual transitions where the header, video player, and sidebar meet,
So that the UI feels polished and modern.

## Acceptance Criteria

1. **Given** I am viewing the unified TV view, **when** I look at the junction where header, video player, and channel sidebar meet, **then** the corners are rounded/smoothed instead of sharp 90° angles

2. **Given** the sidebar is in collapsed state, **when** viewing the junction, **then** the rounded corners are appropriately styled for collapsed layout

3. **Given** the sidebar is in expanded state, **when** viewing the junction, **then** the rounded corners are appropriately styled for expanded layout

4. **Given** I am on any screen size (desktop, tablet, mobile), **when** viewing the junction, **then** the rounded corners adapt appropriately to the layout

## Tasks / Subtasks

- [x] Task 1: Analyze Junction Points and Design Approach (AC: #1, #2, #3, #4)
  - [x] Identify all junction points between header, sidebar, video player, and EPG grid
  - [x] Determine appropriate border-radius values (suggest `rounded-lg` = 0.5rem / 8px)
  - [x] Plan overflow handling to prevent content clipping at rounded corners
  - [x] Consider z-index layering at junction points

- [x] Task 2: Update TVView Header Junction (AC: #1, #4)
  - [x] Add rounded bottom corners to header where it meets sidebar and video player
  - [x] Ensure header bottom-left corner rounds where sidebar begins (desktop)
  - [x] Verify header styling works across all breakpoints

- [x] Task 3: Update TVChannelSidebar Corners (AC: #1, #2, #3)
  - [x] Add rounded corners to expanded sidebar (w-72) at junction with header and video
  - [x] Add rounded corners to collapsed sidebar (w-12) at junction with header and video
  - [x] Round top-right corner of sidebar where it meets header bottom
  - [x] Round bottom-right corner of sidebar where it meets video/EPG area
  - [x] Ensure skeleton states also have rounded corners

- [x] Task 4: Update Video Player Container (AC: #1, #4)
  - [x] Add rounded corners to video player container in `TVView.tsx`
  - [x] Handle theater mode and mobile landscape (full-screen = no rounded corners)
  - [x] Ensure overflow-hidden on video container to clip player content
  - [x] Verify video player bg-black doesn't leak at corners

- [x] Task 5: Update EPG Grid Junction (AC: #1)
  - [x] Add rounded top corners to EPG section where it meets video and sidebar
  - [x] Ensure ResizeDragHandle styling complements rounded corner design
  - [x] Handle mobile EPG layout (full-width, different rounding needs)

- [x] Task 6: Responsive Testing (AC: #4)
  - [x] Verify rounded corners on desktop (> 1024px)
  - [x] Verify rounded corners on tablet (768px - 1024px)
  - [x] Verify rounded corners on mobile (< 768px)
  - [x] Verify rounded corners in theater mode (should be disabled)
  - [x] Verify rounded corners in mobile landscape (should be disabled)

- [x] Task 7: Update Tests and Final Verification
  - [x] Run `npm run build` to verify no errors
  - [x] Run `npm run test` to verify all tests pass
  - [x] Visual verification of all junction points

## Dev Notes

### Current Layout Analysis

The TVView component has three main junction areas:

1. **Header ↔ Sidebar Junction (top-left)**
   - Header has `border-b` (bottom border)
   - Sidebar (expanded) has `border-r` (right border)
   - Currently sharp 90° angle where borders meet

2. **Header ↔ Video Player Junction (top-right area)**
   - Video container flows from sidebar to edge
   - Sharp transition from header to video bg-black

3. **Sidebar ↔ Video/EPG Junction (right edge of sidebar)**
   - Sidebar has `border-r`
   - Video player and EPG section meet at sidebar edge
   - Currently sharp transitions

4. **Video Player ↔ EPG Grid Junction (middle horizontal)**
   - ResizeDragHandle sits between them
   - Sharp top edge on EPG container

### Tailwind Border Radius Classes

| Class | Value | Pixels |
|-------|-------|--------|
| `rounded-sm` | 0.125rem | 2px |
| `rounded` | 0.25rem | 4px |
| `rounded-md` | 0.375rem | 6px |
| `rounded-lg` | 0.5rem | 8px |
| `rounded-xl` | 0.75rem | 12px |
| `rounded-2xl` | 1rem | 16px |

**Recommendation:** Use `rounded-lg` (8px) for major junctions, `rounded-md` (6px) for secondary elements.

### Key Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/components/tv/TVView.tsx` | Video container rounding, header styling |
| `frontend/src/components/tv/TVChannelSidebar.tsx` | Sidebar container rounding |
| `frontend/src/components/tv/TVEPGGrid.tsx` | EPG container top rounding |
| `frontend/src/components/ui/ResizeDragHandle.tsx` | May need styling updates |

### Implementation Strategy

**Approach: Content Container Rounding**

Rather than rounding the main flex containers (which can cause layout issues), round the inner content areas:

1. **Header:** Add `rounded-b-lg` to header element for bottom corners
2. **Sidebar:** Wrap content in inner div with `rounded-tr-lg rounded-br-lg`
3. **Video:** Add `rounded-lg` to video container div with `overflow-hidden`
4. **EPG:** Add `rounded-t-lg` to EPG container

**Overflow Handling:**
- Use `overflow-hidden` on rounded containers to clip child content
- Video player (`bg-black`) must not leak at corners
- Channel logos and images must be clipped properly

**Conditional Rounding:**
- Disable rounding in theater mode (`isTheaterMode`)
- Disable rounding in mobile landscape (`isMobileLandscape`)
- These modes are full-screen → no visible junctions

### Current TVView Structure Reference

```tsx
// Simplified structure for reference
<div className="flex h-screen flex-col">  {/* Root */}
  {/* Header */}
  {!isTheaterMode && !isMobileLandscape && (
    <header className="...border-b">  {/* ADD: rounded-b-lg */}
      ...
    </header>
  )}

  {/* Main content */}
  <div className="flex flex-1 min-h-0">  {/* Flex row */}
    {/* Sidebar */}
    <TVChannelSidebar />  {/* Modify internally */}

    {/* Content area */}
    <main className="flex flex-1 flex-col">
      {/* Video player */}
      <div className="...bg-black">  {/* ADD: rounded-lg overflow-hidden */}
        <DualModeVideoPlayer />
      </div>

      {/* Resize handle */}
      <ResizeDragHandle />

      {/* EPG section */}
      <div className="epg-scroll">  {/* ADD: rounded-t-lg */}
        <TVEPGGrid />
      </div>
    </main>
  </div>
</div>
```

### TVChannelSidebar Collapsed vs Expanded

**Collapsed (`w-12`):**
```tsx
<aside className="flex h-full w-12 flex-col items-center border-r bg-card py-2">
  {/* ADD: rounded-tr-lg rounded-br-lg overflow-hidden */}
```

**Expanded (`w-72`):**
```tsx
<aside className="epg-scroll h-full w-72 overflow-y-auto border-r bg-card">
  {/* ADD: rounded-tr-lg rounded-br-lg */}
```

### Mobile Considerations

On mobile (< 768px):
- No sidebar displayed (hidden)
- Header → Video → Mobile channel list (vertical stack)
- Rounding applies to:
  - Header bottom corners (`rounded-b-lg`)
  - Video container (all corners if not full-width, or just bottom corners)
  - Mobile channel list top corners (`rounded-t-lg`)

### Testing Checklist

- [ ] Desktop with expanded sidebar
- [ ] Desktop with collapsed sidebar
- [ ] Desktop without EPG visible
- [ ] Desktop with EPG visible (verify resize handle area)
- [ ] Tablet breakpoint
- [ ] Mobile portrait (no sidebar)
- [ ] Mobile landscape (full-screen, no rounding expected)
- [ ] Theater mode (full-screen, no rounding expected)
- [ ] All themes (dark, light, system)

### Performance Considerations

- `overflow-hidden` with `border-radius` can trigger GPU acceleration
- Should have negligible impact on performance
- No animation on border-radius changes (static)

### Project Structure Notes

- All changes within existing component files
- No new files required
- Follows existing Tailwind class patterns
- Uses `cn()` utility for conditional class merging

### References

- [Source: frontend/src/components/tv/TVView.tsx] - Main unified view component
- [Source: frontend/src/components/tv/TVChannelSidebar.tsx:79-101] - Collapsed sidebar
- [Source: frontend/src/components/tv/TVChannelSidebar.tsx:105-133] - Expanded sidebar
- [Source: frontend/src/components/tv/TVEPGGrid.tsx:106-162] - EPG grid container
- [Source: _bmad-output/project-context.md] - Project conventions
- [Source: epics.md#Story-12.7] - Original story requirements

### Previous Story Intelligence

**From Story 12.1 (Retire Legacy MainView):**
- Route consolidation complete, TVView now at `/`
- All 663 frontend tests passing
- Build succeeds with no errors
- TVView is the canonical view - all styling changes apply here

**From Recent Git Commits:**
- `6e1279d` - united view fixes (TVView is stable)
- EPG and HLS streaming are working
- No known styling issues

### Architecture Compliance

- Uses Tailwind CSS 4.x as per tech stack
- Follows shadcn/ui styling patterns (rounded-lg is common)
- No new dependencies required
- Responsive design follows existing breakpoint patterns

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None required - implementation was straightforward CSS changes.

### Completion Notes List

- Added `rounded-b-lg` to header in TVView for smooth bottom corners at junctions with sidebar and video
- Added `rounded-r-lg overflow-hidden` to TVChannelSidebar in both collapsed (w-12) and expanded (w-72) states
- Added `rounded-r-lg` to sidebar error state and skeleton states for consistency
- Added conditional `rounded-lg` to video player container (disabled in theater mode/mobile landscape)
- Added `rounded-t-lg` to EPG section container for smooth transition from video
- Added `rounded-t-lg` to ResizeDragHandle component
- Added `rounded-t-lg overflow-hidden` to EPGGridSkeleton
- All 663 frontend tests pass
- Build succeeds with no errors

### File List

- `frontend/src/components/tv/TVView.tsx` - Added rounded-b-lg to header, rounded-lg to video container, rounded-t-lg to EPG section
- `frontend/src/components/tv/TVChannelSidebar.tsx` - Added rounded-r-lg to sidebar in all states (expanded, collapsed, error, skeleton)
- `frontend/src/components/tv/TVEPGGrid.tsx` - Added rounded-t-lg to skeleton state
- `frontend/src/components/ui/ResizeDragHandle.tsx` - Added rounded-t-lg for consistent styling

## Change Log

- 2026-01-04: Implemented rounded corner UI polish for all junction points (header/sidebar/video/EPG) with responsive handling
