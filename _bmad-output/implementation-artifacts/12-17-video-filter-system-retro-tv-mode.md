# Story 12.17: Video Filter System with Retro TV Mode

Status: ready-for-dev

## Story

As a viewer,
I want to apply optional visual filters to the video playback,
So that I can customize my viewing experience with fun effects.

## Acceptance Criteria

1. **Given** I am watching video on any view **When** I look at the video controls **Then** I see a "Filters" button (icon: sliders or film strip)

2. **Given** I click the Filters button **When** the filter menu opens **Then** I see a list of available filters with toggle switches **And** "Retro TV" is the first available filter

3. **Given** I enable the "Retro TV" filter **When** the filter activates **Then** I see CRT scanlines (horizontal lines across screen) **And** I see subtle screen curvature/vignette effect (darker corners) **And** I see slight RGB color separation on high-contrast edges **And** I see very subtle static noise texture overlay

4. **Given** the "Retro TV" filter is active **When** a channel switch occurs **Then** the static/snow effect is more pronounced during transition **And** brief VHS tracking distortion appears (wavy horizontal bands)

5. **Given** I disable the "Retro TV" filter **When** the toggle is switched off **Then** all effects are removed immediately **And** video returns to normal playback

6. **Given** I enable a filter and reload the page **When** the app initializes **Then** my filter preference is restored from localStorage

7. **Given** I am on mobile **When** viewing the filter menu **Then** the UI adapts appropriately (bottom sheet or simplified popover)

8. **Given** the filter system architecture **When** new filters are added in future **Then** they can be added to the filter list without restructuring

## Tasks / Subtasks

