# Story 7.12: Programme Details Modal

Status: review

## Story

As a user,
I want to see full programme details,
so that I can decide if I want to watch it.

## Acceptance Criteria

1. **Details display**: Modal shows title, time range, description, and category when clicking a programme
2. **Watch button**: Clicking "Watch" button closes modal and starts playing that channel
3. **Close modal**: Modal closes when clicking outside or pressing Escape

## Tasks / Subtasks

- [x] Task 1: Create ProgrammeDetailsModal component (AC: #1)
  - [x] Create `src/components/ersatztv/ProgrammeDetailsModal.tsx`
  - [x] Display programme title prominently
  - [x] Show formatted time range (start - end)
  - [x] Display description text
  - [x] Show category/genre badges if available
- [x] Task 2: Implement Watch button (AC: #2)
  - [x] Add "Watch" button with primary styling
  - [x] Call onWatch callback with channel info
  - [x] Close modal after watch is triggered
- [x] Task 3: Implement modal closing (AC: #3)
  - [x] Close on backdrop click
  - [x] Close on Escape key press
  - [x] Add explicit close button (X)
- [x] Task 4: Add accessibility features
  - [x] Focus trap within modal
  - [x] Restore focus on close
  - [x] ARIA labels and roles
- [x] Task 5: Write tests
  - [x] Test programme details display
  - [x] Test Watch button callback
  - [x] Test close interactions

## Dev Notes

### Architecture Compliance

- **Component location**: `src/components/ersatztv/ProgrammeDetailsModal.tsx`
- **Named exports**: `export function ProgrammeDetailsModal()`
- **Styling**: Tailwind CSS, shadcn/ui Dialog component
- **Accessibility**: Use Radix Dialog for proper modal behavior

### Technical Implementation

**Using shadcn/ui Dialog** (`src/components/ersatztv/ProgrammeDetailsModal.tsx`):
```typescript
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { ErsatzTVProgramme, ErsatzTVChannel } from '@/types'

interface ProgrammeDetailsModalProps {
  programme: ErsatzTVProgramme | null
  channel: ErsatzTVChannel | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onWatch: (channel: ErsatzTVChannel) => void
}

export function ProgrammeDetailsModal({
  programme,
  channel,
  open,
  onOpenChange,
  onWatch,
}: ProgrammeDetailsModalProps) {
  if (!programme || !channel) return null

  const startTime = new Date(programme.start)
  const endTime = new Date(programme.stop)
  const duration = Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60))

  const handleWatch = () => {
    onWatch(channel)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl">{programme.title}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p className="text-muted-foreground">
                {formatTime(startTime)} - {formatTime(endTime)} ({duration} min)
              </p>
              <p className="text-sm text-muted-foreground">
                on {channel.name}
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        {/* Programme details */}
        <div className="space-y-4 py-4">
          {/* Categories */}
          {programme.category && programme.category.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {programme.category.map((cat, i) => (
                <Badge key={i} variant="secondary">
                  {cat}
                </Badge>
              ))}
            </div>
          )}

          {/* Description */}
          {programme.description && (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <p>{programme.description}</p>
            </div>
          )}

          {/* No description fallback */}
          {!programme.description && (
            <p className="text-sm text-muted-foreground italic">
              No description available
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={handleWatch}>
            Watch Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}
```

### Alternative: Custom Modal (no shadcn/ui dependency)

If shadcn/ui Dialog is not available, implement custom modal:

```typescript
import { useEffect, useRef } from 'react'

export function ProgrammeDetailsModal({
  programme,
  channel,
  open,
  onOpenChange,
  onWatch,
}: ProgrammeDetailsModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  // Focus trap and escape handler
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement
      modalRef.current?.focus()

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onOpenChange(false)
        }
      }

      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    } else {
      previousFocusRef.current?.focus()
    }
  }, [open, onOpenChange])

  if (!open || !programme || !channel) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2
                   rounded-lg border bg-card p-6 shadow-lg"
      >
        {/* Close button */}
        <button
          onClick={() => onOpenChange(false)}
          className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100"
          aria-label="Close"
        >
          <svg width="15" height="15" viewBox="0 0 15 15">
            <path
              d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z"
              fill="currentColor"
            />
          </svg>
        </button>

        {/* Content */}
        <h2 id="modal-title" className="text-2xl font-semibold">
          {programme.title}
        </h2>
        {/* ... rest of content ... */}
      </div>
    </>
  )
}
```

### Usage in EPGGrid

```typescript
// In EPGGrid.tsx or ErsatzTVView.tsx parent:
const [modalOpen, setModalOpen] = useState(false)
const [selectedProgramme, setSelectedProgramme] = useState<ErsatzTVProgramme | null>(null)
const [selectedChannel, setSelectedChannel] = useState<ErsatzTVChannel | null>(null)

const handleProgrammeClick = (programme: ErsatzTVProgramme, channel: ErsatzTVChannel) => {
  setSelectedProgramme(programme)
  setSelectedChannel(channel)
  setModalOpen(true)
}

const handleWatch = (channel: ErsatzTVChannel) => {
  selectChannel(channel) // From store
  // Player will update automatically
}

return (
  <>
    <EPGGrid onProgrammeClick={handleProgrammeClick} />
    <ProgrammeDetailsModal
      programme={selectedProgramme}
      channel={selectedChannel}
      open={modalOpen}
      onOpenChange={setModalOpen}
      onWatch={handleWatch}
    />
  </>
)
```

### Project Structure Notes

**New files:**
- `frontend/src/components/ersatztv/ProgrammeDetailsModal.tsx`
- `frontend/src/components/ersatztv/ProgrammeDetailsModal.test.tsx`

**Dependencies:**
- `@/components/ui/dialog` - shadcn/ui dialog (already installed)
- `@/components/ui/button` - shadcn/ui button
- `@/components/ui/badge` - shadcn/ui badge (may need to add)

### Add Badge Component (if missing)

```bash
npx shadcn-ui@latest add badge
```

### Testing Requirements

```typescript
// src/components/ersatztv/ProgrammeDetailsModal.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { ProgrammeDetailsModal } from './ProgrammeDetailsModal'

describe('ProgrammeDetailsModal', () => {
  const mockProgramme = {
    id: 'p1',
    channelId: 'ch1',
    title: 'Test Movie',
    description: 'A test movie description',
    start: '2026-01-03T14:00:00Z',
    stop: '2026-01-03T16:00:00Z',
    category: ['Movie', 'Comedy'],
  }

  const mockChannel = {
    id: 'ch1',
    name: 'Comedy Classics',
    number: 1,
    group: 'Movies',
    streamUrl: '',
    logoUrl: '',
  }

  const defaultProps = {
    programme: mockProgramme,
    channel: mockChannel,
    open: true,
    onOpenChange: vi.fn(),
    onWatch: vi.fn(),
  }

  it('displays programme title', () => {
    render(<ProgrammeDetailsModal {...defaultProps} />)
    expect(screen.getByText('Test Movie')).toBeInTheDocument()
  })

  it('displays time range', () => {
    render(<ProgrammeDetailsModal {...defaultProps} />)
    // Time format depends on locale, check for pattern
    expect(screen.getByText(/\d+:\d+/)).toBeInTheDocument()
  })

  it('displays description', () => {
    render(<ProgrammeDetailsModal {...defaultProps} />)
    expect(screen.getByText('A test movie description')).toBeInTheDocument()
  })

  it('displays category badges', () => {
    render(<ProgrammeDetailsModal {...defaultProps} />)
    expect(screen.getByText('Movie')).toBeInTheDocument()
    expect(screen.getByText('Comedy')).toBeInTheDocument()
  })

  it('calls onWatch when Watch button clicked', () => {
    const onWatch = vi.fn()
    render(<ProgrammeDetailsModal {...defaultProps} onWatch={onWatch} />)

    fireEvent.click(screen.getByText('Watch Now'))
    expect(onWatch).toHaveBeenCalledWith(mockChannel)
  })

  it('closes modal when Watch button clicked', () => {
    const onOpenChange = vi.fn()
    render(<ProgrammeDetailsModal {...defaultProps} onOpenChange={onOpenChange} />)

    fireEvent.click(screen.getByText('Watch Now'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('closes modal on Close button click', () => {
    const onOpenChange = vi.fn()
    render(<ProgrammeDetailsModal {...defaultProps} onOpenChange={onOpenChange} />)

    fireEvent.click(screen.getByText('Close'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('returns null when programme is null', () => {
    const { container } = render(
      <ProgrammeDetailsModal {...defaultProps} programme={null} />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
```

### Accessibility Checklist

- [x] Uses role="dialog" and aria-modal="true"
- [x] Modal title has id and aria-labelledby reference
- [x] Focus trapped within modal
- [x] Focus returns to trigger on close
- [x] Escape key closes modal
- [x] Buttons have clear labels

### Anti-Patterns to Avoid

- **DO NOT use default export** - use named export
- **DO NOT forget focus management** - use shadcn/ui Dialog which handles this
- **DO NOT use inline event handlers** - extract to named functions
- **DO NOT render modal when closed** - check open prop first
- **DO NOT forget to close modal on Watch** - user expects immediate action

### References

- [Source: frontend/src/components/ui/dialog.tsx] - shadcn/ui Dialog component
- [Source: frontend/src/components/ui/button.tsx] - shadcn/ui Button
- [Source: frontend/src/types/index.ts] - ErsatzTV types
- [Source: _bmad-output/project-context.md] - Component patterns

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None - implementation completed without issues.

### Completion Notes List

- Implemented ProgrammeDetailsModal component using shadcn/ui Dialog, Button, and Badge
- Added Dialog and Badge shadcn/ui components (dialog.tsx, badge.tsx)
- Component displays programme title, formatted time range with duration, channel name, description, and category badges
- Watch Now button triggers onWatch callback with channel info and closes modal
- Modal closes on backdrop click (via Radix Dialog), Escape key (via Radix Dialog), explicit Close button, and X icon
- Accessibility features provided by Radix Dialog: focus trap, focus restoration, ARIA roles
- All 15 unit tests pass covering details display, callbacks, close interactions, and null handling
- Full regression suite passes (414 tests)
- Linting passes

### File List

**New files:**
- frontend/src/components/ersatztv/ProgrammeDetailsModal.tsx
- frontend/src/components/ersatztv/ProgrammeDetailsModal.test.tsx
- frontend/src/components/ui/dialog.tsx (shadcn/ui)
- frontend/src/components/ui/badge.tsx (shadcn/ui)

**Modified files:**
- frontend/package.json (added @radix-ui/react-dialog dependency)
- frontend/package-lock.json

## Change Log

- 2026-01-03: Implemented ProgrammeDetailsModal component with shadcn/ui Dialog, full test coverage, and accessibility support

