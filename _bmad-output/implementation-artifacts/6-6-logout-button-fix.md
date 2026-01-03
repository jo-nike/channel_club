# Story 6.6: Logout Button Fix

Status: ready-for-dev

## Story

As a user,
I want the logout button to display correctly,
so that text doesn't overflow the button boundaries.

## Acceptance Criteria

1. **Text fits button**: "Logout" text fits within button boundaries
2. **No overflow/clipping**: No text overflow or clipping occurs
3. **Minimum touch target**: Button maintains minimum 44px height (10-foot UI requirement)
4. **Narrow viewport handling**: On narrow viewports, button adjusts appropriately (icon-only or proper wrapping)

## Tasks / Subtasks

- [ ] Task 1: Audit current logout button (AC: #1, #2)
  - [ ] Identify any CSS issues causing overflow
  - [ ] Check current padding and sizing
- [ ] Task 2: Fix button styling (AC: #1, #2, #3)
  - [ ] Ensure `whitespace-nowrap` to prevent text breaking
  - [ ] Adjust padding if needed
  - [ ] Verify 44px minimum height maintained (`h-12` = 48px, already compliant)
- [ ] Task 3: Handle narrow viewports (AC: #4)
  - [ ] Option A: Use icon-only on very narrow screens
  - [ ] Option B: Ensure proper flex behavior with `shrink-0`
- [ ] Task 4: Test across breakpoints
  - [ ] Mobile
  - [ ] Tablet
  - [ ] Desktop
- [ ] Task 5: Update tests if needed

## Dev Notes

### Architecture Compliance

- **Component location**: `frontend/src/components/MainView.tsx`
- **Styling**: Tailwind CSS

### Technical Implementation

**Current logout button** (MainView.tsx lines 104-109):
```tsx
<button
  onClick={logout}
  className="h-12 px-6 text-lg bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
>
  Logout
</button>
```

**Issues to address**:
1. No `whitespace-nowrap` - text could wrap if space is constrained
2. No `shrink-0` - button could shrink in flex container
3. Text might clip if parent container becomes too narrow

**Recommended fix**:
```tsx
<button
  onClick={logout}
  className="h-12 px-4 md:px-6 text-base md:text-lg whitespace-nowrap shrink-0 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
>
  Logout
</button>
```

Changes:
- `whitespace-nowrap` - Prevents text wrapping
- `shrink-0` - Prevents flex shrinking
- `px-4 md:px-6` - Slightly less padding on mobile
- `text-base md:text-lg` - Slightly smaller text on mobile

### Alternative: Icon on Mobile

If space is very constrained, consider icon-only on mobile:
```tsx
<button
  onClick={logout}
  className="h-12 w-12 md:w-auto md:px-6 text-lg shrink-0 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 flex items-center justify-center"
  aria-label="Logout"
>
  <LogOut className="h-5 w-5 md:hidden" />
  <span className="hidden md:inline">Logout</span>
</button>
```

This would require importing `LogOut` from `lucide-react`.

### Header Context

The header uses `flex justify-between items-center`. The logout button is in a `flex items-center gap-2` container alongside the menu button. If header gets crowded (title + channel name + connection status + menu + logout), the logout button should not shrink.

### Slimmer Header Impact

Story 6-1 reduces header padding from `p-4` to `p-2`. This makes vertical space tighter. The button must still maintain its touch target size (`h-12` = 48px) which exceeds the 44px minimum.

### Key Considerations

1. **Height**: `h-12` (48px) already exceeds 44px minimum - keep it
2. **Padding**: May need to reduce horizontal padding on mobile
3. **Font size**: May need smaller font on mobile
4. **No shrink**: Button should never shrink smaller than its content

### Project Structure Notes

Modified files:
- `frontend/src/components/MainView.tsx` - Logout button styling

### Testing Requirements

- Visual test: Button looks correct on all breakpoints
- Text visible and not clipped
- Button clickable (touch target adequate)
- Keyboard accessible (focus ring visible)

### References

- [Source: frontend/src/components/MainView.tsx#104-109] - Current logout button
- [Source: _bmad-output/project-context.md#10-Foot-UI-Rules] - 44px minimum touch target
- [Source: lucide-react] - LogOut icon if using icon approach

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