- [ ] Task 1: Create filter store with localStorage persistence (AC: #6, #8)
  - [ ] 1.1 Create `filterStore.ts` in stores directory
  - [ ] 1.2 Define filter state interface with `activeFilters: string[]`
  - [ ] 1.3 Add `toggleFilter(filterId)` and `isFilterActive(filterId)` actions
  - [ ] 1.4 Implement Zustand persist middleware for localStorage
  - [ ] 1.5 Define extensible filter registry pattern for future filters

- [ ] Task 2: Create RetroTVFilter CSS overlay component (AC: #3)
  - [ ] 2.1 Create `RetroTVFilter.tsx` component
  - [ ] 2.2 Implement CRT scanlines (repeating horizontal lines, 2px spacing)
  - [ ] 2.3 Implement vignette effect (radial gradient darkening corners)
  - [ ] 2.4 Implement RGB chromatic aberration (offset red/blue channels)
  - [ ] 2.5 Implement subtle static noise texture (low-opacity SVG noise)
  - [ ] 2.6 Use CSS `mix-blend-mode` and `pointer-events: none` for overlay

- [ ] Task 3: Create VHSTrackingEffect for enhanced transitions (AC: #4)
  - [ ] 3.1 Create `VHSTrackingEffect.tsx` component
  - [ ] 3.2 Implement wavy horizontal band distortion animation
  - [ ] 3.3 Implement enhanced static/snow burst effect
  - [ ] 3.4 Export as conditional overlay triggered during channel switch

- [ ] Task 4: Create FilterMenu component (AC: #1, #2, #7)
  - [ ] 4.1 Create `FilterMenu.tsx` with Popover or Dialog wrapper
  - [ ] 4.2 List available filters with toggle switches
  - [ ] 4.3 Add filter icon button (use Lucide `SlidersHorizontal` or `Film`)
  - [ ] 4.4 Implement mobile-responsive layout (bottom sheet pattern)
  - [ ] 4.5 Connect toggles to filterStore actions

- [ ] Task 5: Integrate filter button into VideoControls (AC: #1)
  - [ ] 5.1 Add filter button to `VideoControls.tsx`
  - [ ] 5.2 Add filter button to `ErsatzTVVideoControls.tsx`
  - [ ] 5.3 Position consistently with other control buttons
  - [ ] 5.4 Show active indicator when any filter is enabled

- [ ] Task 6: Integrate RetroTVFilter overlay into video players (AC: #3, #5)
  - [ ] 6.1 Add RetroTVFilter to `VideoPlayer.tsx` (conditionally rendered)
  - [ ] 6.2 Add RetroTVFilter to `DualModeVideoPlayer.tsx` LiveVideoPlayer
  - [ ] 6.3 Add RetroTVFilter to `DualModeVideoPlayer.tsx` HLSVideoPlayerWrapper
  - [ ] 6.4 Connect visibility to filterStore `isFilterActive('retro-tv')`

- [ ] Task 7: Integrate VHS effect with ChannelSwitchOverlay (AC: #4)
  - [ ] 7.1 Check filterStore for retro-tv active state in overlay
  - [ ] 7.2 Render VHSTrackingEffect when retro-tv filter active
  - [ ] 7.3 Enhance static burst intensity when filter active

- [ ] Task 8: Add CSS keyframes for filter effects (AC: #3, #4)
  - [ ] 8.1 Add `@keyframes scanline-scroll` for moving scanlines
  - [ ] 8.2 Add `@keyframes vhs-tracking` for wavy distortion
  - [ ] 8.3 Add `@keyframes chromatic-shift` for RGB separation pulse
  - [ ] 8.4 Add utility classes in index.css

## Dev Notes

### Architecture Pattern - Extensible Filter System

Design for future filter additions without restructuring:

```typescript
// filterStore.ts
interface FilterDefinition {
  id: string
  name: string
  description: string
  component: React.ComponentType<FilterOverlayProps>
}

const FILTER_REGISTRY: FilterDefinition[] = [
  { id: 'retro-tv', name: 'Retro TV', description: 'CRT scanlines and VHS effects', component: RetroTVFilter },
  // Future: { id: 'film-grain', name: 'Film Grain', ... }
  // Future: { id: 'noir', name: 'Black & White', ... }
]
```

### RetroTVFilter CSS Implementation

Layer multiple effects using absolute positioning and blend modes:

```tsx
<div className="absolute inset-0 pointer-events-none z-10">
  {/* Scanlines - repeating gradient */}
  <div className="absolute inset-0 bg-scanlines opacity-10" />

  {/* Vignette - radial gradient */}
  <div className="absolute inset-0 bg-vignette" />

  {/* RGB separation - CSS filter on pseudo-elements */}
  <div className="absolute inset-0 chromatic-aberration" />

  {/* Static noise - SVG turbulence, very low opacity */}
  <div className="absolute inset-0 opacity-5">
    <StaticNoiseOverlay />
  </div>
</div>
```

CSS in index.css:

```css
/* CRT Scanlines */
.bg-scanlines {
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0, 0, 0, 0.3) 2px,
    rgba(0, 0, 0, 0.3) 4px
  );
}

/* Vignette */
.bg-vignette {
  background: radial-gradient(
    ellipse at center,
    transparent 50%,
    rgba(0, 0, 0, 0.4) 100%
  );
}

/* Chromatic aberration via box-shadow on video */
.chromatic-aberration {
  box-shadow:
    -2px 0 0 rgba(255, 0, 0, 0.1),
    2px 0 0 rgba(0, 0, 255, 0.1);
}
```

### VHS Tracking Distortion

Animate horizontal bands with CSS transform skew:

```css
@keyframes vhs-tracking {
  0% { transform: translateY(0) skewX(0); }
  25% { transform: translateY(2px) skewX(2deg); }
  50% { transform: translateY(-1px) skewX(-1deg); }
  75% { transform: translateY(3px) skewX(1deg); }
  100% { transform: translateY(0) skewX(0); }
}

.vhs-tracking-band {
  animation: vhs-tracking 0.15s steps(4) infinite;
  height: 8px;
  background: linear-gradient(transparent, rgba(255,255,255,0.1), transparent);
}
```

### Filter Store Pattern

Use Zustand with persist middleware:

```typescript
// stores/filterStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface FilterState {
  activeFilters: string[]
  toggleFilter: (filterId: string) => void
  isFilterActive: (filterId: string) => boolean
}

export const useFilterStore = create<FilterState>()(
  persist(
    (set, get) => ({
      activeFilters: [],
      toggleFilter: (filterId) => set((state) => ({
        activeFilters: state.activeFilters.includes(filterId)
          ? state.activeFilters.filter(id => id !== filterId)
          : [...state.activeFilters, filterId]
      })),
      isFilterActive: (filterId) => get().activeFilters.includes(filterId),
    }),
    { name: 'filter-storage' }
  )
)
```

### Integration with Story 12.16

This story builds on the static noise effect from story 12.16:
- Reuse `StaticNoiseOverlay` component for filter's noise texture
- When retro-tv filter is active, enhance `ChannelSwitchOverlay` with VHS effects
- Share CSS animation patterns

### Project Structure Notes

**Files to CREATE:**
- `frontend/src/stores/filterStore.ts` - Filter state management
- `frontend/src/components/filters/RetroTVFilter.tsx` - CRT effect overlay
- `frontend/src/components/filters/VHSTrackingEffect.tsx` - Transition enhancement
- `frontend/src/components/FilterMenu.tsx` - Filter selection UI

**Files to MODIFY:**
- `frontend/src/components/VideoControls.tsx` - Add filter button
- `frontend/src/components/ersatztv/ErsatzTVVideoControls.tsx` - Add filter button
- `frontend/src/components/VideoPlayer.tsx` - Add filter overlay
- `frontend/src/components/tv/DualModeVideoPlayer.tsx` - Add filter overlay
- `frontend/src/components/ChannelSwitchOverlay.tsx` - Enhance with VHS effect
- `frontend/src/index.css` - Filter animation keyframes

### Control Button Placement

Add filter button in VideoControls alongside existing buttons:
- Position: After volume, before fullscreen (consistent grouping)
- Icon: `SlidersHorizontal` from lucide-react
- Active state: Highlight when any filter enabled

### Mobile Considerations

On mobile (< 768px):
- Use Dialog/Sheet instead of Popover for filter menu
- Larger touch targets for toggle switches
- Consider slide-up bottom sheet pattern

### Performance Considerations

- All effects use CSS only (no JS animation loops)
- Use `will-change: transform` on animated elements
- SVG noise at very low opacity (5%) to minimize GPU load
- `pointer-events: none` on overlay to not interfere with video controls

### References

- [Source: _bmad-output/project-planning-artifacts/epics.md#Story 12.17]
- [Source: frontend/src/components/StaticNoiseOverlay.tsx] - Reuse for noise texture (from 12.16)
- [Source: frontend/src/components/VideoControls.tsx] - Button integration point
- [Source: frontend/src/stores/uiStore.ts] - Zustand persist pattern reference
- [Source: frontend/src/index.css:339-395] - Animation keyframes location

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
