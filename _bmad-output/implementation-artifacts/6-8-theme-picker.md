# Story 6.8: Theme Picker

Status: review

## Story

As a user,
I want to select from a variety of color themes for the app,
so that I can personalize my viewing experience with colors I prefer.

## Acceptance Criteria

1. **Given** I am on any view (Live TV or ErsatzTV)
   **When** I click the theme picker button in the header
   **Then** I see a dropdown/popover with all available themes listed

2. **Given** the theme picker is open
   **When** I select a theme (e.g., "Catppuccin Mocha")
   **Then** the app colors immediately update to reflect the selected theme
   **And** the theme picker closes

3. **Given** I have selected a theme
   **When** I navigate between views (Live TV ↔ ErsatzTV)
   **Then** the theme persists across both views

4. **Given** I have selected a theme
   **When** I close the browser and reopen the app
   **Then** my theme preference is restored from localStorage

5. **Given** the theme list
   **When** viewing available themes
   **Then** I see all 14 Glance themes organized by light/dark categories:
   - **Dark themes:** Teal City, Catppuccin Frappe, Catppuccin Macchiato, Catppuccin Mocha, Camouflage, Gruvbox Dark, Kanagawa Dark, Tucan, Dracula, Shades of Purple, Neon Pink
   - **Light themes:** Catppuccin Latte, Peachy, Zebra

6. **Given** a dark theme is selected
   **When** the theme applies
   **Then** the `.dark` class is added to html/body and theme CSS variables are applied

7. **Given** a light theme is selected
   **When** the theme applies
   **Then** the `.dark` class is removed and light theme CSS variables are applied

## Tasks / Subtasks

