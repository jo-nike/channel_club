# Story 7.8: Vidstack HLS Player Component

Status: ready-for-dev

## Story

As a user,
I want to watch ErsatzTV HLS streams,
so that I can enjoy movie channels.

## Acceptance Criteria

1. **HLS playback**: HLSVideoPlayer component loads and plays HLS streams using vidstack
2. **Video controls**: Users can play/pause, adjust volume, mute, and toggle fullscreen
3. **Buffering indicator**: Loading indicator is shown when stream is buffering
4. **Error handling**: Error message is displayed when stream fails to load

## Acceptance Criteria

1. **HLS playback**: HLSVideoPlayer component loads and plays HLS streams using vidstack
2. **Video controls**: Users can play/pause, adjust volume, mute, and toggle fullscreen
3. **Buffering indicator**: Loading indicator is shown when stream is buffering
4. **Error handling**: Error message is displayed when stream fails to load

## Tasks / Subtasks

- [ ] Task 1: Create HLSVideoPlayer component (AC: #1)
  - [ ] Create `src/components/ersatztv/HLSVideoPlayer.tsx`
  - [ ] Import vidstack player and providers
  - [ ] Configure HLS source with proxied stream URL
  - [ ] Handle autoplay with muted fallback
- [ ] Task 2: Implement video controls (AC: #2)
  - [ ] Add play/pause button using vidstack controls
  - [ ] Add volume slider with mute toggle
  - [ ] Add fullscreen button
  - [ ] Style controls with Tailwind for 10-foot UI
- [ ] Task 3: Add buffering state handling (AC: #3)
  - [ ] Listen to vidstack buffering events
  - [ ] Display loading spinner overlay during buffering
  - [ ] Hide spinner when playback resumes
- [ ] Task 4: Implement error handling (AC: #4)
  - [ ] Listen to vidstack error events
  - [ ] Display error message overlay
  - [ ] Provide retry or channel selection guidance
- [ ] Task 5: Write tests
  - [ ] Test component renders with stream URL
  - [ ] Test controls visibility and functionality
  - [ ] Test buffering state display
  - [ ] Test error state display

## Dev Notes

### Architecture Compliance

- **Component location**: `src/components/ersatztv/HLSVideoPlayer.tsx`
- **Named exports**: `export function HLSVideoPlayer()`
- **Vidstack version**: 1.12.13+ (already installed)
- **Styling**: Tailwind CSS, 10-foot UI compliant (44px touch targets)

### Critical: Vidstack vs Current mpegts.js

The existing `VideoPlayer.tsx` uses `mpegts.js` for MPEG-TS live streams from Dispatcharr. ErsatzTV provides HLS streams, so this component uses **vidstack's native HLS support** instead.

**DO NOT modify the existing VideoPlayer.tsx** - this is a new component for ErsatzTV HLS streams.

### Technical Implementation

**HLSVideoPlayer component** (`src/components/ersatztv/HLSVideoPlayer.tsx`):
```typescript
import { useRef, useState, useCallback, useEffect } from 'react'
import {
  MediaPlayer,
  MediaProvider,
  type MediaPlayerInstance,
} from '@vidstack/react'
import {
  defaultLayoutIcons,
  DefaultVideoLayout,
} from '@vidstack/react/player/layouts/default'
import '@vidstack/react/player/styles/default/theme.css'
import '@vidstack/react/player/styles/default/layouts/video.css'

interface HLSVideoPlayerProps {
  streamUrl: string
  title?: string
  onError?: (error: Error) => void
}

export function HLSVideoPlayer({ streamUrl, title, onError }: HLSVideoPlayerProps) {
  const playerRef = useRef<MediaPlayerInstance>(null)
  const [isBuffering, setIsBuffering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleError = useCallback((e: Error) => {
    setError('Stream unavailable')
    onError?.(e)
  }, [onError])

  // Reset error when stream URL changes
  useEffect(() => {
    setError(null)
    setIsBuffering(true)
  }, [streamUrl])

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black">
        <div className="rounded-lg bg-destructive/20 p-6 text-center">
          <p className="text-xl font-semibold text-destructive-foreground">{error}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Select another channel from the list
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full bg-black">
      <MediaPlayer
        ref={playerRef}
        src={streamUrl}
        title={title}
        autoPlay
        playsInline
        className="h-full w-full"
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onError={(e) => handleError(new Error(e.message || 'Playback error'))}
      >
        <MediaProvider />
        <DefaultVideoLayout icons={defaultLayoutIcons} />
      </MediaPlayer>

      {/* Buffering overlay */}
      {isBuffering && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-white border-t-transparent" />
        </div>
      )}
    </div>
  )
}
```

### Alternative: Custom Controls Version

If default vidstack layout doesn't meet 10-foot UI requirements, use custom controls:

```typescript
import {
  MediaPlayer,
  MediaProvider,
  PlayButton,
  MuteButton,
  VolumeSlider,
  FullscreenButton,
  useMediaState,
} from '@vidstack/react'

export function HLSVideoPlayer({ streamUrl, title }: HLSVideoPlayerProps) {
  return (
    <MediaPlayer src={streamUrl} title={title} autoPlay playsInline>
      <MediaProvider />

      {/* Custom controls overlay */}
      <div className="video-controls absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 p-4">
        <div className="flex items-center gap-4">
          <PlayButton className="h-12 w-12 rounded-full bg-white/20 hover:bg-white/30" />
          <MuteButton className="h-10 w-10" />
          <VolumeSlider className="h-2 w-32" />
          <div className="flex-1" />
          <FullscreenButton className="h-10 w-10" />
        </div>
      </div>
    </MediaPlayer>
  )
}
```

### Props Interface

```typescript
interface HLSVideoPlayerProps {
  streamUrl: string       // Proxied HLS manifest URL: /api/ersatztv/stream/{channelId}
  title?: string          // Channel or programme title for accessibility
  poster?: string         // Optional poster image URL
  onError?: (error: Error) => void  // Error callback for parent handling
  onReady?: () => void    // Callback when playback starts
}
```

### Vidstack CSS Import

Add to `src/index.css` or component:
```css
@import '@vidstack/react/player/styles/default/theme.css';
@import '@vidstack/react/player/styles/default/layouts/video.css';
```

Or import directly in component (as shown above).

### Project Structure Notes

**New files:**
- `frontend/src/components/ersatztv/HLSVideoPlayer.tsx`
- `frontend/src/components/ersatztv/HLSVideoPlayer.test.tsx`

**No modifications to:**
- `frontend/src/components/VideoPlayer.tsx` - existing MPEG-TS player for live TV

### Testing Requirements

```typescript
// src/components/ersatztv/HLSVideoPlayer.test.tsx
import { render, screen } from '@testing-library/react'
import { HLSVideoPlayer } from './HLSVideoPlayer'

// Mock vidstack to avoid HLS loading in tests
vi.mock('@vidstack/react', () => ({
  MediaPlayer: ({ children, onError }: any) => (
    <div data-testid="media-player">{children}</div>
  ),
  MediaProvider: () => <div data-testid="media-provider" />,
}))

describe('HLSVideoPlayer', () => {
  it('renders player with stream URL', () => {
    render(<HLSVideoPlayer streamUrl="http://test/stream.m3u8" />)
    expect(screen.getByTestId('media-player')).toBeInTheDocument()
  })

  it('shows buffering overlay initially', () => {
    render(<HLSVideoPlayer streamUrl="http://test/stream.m3u8" />)
    expect(screen.getByRole('status')).toBeInTheDocument() // spinner
  })

  it('displays error message on failure', async () => {
    // Trigger error scenario
    const onError = vi.fn()
    render(
      <HLSVideoPlayer
        streamUrl="http://invalid/stream.m3u8"
        onError={onError}
      />
    )
    // Simulate error via test
  })
})
```

### 10-Foot UI Compliance

- Minimum button size: 44px (h-11 w-11)
- High contrast controls on dark background
- Clear focus indicators for keyboard navigation
- Large touch targets for remote control

### Anti-Patterns to Avoid

- **DO NOT use default export** - use named export
- **DO NOT modify existing VideoPlayer.tsx** - this is a separate component
- **DO NOT hardcode stream URLs** - receive via props
- **DO NOT use inline styles** - use Tailwind classes
- **DO NOT forget CSS imports** - vidstack requires theme CSS

### References

- [Source: frontend/src/components/VideoPlayer.tsx] - Existing player pattern (uses mpegts.js)
- [Source: frontend/package.json] - Vidstack already installed
- [Source: _bmad-output/project-context.md#10-foot-ui-rules] - UI requirements
- [Vidstack React Docs](https://vidstack.io/docs/react) - Official documentation

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

