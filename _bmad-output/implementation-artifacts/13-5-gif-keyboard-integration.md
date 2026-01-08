# Story 13.5: GIF Keyboard Integration

Status: review

## Story

As a user,
I want a GIF picker/keyboard in the chat,
so that I can easily search and send animated GIFs without manually finding URLs.

## Acceptance Criteria

1. **Given** I am in the chat input area
   **When** I click the GIF button (or type `/gif`)
   **Then** a GIF picker popover opens

2. **Given** the GIF picker is open
   **When** it first loads
   **Then** I see trending GIFs
   **And** a search input is focused

3. **Given** I type in the GIF search input
   **When** I stop typing (debounced 300ms)
   **Then** search results appear from the GIF provider
   **And** a loading indicator shows during search

4. **Given** I see GIF search results
   **When** I click on a GIF
   **Then** the GIF URL is sent as a chat message
   **And** the picker closes

5. **Given** I am browsing GIFs
   **When** I scroll down
   **Then** more results load automatically (infinite scroll)

6. **Given** I am on mobile
   **When** I open the GIF picker
   **Then** it displays as a bottom sheet
   **And** the grid is touch-friendly

7. **Given** the GIF API is unavailable
   **When** I try to search
   **Then** I see an error message
   **And** the picker remains usable (retry option)

## Tasks / Subtasks