- [x] Task 1: Create theme definitions and types (AC: #5, #6, #7)
  - [x] 1.1: Create `types/theme.ts` with Theme interface and theme ID type union
  - [x] 1.2: Create `lib/themes.ts` with all 14 Glance theme definitions (HSL to OKLCH conversion)
  - [x] 1.3: Write unit tests for theme definitions

- [x] Task 2: Create theme store with persistence (AC: #3, #4)
  - [x] 2.1: Create `stores/themeStore.ts` with Zustand persist middleware
  - [x] 2.2: Store current theme ID, expose setTheme action
  - [x] 2.3: Write unit tests for theme store

- [x] Task 3: Create theme application hook (AC: #2, #6, #7)
  - [x] 3.1: Create `hooks/useTheme.ts` hook that applies theme to CSS variables
  - [x] 3.2: Handle dark/light mode class toggling on document root
  - [x] 3.3: Dynamically update CSS custom properties based on theme
  - [x] 3.4: Write unit tests for useTheme hook

- [x] Task 4: Create ThemePicker UI component (AC: #1, #2, #5)
  - [x] 4.1: Create `components/ThemePicker.tsx` with popover trigger button
  - [x] 4.2: Use shadcn/ui Popover component for theme selection dropdown
  - [x] 4.3: Display themes grouped by dark/light categories
  - [x] 4.4: Show color preview swatches for each theme
  - [x] 4.5: Highlight currently selected theme
  - [x] 4.6: Close popover on theme selection
  - [x] 4.7: Write unit tests for ThemePicker component

- [x] Task 5: Integrate ThemePicker into MainView header (AC: #1, #3)
  - [x] 5.1: Add ThemePicker button to MainView header (between connection status and channel name)
  - [x] 5.2: Initialize theme on app mount via useTheme hook
  - [x] 5.3: Write integration tests

- [x] Task 6: Integrate ThemePicker into ErsatzTVView header (AC: #1, #3)
  - [x] 6.1: Add ThemePicker button to ErsatzTVView header (consistent placement)
  - [x] 6.2: Ensure theme state syncs across views
  - [x] 6.3: Write integration tests

- [x] Task 7: Update index.css with theme variable structure (AC: #6, #7)
  - [x] 7.1: Ensure CSS variables can be overridden dynamically via JS
  - [x] 7.2: Add any missing theme-related CSS custom properties
  - [x] 7.3: Verify contrast ratios meet NFR14 for all themes

## Dev Notes

### Theme Color System (Glance Format)

Glance themes use HSL format with space-separated values (H S L). The app currently uses OKLCH. Conversion approach:
- Convert HSL to OKLCH using CSS color library or manual calculation
- The `--background`, `--primary`, `--foreground` etc. CSS variables need to be updated

**Glance Theme Variables:**
- `background` → maps to `--background`
- `primary` → maps to `--primary`
- `positive` → maps to `--chart-2` or create new variable
- `negative` → maps to `--destructive`
- `contrast-multiplier` → apply to computed contrast values
- `text-saturation-multiplier` → adjust saturation of text colors

### Key Dark Themes

| Theme | Background (HSL) | Primary (HSL) | Contrast |
|-------|------------------|---------------|----------|
| Catppuccin Mocha | 240 21 15 | 217 92 83 | 1.2 |
| Dracula | 231 15 21 | 265 89 79 | 1.2 |
| Gruvbox Dark | 0 0 16 | 43 59 81 | 1.0 |
| Neon Pink | 240 27 11 | 321 100 71 | 1.5 |

### Key Light Themes

| Theme | Background (HSL) | Primary (HSL) | Contrast |
|-------|------------------|---------------|----------|
| Catppuccin Latte | 220 23 95 | 220 91 54 | 1.0 |
| Zebra | 0 0 95 | 0 0 10 | 1.0 |
| Peachy | 28 40 77 | 155 100 20 | 1.1 |

### Architecture Compliance

- **State Management:** Use Zustand with persist middleware (existing pattern in `uiStore.ts`)
- **CSS Variables:** Override existing shadcn/ui CSS custom properties defined in `index.css`
- **Component Library:** Use shadcn/ui Popover component for theme selector
- **Named Exports:** All components use named exports per project rules
- **Persistence Key:** Use separate storage key `theme-storage` to avoid conflicts

### File Structure

```
frontend/src/
├── types/
│   └── theme.ts          # Theme type definitions
├── lib/
│   └── themes.ts         # Theme definitions with color values
├── stores/
│   └── themeStore.ts     # Zustand store for theme state
├── hooks/
│   └── useTheme.ts       # Hook for applying theme to DOM
├── components/
│   └── ThemePicker.tsx   # Theme selection UI component
```

### Testing Strategy

- Unit tests for theme definitions (valid color formats)
- Unit tests for themeStore (persistence, state changes)
- Unit tests for useTheme hook (DOM updates, class toggling)
- Component tests for ThemePicker (rendering, selection, closing)
- Integration tests verifying theme persists across navigation

### Project Structure Notes

- All new files follow existing naming conventions
- Theme state goes in new store, not in uiStore (separation of concerns)
- ThemePicker placement: header, consistent across both views
- Leverage existing CSS custom property structure from shadcn/ui

### References

- [Source: index.css] - Existing CSS variable structure (lines 47-114)
- [Source: uiStore.ts] - Zustand persist pattern for reference
- [Source: MainView.tsx] - Header layout structure (lines 84-127)
- [Source: ErsatzTVView.tsx] - Header layout structure (lines 140-183)
- [Source: Glance themes.md] - Theme color definitions from Glance project
- [Source: project-context.md] - Coding standards and conventions

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None - all tasks completed without issues.

### Completion Notes List

- Implemented complete theme picker feature with 14 Glance-inspired themes (11 dark, 3 light)
- Created type-safe theme system with ThemeId union type and Theme interface
- Used OKLCH color space for all theme colors to match shadcn/ui's CSS variable structure
- Zustand persist middleware stores theme preference in localStorage with key 'theme-storage'
- useTheme hook dynamically applies CSS custom properties and toggles dark/light mode class
- ThemePicker component uses shadcn/ui Popover with color preview swatches and category grouping
- Theme syncs across views via shared Zustand store
- All 513 tests pass (60 new tests added for theme functionality)
- Build completes successfully with no TypeScript errors

### File List

**New Files:**
- frontend/src/types/theme.ts
- frontend/src/lib/themes.ts
- frontend/src/lib/themes.test.ts
- frontend/src/stores/themeStore.ts
- frontend/src/stores/themeStore.test.ts
- frontend/src/hooks/useTheme.ts
- frontend/src/hooks/useTheme.test.ts
- frontend/src/components/ThemePicker.tsx
- frontend/src/components/ThemePicker.test.tsx
- frontend/src/components/ui/popover.tsx (shadcn/ui component)

**Modified Files:**
- frontend/src/components/MainView.tsx (added ThemePicker and useTheme)
- frontend/src/components/ersatztv/ErsatzTVView.tsx (added ThemePicker and useTheme)
- frontend/src/index.css (added TV mode exceptions for popover content)
- frontend/package.json (@radix-ui/react-popover dependency added by shadcn)

## Change Log

- 2026-01-04: Implemented theme picker feature with 14 Glance themes, Zustand persistence, and integration into both views. All acceptance criteria satisfied.
- 2026-01-04: Fixed ThemePicker placement consistency across views and TV mode popover sizing.
