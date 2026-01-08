# Story 13.4: Chat Media URL Detection & Rendering

Status: review

## Story

As a user,
I want media URLs in chat messages to automatically render as embedded content,
so that I can share and view GIFs, videos, and images without leaving the chat.

## Acceptance Criteria

1. **Given** a chat message contains a `.gif` URL
   **When** the message is displayed
   **Then** the GIF renders inline as an animated image
   **And** the original URL is not shown as text

2. **Given** a chat message contains a `.gifv` URL (Imgur format)
   **When** the message is displayed
   **Then** the content renders as a looping video element
   **And** autoplay is enabled with muted audio

3. **Given** a chat message contains a `.webm` URL
   **When** the message is displayed
   **Then** the content renders as a looping video element
   **And** autoplay is enabled with muted audio

4. **Given** a chat message contains a `.mp4` URL
   **When** the message is displayed
   **Then** the content renders as a looping video element
   **And** autoplay is enabled with muted audio

5. **Given** a chat message contains mixed text and media URL
   **When** the message is displayed
   **Then** text renders normally AND media renders inline
   **And** layout is clean without breaking

6. **Given** a media URL fails to load
   **When** the error occurs
   **Then** a placeholder with "Media unavailable" is shown
   **And** the original URL is displayed as a clickable link fallback

7. **Given** I am on a slow connection
   **When** media is loading
   **Then** a loading placeholder is shown
   **And** lazy loading is used for off-screen media

## Tasks / Subtasks