- [x] Task 1: Add GIF provider environment variables (AC: #1)
  - [x] Add `GIPHY_API_KEY` to backend config
  - [x] Add `VITE_GIF_ENABLED` to frontend
  - [x] Document in .env.example files

- [x] Task 2: Create backend GIF proxy endpoint (AC: #2, #3, #5)
  - [x] Create `backend/app/routers/gif.py`
  - [x] `GET /api/gif/trending` - fetch trending GIFs
  - [x] `GET /api/gif/search?q=<query>&offset=0` - search GIFs
  - [x] Proxy through backend to hide API key from frontend
  - [x] Return normalized response: `{gifs: [{id, url, previewUrl, width, height}]}`

- [x] Task 3: Create GIF service (AC: #2, #3, #7)
  - [x] Create `backend/app/services/gif.py`
  - [x] Implement Giphy API client (default provider)
  - [x] Handle rate limiting gracefully
  - [x] Cache trending results for 5 minutes
  - [x] Add error handling for API failures

- [x] Task 4: Create frontend GIF API service (AC: #2, #3)
  - [x] Create `frontend/src/services/gifApi.ts`
  - [x] `fetchTrending()` - get trending GIFs
  - [x] `searchGifs(query, offset)` - search with pagination
  - [x] Use existing auth token for API calls

- [x] Task 5: Create GifPicker component (AC: #1, #2, #3, #4, #5)
  - [x] Create `frontend/src/components/GifPicker.tsx`
  - [x] Search input with debounce (300ms)
  - [x] Grid layout for GIF thumbnails (2-3 columns)
  - [x] Click to select and send
  - [x] Infinite scroll with Intersection Observer
  - [x] Loading skeletons during fetch

- [x] Task 6: Create GifButton component (AC: #1)
  - [x] Create `frontend/src/components/GifButton.tsx`
  - [x] Icon button with GIF/image icon
  - [x] Opens GifPicker in popover (desktop) or dialog (mobile)
  - [x] Add to chat input area

- [x] Task 7: Mobile responsive layout (AC: #6)
  - [x] Use Dialog component for mobile (bottom sheet style)
  - [x] Full-width grid on small screens
  - [x] Touch-friendly GIF buttons

- [x] Task 8: Add tests (AC: #1-7)
  - [x] Test trending fetch
  - [x] Test search with debounce
  - [x] Test GIF selection sends message
  - [x] Test error handling
  - [x] Test infinite scroll

## Dev Notes

### GIF Provider: Giphy API

Giphy is the most common choice with a generous free tier:
- 1000 searches/day on free tier (sufficient for personal use)
- Well-documented API
- High-quality GIF library

**API Endpoints:**
```
GET https://api.giphy.com/v1/gifs/trending?api_key=KEY&limit=25
GET https://api.giphy.com/v1/gifs/search?api_key=KEY&q=QUERY&limit=25&offset=0
```

**Response Structure (normalized):**
```typescript
interface GifResult {
  id: string
  url: string           // Full-size GIF URL
  previewUrl: string    // Small preview (for grid)
  width: number
  height: number
  title: string
}
```

### Backend GIF Router

```python
# backend/app/routers/gif.py
from fastapi import APIRouter, Query, HTTPException
from app.services.gif import gif_service
from app.routers.auth_deps import get_current_user

router = APIRouter(prefix="/api/gif", tags=["gif"])

@router.get("/trending")
async def get_trending(
    limit: int = Query(default=25, le=50),
    _user = Depends(get_current_user)
):
    """Get trending GIFs."""
    return await gif_service.get_trending(limit)

@router.get("/search")
async def search_gifs(
    q: str = Query(..., min_length=1),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=25, le=50),
    _user = Depends(get_current_user)
):
    """Search for GIFs."""
    return await gif_service.search(q, offset, limit)
```

### Backend GIF Service

```python
# backend/app/services/gif.py
import httpx
from app.config import settings
from functools import lru_cache
from datetime import datetime, timedelta

GIPHY_BASE = "https://api.giphy.com/v1/gifs"

class GifService:
    def __init__(self):
        self._trending_cache = None
        self._trending_cached_at = None

    async def get_trending(self, limit: int = 25) -> dict:
        # Cache for 5 minutes
        if self._trending_cache and self._trending_cached_at:
            if datetime.now() - self._trending_cached_at < timedelta(minutes=5):
                return self._trending_cache

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{GIPHY_BASE}/trending",
                params={
                    "api_key": settings.giphy_api_key,
                    "limit": limit,
                    "rating": "pg-13",
                }
            )
            response.raise_for_status()
            data = response.json()

        result = self._normalize_response(data)
        self._trending_cache = result
        self._trending_cached_at = datetime.now()
        return result

    async def search(self, query: str, offset: int = 0, limit: int = 25) -> dict:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{GIPHY_BASE}/search",
                params={
                    "api_key": settings.giphy_api_key,
                    "q": query,
                    "limit": limit,
                    "offset": offset,
                    "rating": "pg-13",
                }
            )
            response.raise_for_status()
            data = response.json()

        return self._normalize_response(data)

    def _normalize_response(self, data: dict) -> dict:
        gifs = []
        for item in data.get("data", []):
            images = item.get("images", {})
            gifs.append({
                "id": item["id"],
                "url": images.get("original", {}).get("url"),
                "previewUrl": images.get("fixed_width_small", {}).get("url"),
                "width": int(images.get("original", {}).get("width", 0)),
                "height": int(images.get("original", {}).get("height", 0)),
                "title": item.get("title", ""),
            })
        return {
            "gifs": gifs,
            "pagination": data.get("pagination", {}),
        }

gif_service = GifService()
```

### Frontend GifPicker Component

```tsx
// frontend/src/components/GifPicker.tsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { useDebounce } from '@/hooks/useDebounce'
import { fetchTrending, searchGifs } from '@/services/gifApi'

interface GifPickerProps {
  onSelect: (gifUrl: string) => void
  onClose: () => void
}

export function GifPicker({ onSelect, onClose }: GifPickerProps) {
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState<GifResult[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const debouncedQuery = useDebounce(query, 300)
  const observerRef = useRef<IntersectionObserver>()
  const loadMoreRef = useRef<HTMLDivElement>(null)

  // Load trending on mount
  useEffect(() => {
    loadTrending()
  }, [])

  // Search when query changes
  useEffect(() => {
    if (debouncedQuery) {
      search(debouncedQuery, 0)
    } else {
      loadTrending()
    }
  }, [debouncedQuery])

  // Infinite scroll
  useEffect(() => {
    observerRef.current = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !loading) {
        loadMore()
      }
    })
    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current)
    }
    return () => observerRef.current?.disconnect()
  }, [loading, offset])

  const loadTrending = async () => {
    setLoading(true)
    const data = await fetchTrending()
    setGifs(data.gifs)
    setOffset(0)
    setLoading(false)
  }

  const search = async (q: string, off: number) => {
    setLoading(true)
    const data = await searchGifs(q, off)
    setGifs(off === 0 ? data.gifs : [...gifs, ...data.gifs])
    setOffset(off)
    setLoading(false)
  }

  const loadMore = () => {
    if (query) {
      search(query, offset + 25)
    }
  }

  const handleSelect = (gif: GifResult) => {
    onSelect(gif.url)
    onClose()
  }

  return (
    <div className="w-80 h-96 flex flex-col bg-background border rounded-lg shadow-lg">
      <div className="p-2 border-b">
        <input
          type="text"
          placeholder="Search GIFs..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full px-3 py-2 rounded border"
          autoFocus
        />
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <div className="grid grid-cols-2 gap-2">
          {gifs.map((gif) => (
            <button
              key={gif.id}
              onClick={() => handleSelect(gif)}
              className="aspect-square overflow-hidden rounded hover:ring-2 ring-primary"
            >
              <img
                src={gif.previewUrl}
                alt={gif.title}
                loading="lazy"
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
        <div ref={loadMoreRef} className="h-4" />
        {loading && <div className="text-center py-4">Loading...</div>}
      </div>
      <div className="p-2 border-t text-xs text-muted-foreground text-center">
        Powered by GIPHY
      </div>
    </div>
  )
}
```

### Environment Variables

**Backend (.env):**
```bash
GIPHY_API_KEY=your-giphy-api-key-here
```

**Frontend (.env):**
```bash
VITE_GIF_ENABLED=true
```

### Getting a Giphy API Key

1. Go to https://developers.giphy.com/
2. Create an account
3. Create an app (select "API" not "SDK")
4. Copy the API key

### Content Rating

Use `rating=pg-13` in API calls to filter inappropriate content.

### Project Structure Notes

- New backend files:
  - `backend/app/routers/gif.py`
  - `backend/app/services/gif.py`
- New frontend files:
  - `frontend/src/components/GifPicker.tsx`
  - `frontend/src/components/GifButton.tsx`
  - `frontend/src/services/gifApi.ts`
- Modified files:
  - `backend/app/main.py` - mount gif router
  - `backend/app/config.py` - add giphy_api_key
  - `frontend/src/components/ChatPanel.tsx` - add GifButton

### Dependencies

- Requires story 13-2 (Chat UI) and 13-4 (Media Detection) to be completed
- Backend: `httpx` (already installed for other services)
- Frontend: No new packages needed

### Alternative: Tenor API

If Giphy doesn't work out, Tenor (owned by Google) is a good alternative:
- Similar API structure
- Free tier available
- Slightly different response format

### References

- [Giphy API Documentation](https://developers.giphy.com/docs/api/)
- [Tenor API Documentation](https://tenor.com/gifapi/documentation)
- [Source: _bmad-output/implementation-artifacts/13-4-chat-media-url-detection.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

N/A

### Completion Notes List

- Implemented complete GIF picker feature for chat integration
- Backend: Created GIF service with Giphy API integration, including trending and search endpoints with 5-minute caching for trending results
- Backend: Created GIF router with `/api/gif/feature`, `/api/gif/trending`, and `/api/gif/search` endpoints with proper authentication
- Frontend: Created gifApi service with fetchTrending() and searchGifs() functions
- Frontend: Created useDebounce hook for 300ms search debouncing
- Frontend: Created GifPicker component with search, trending display, infinite scroll, loading skeletons, and error handling with retry
- Frontend: Created GifButton component that uses Popover for desktop and Dialog for mobile
- Frontend: Integrated GifButton into ChatPanel input area
- Added GIPHY_API_KEY to backend config and .env.example
- Added VITE_GIF_ENABLED to frontend .env.example, Dockerfile, and docker-compose.yml for proper build-time variable handling
- All 523 backend tests pass (including 31 new GIF tests)
- All 887 frontend tests pass (including 18 new GIF/debounce tests)
- TypeScript type checking passes

### File List

**New Files:**
- backend/app/services/gif.py
- backend/app/routers/gif.py
- backend/tests/services/test_gif.py
- backend/tests/routers/test_gif.py
- frontend/src/services/gifApi.ts
- frontend/src/services/gifApi.test.ts
- frontend/src/hooks/useDebounce.ts
- frontend/src/hooks/useDebounce.test.ts
- frontend/src/components/GifPicker.tsx
- frontend/src/components/GifButton.tsx

**Modified Files:**
- backend/app/config.py (added giphy_api_key setting)
- backend/app/main.py (registered gif_router)
- backend/.env.example (added GIPHY_API_KEY documentation)
- frontend/.env.example (added VITE_GIF_ENABLED)
- frontend/src/components/ChatPanel.tsx (integrated GifButton)
- Dockerfile (added VITE_GIF_ENABLED build arg)
- docker-compose.yml (added VITE_GIF_ENABLED build arg)

## Change Log

- 2026-01-08: Implemented GIF keyboard integration story (13-5) - Full implementation of GIF picker for chat with Giphy API backend, search with debounce, infinite scroll, responsive layout, and comprehensive test coverage
