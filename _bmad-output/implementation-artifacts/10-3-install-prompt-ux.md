# Story 10.3: Install Prompt UX

Status: review

## Story

As a user,
I want to be prompted to install the app,
So that I know the install option exists.

## Acceptance Criteria

1. **Given** I am on a supported browser and haven't installed the PWA
   **When** I visit the app
   **Then** an unobtrusive install prompt appears (banner or button)

2. **Given** I click "Install" on the prompt
   **When** the browser install flow triggers
   **Then** the app is added to my device

3. **Given** I have already installed or dismissed
   **When** I visit again
   **Then** the install prompt does not reappear

4. **Given** I am on a TV browser
   **When** viewing the app
   **Then** install prompt is keyboard/d-pad accessible

## Tasks / Subtasks

- [x] Task 1: Create PWA install hook (AC: #1, #3)
  - [x] Create useInstallPrompt hook
  - [x] Capture beforeinstallprompt event
  - [x] Track dismissed/installed state in localStorage
  - [x] Provide install trigger function

- [x] Task 2: Create InstallPrompt component (AC: #1, #4)
  - [x] Create unobtrusive banner/toast UI
  - [x] Add "Install" and "Not now" buttons
  - [x] Ensure keyboard accessibility (Tab, Enter)
  - [x] Style consistent with app theme
  - [x] Position non-intrusively (bottom of screen)

- [x] Task 3: Handle installation lifecycle (AC: #2, #3)
  - [x] Call prompt.prompt() on install click
  - [x] Handle userChoice outcome
  - [x] Mark as installed in localStorage
  - [x] Hide prompt after installation

- [x] Task 4: Handle dismissal (AC: #3)
  - [x] On "Not now" click, set dismissed flag
  - [x] Store dismissal timestamp in localStorage
  - [x] Optionally re-show after 7 days

- [x] Task 5: Integrate with app layout (AC: #1, #4)
  - [x] Add InstallPrompt to App.tsx
  - [x] Ensure proper z-index (above content, below modals)
  - [x] Test with existing video player and overlays

## Dev Notes

### Technical Approach

Use the `beforeinstallprompt` event to capture the browser's install prompt, then show a custom UI that triggers it when the user clicks "Install".

### useInstallPrompt Hook

Create `src/hooks/useInstallPrompt.ts`:

```typescript
import { useState, useEffect } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const STORAGE_KEY = 'pwa-install-state'

interface InstallState {
  installed: boolean
  dismissed: boolean
  dismissedAt?: number
}

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [canInstall, setCanInstall] = useState(false)

  useEffect(() => {
    // Check if already installed or dismissed
    const state = getInstallState()
    if (state.installed || isRecentlyDismissed(state)) {
      return
    }

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setCanInstall(true)
    }

    window.addEventListener('beforeinstallprompt', handler)

    // Handle appinstalled event
    window.addEventListener('appinstalled', () => {
      setInstallState({ installed: true, dismissed: false })
      setCanInstall(false)
    })

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
    }
  }, [])

  const install = async () => {
    if (!deferredPrompt) return false

    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice

    if (outcome === 'accepted') {
      setInstallState({ installed: true, dismissed: false })
      setCanInstall(false)
      return true
    }

    return false
  }

  const dismiss = () => {
    setInstallState({
      installed: false,
      dismissed: true,
      dismissedAt: Date.now()
    })
    setCanInstall(false)
  }

  return { canInstall, install, dismiss }
}

function getInstallState(): InstallState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : { installed: false, dismissed: false }
  } catch {
    return { installed: false, dismissed: false }
  }
}

function setInstallState(state: InstallState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function isRecentlyDismissed(state: InstallState): boolean {
  if (!state.dismissed || !state.dismissedAt) return false
  const sevenDays = 7 * 24 * 60 * 60 * 1000
  return Date.now() - state.dismissedAt < sevenDays
}
```

### InstallPrompt Component

Create `src/components/InstallPrompt.tsx`:

```typescript
import { Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'

export function InstallPrompt() {
  const { canInstall, install, dismiss } = useInstallPrompt()

  if (!canInstall) return null

  return (
    <div
      className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96
                 bg-slate-800 border border-slate-700 rounded-lg shadow-lg p-4
                 flex items-center gap-4 z-40 animate-in slide-in-from-bottom"
      role="dialog"
      aria-labelledby="install-prompt-title"
    >
      <Download className="h-8 w-8 text-blue-400 flex-shrink-0" />

      <div className="flex-1 min-w-0">
        <h3 id="install-prompt-title" className="font-semibold text-white">
          Install App
        </h3>
        <p className="text-sm text-slate-400 truncate">
          Add to home screen for quick access
        </p>
      </div>

      <div className="flex gap-2 flex-shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
        >
          <X className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          onClick={install}
          className="bg-blue-600 hover:bg-blue-700"
        >
          Install
        </Button>
      </div>
    </div>
  )
}
```

### Integration in App.tsx

```typescript
import { InstallPrompt } from '@/components/InstallPrompt'

function App() {
  return (
    <ThemeProvider>
      {/* ... existing app content */}
      <InstallPrompt />
    </ThemeProvider>
  )
}
```

### 10-Foot UI Considerations

For TV/keyboard navigation:
- Buttons have minimum 44px touch targets
- Full keyboard navigation (Tab to focus, Enter to activate)
- Clear focus indicators using existing Tailwind focus states
- Position at bottom doesn't interfere with video controls

### Animation

Using Tailwind's `animate-in` utilities for smooth appearance:
```css
.animate-in {
  animation: slideInFromBottom 0.3s ease-out;
}

@keyframes slideInFromBottom {
  from {
    transform: translateY(100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
```

Or use the existing `tw-animate-css` package in the project.

### Project Structure Notes

Files to create:
- `frontend/src/hooks/useInstallPrompt.ts` - New hook
- `frontend/src/components/InstallPrompt.tsx` - New component

Files to modify:
- `frontend/src/App.tsx` - Add InstallPrompt

### Browser Support Notes

- Chrome (Android/Desktop): Full support
- Safari (iOS): Uses separate "Add to Home Screen" in share menu, `beforeinstallprompt` not supported
- Firefox: Limited PWA support
- TV browsers (WebOS/Tizen): May have limited support, test early

For iOS, consider adding instructions in a separate prompt since automatic install isn't available.

### Testing Checklist

1. Build and serve: `npm run build && npm run preview`
2. Open in Chrome (must be HTTPS or localhost)
3. Verify install prompt appears after page load
4. Click "Install" - verify browser prompt appears
5. Complete installation - verify prompt disappears
6. Uninstall and revisit - prompt should reappear
7. Click "Not now" - verify prompt disappears
8. Revisit within 7 days - prompt should stay hidden
9. Test keyboard navigation (Tab, Enter, Escape)

### localStorage Keys

- `pwa-install-state`: JSON with `{ installed, dismissed, dismissedAt }`

### References

- [Source: _bmad-output/project-planning-artifacts/epics.md#Story 10.3]
- [Source: _bmad-output/project-context.md#10-Foot UI Rules]
- [Web.dev PWA Install](https://web.dev/articles/customize-install)
- [beforeinstallprompt event](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None

### Completion Notes List

- Created `useInstallPrompt` hook with full PWA install prompt lifecycle management
- Hook captures `beforeinstallprompt` event and defers browser prompt
- Tracks install/dismiss state in localStorage with 7-day dismissal cooldown
- Created `InstallPrompt` component with accessible dialog UI
- Component uses shadcn/ui Button and lucide-react icons
- Positioned fixed at bottom with z-index 40 (above content, below modals)
- Minimum 44px touch targets for 10-foot UI compliance
- Full keyboard accessibility with Tab navigation and Enter activation
- Integrated into App.tsx for global availability
- 29 tests added covering hook and component behavior
- All 618 tests pass, linting passes, build succeeds

### File List

- frontend/src/hooks/useInstallPrompt.ts (new)
- frontend/src/hooks/useInstallPrompt.test.ts (new)
- frontend/src/components/InstallPrompt.tsx (new)
- frontend/src/components/InstallPrompt.test.tsx (new)
- frontend/src/App.tsx (modified)

## Change Log

- 2026-01-04: Implemented PWA install prompt UX - hook, component, and integration