- [x] Task 1: Create URL detection utility (AC: #1-4)
  - [x] Create `frontend/src/lib/mediaDetection.ts`
  - [x] Implement `detectMediaUrl(text: string) -> MediaMatch[]`
  - [x] Support patterns: `.gif`, `.gifv`, `.webm`, `.mp4`, `.png`, `.jpg`, `.jpeg`
  - [x] Handle Imgur, Giphy, Tenor, and generic URLs
  - [x] Return array of {type, url, startIndex, endIndex}

- [x] Task 2: Create ChatMediaEmbed component (AC: #1-4, #6, #7)
  - [x] Create `frontend/src/components/ChatMediaEmbed.tsx`
  - [x] Render `<img>` for GIF/image types
  - [x] Render `<video loop muted autoPlay playsInline>` for gifv/webm/mp4
  - [x] Add loading state with skeleton placeholder
  - [x] Add error state with fallback link
  - [x] Constrain max dimensions (e.g., max-w-64 max-h-48)

- [x] Task 3: Update ChatMessage component (AC: #5)
  - [x] Parse message content for media URLs
  - [x] Split content into text segments and media embeds
  - [x] Render mixed content cleanly
  - [x] Preserve message order (text before/after media)

- [x] Task 4: Add lazy loading (AC: #7)
  - [x] Use `loading="lazy"` for images
  - [x] Use Intersection Observer for videos
  - [x] Only autoplay videos when in viewport

- [x] Task 5: Handle special URL formats (AC: #2)
  - [x] Imgur .gifv → convert to .mp4 for better compatibility
  - [x] Giphy URLs → extract direct GIF URL
  - [x] Tenor URLs → extract direct GIF URL

- [x] Task 6: Add tests (AC: #1-7)
  - [x] Test URL detection for all formats
  - [x] Test mixed text + media rendering
  - [x] Test error fallback
  - [x] Test lazy loading behavior

## Dev Notes

### URL Detection Patterns

```typescript
// frontend/src/lib/mediaDetection.ts
const MEDIA_PATTERNS = {
  gif: /https?:\/\/[^\s]+\.gif(\?[^\s]*)?/gi,
  gifv: /https?:\/\/[^\s]+\.gifv(\?[^\s]*)?/gi,
  webm: /https?:\/\/[^\s]+\.webm(\?[^\s]*)?/gi,
  mp4: /https?:\/\/[^\s]+\.mp4(\?[^\s]*)?/gi,
  image: /https?:\/\/[^\s]+\.(png|jpg|jpeg|webp)(\?[^\s]*)?/gi,
}

export type MediaType = 'gif' | 'video' | 'image'

export interface MediaMatch {
  type: MediaType
  url: string
  originalUrl: string  // Before any transformations
  startIndex: number
  endIndex: number
}

export function detectMediaUrls(text: string): MediaMatch[] {
  // Implementation
}
```

### Imgur .gifv Handling

Imgur's `.gifv` is actually an HTML page that loads a video. Convert to direct video:

```typescript
function normalizeImgurUrl(url: string): string {
  // https://i.imgur.com/abc123.gifv → https://i.imgur.com/abc123.mp4
  if (url.includes('imgur.com') && url.endsWith('.gifv')) {
    return url.replace('.gifv', '.mp4')
  }
  return url
}
```

### ChatMediaEmbed Component

```tsx
// frontend/src/components/ChatMediaEmbed.tsx
interface ChatMediaEmbedProps {
  url: string
  type: MediaType
  onError?: () => void
}

export function ChatMediaEmbed({ url, type, onError }: ChatMediaEmbedProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  if (error) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer"
         className="text-blue-500 underline text-sm">
        Media unavailable - click to open
      </a>
    )
  }

  if (type === 'gif' || type === 'image') {
    return (
      <img
        src={url}
        alt="Shared media"
        loading="lazy"
        className="max-w-64 max-h-48 rounded object-contain"
        onLoad={() => setLoading(false)}
        onError={() => setError(true)}
      />
    )
  }

  // video types (gifv, webm, mp4)
  return (
    <video
      src={url}
      loop
      muted
      autoPlay
      playsInline
      className="max-w-64 max-h-48 rounded"
      onLoadedData={() => setLoading(false)}
      onError={() => setError(true)}
    />
  )
}
```

### Mixed Content Rendering

```tsx
// In ChatMessage.tsx
function renderContent(content: string) {
  const mediaMatches = detectMediaUrls(content)

  if (mediaMatches.length === 0) {
    return <p>{content}</p>
  }

  // Split content into segments
  const segments: React.ReactNode[] = []
  let lastIndex = 0

  for (const match of mediaMatches) {
    // Text before media
    if (match.startIndex > lastIndex) {
      segments.push(
        <span key={`text-${lastIndex}`}>
          {content.slice(lastIndex, match.startIndex)}
        </span>
      )
    }
    // Media embed
    segments.push(
      <ChatMediaEmbed
        key={`media-${match.startIndex}`}
        url={match.url}
        type={match.type}
      />
    )
    lastIndex = match.endIndex
  }

  // Text after last media
  if (lastIndex < content.length) {
    segments.push(
      <span key={`text-${lastIndex}`}>
        {content.slice(lastIndex)}
      </span>
    )
  }

  return <div className="flex flex-col gap-1">{segments}</div>
}
```

### Size Constraints

Keep embedded media reasonable to prevent chat flooding:

```css
/* Max dimensions for embedded media */
.chat-media {
  max-width: 16rem;  /* 256px */
  max-height: 12rem; /* 192px */
  object-fit: contain;
}
```

### Project Structure Notes

- New files:
  - `frontend/src/lib/mediaDetection.ts`
  - `frontend/src/components/ChatMediaEmbed.tsx`
- Modified files:
  - `frontend/src/components/ChatMessage.tsx`

### Dependencies

- Requires story 13-2 (Chat UI Component) to be completed first
- No additional npm packages needed

### References

- [Source: _bmad-output/implementation-artifacts/13-2-chat-ui-component.md]
- [Source: frontend/src/components/ChatMessage.tsx] - Component to modify
- [Imgur API docs for gifv format](https://api.imgur.com/)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

N/A - Implementation proceeded without blocking issues.

### Completion Notes List

- Created URL detection utility (`mediaDetection.ts`) with support for GIF, video (gifv/webm/mp4), and image formats
- Regex pattern sorted by extension length to ensure .gifv matches before .gif
- Imgur .gifv URLs automatically converted to .mp4 for direct video playback
- Created ChatMediaEmbed component with loading skeleton, error fallback, and size constraints
- Added IntersectionObserver for viewport-based video autoplay (pause when not visible)
- Updated ChatMessage component to parse and render mixed text/media content
- All tests pass (61 total: 31 mediaDetection, 17 ChatMediaEmbed, 13 ChatMessage)
- Full test suite passes with 869 tests total, no regressions
- Added IntersectionObserver mock to test setup for proper video testing

### File List

**New Files:**
- frontend/src/lib/mediaDetection.ts
- frontend/src/lib/mediaDetection.test.ts
- frontend/src/components/ChatMediaEmbed.tsx
- frontend/src/components/ChatMediaEmbed.test.tsx

**Modified Files:**
- frontend/src/components/ChatMessage.tsx
- frontend/src/components/ChatMessage.test.tsx
- frontend/src/test/setup.ts (added IntersectionObserver mock)

### Change Log

- 2026-01-08: Story 13.4 implemented - Chat Media URL Detection & Rendering complete
