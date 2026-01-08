# Story 13.5: GIF Keyboard Integration

Status: ready-for-dev

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

- [ ] Task 1: Add GIF provider environment variables (AC: #1)
  - [ ] Add `GIPHY_API_KEY` to backend config
  - [ ] Add `VITE_GIF_PROVIDER` to frontend (giphy/tenor)
  - [ ] Document in .env.example files

- [ ] Task 2: Create backend GIF proxy endpoint (AC: #2, #3, #5)
  - [ ] Create `backend/app/routers/gif.py`
  - [ ] `GET /api/gif/trending` - fetch trending GIFs
  - [ ] `GET /api/gif/search?q=<query>&offset=0` - search GIFs
  - [ ] Proxy through backend to hide API key from frontend
  - [ ] Return normalized response: `{gifs: [{id, url, previewUrl, width, height}]}`

- [ ] Task 3: Create GIF service (AC: #2, #3, #7)
  - [ ] Create `backend/app/services/gif.py`
  - [ ] Implement Giphy API client (default provider)
  - [ ] Handle rate limiting gracefully
  - [ ] Cache trending results for 5 minutes
  - [ ] Add error handling for API failures

- [ ] Task 4: Create frontend GIF API service (AC: #2, #3)
  - [ ] Create `frontend/src/services/gifApi.ts`
  - [ ] `fetchTrending()` - get trending GIFs
  - [ ] `searchGifs(query, offset)` - search with pagination
  - [ ] Use existing auth token for API calls

- [ ] Task 5: Create GifPicker component (AC: #1, #2, #3, #4, #5)
  - [ ] Create `frontend/src/components/GifPicker.tsx`
  - [ ] Search input with debounce (300ms)
  - [ ] Grid layout for GIF thumbnails (2-3 columns)
  - [ ] Click to select and send
  - [ ] Infinite scroll with Intersection Observer
  - [ ] Loading skeletons during fetch

- [ ] Task 6: Create GifButton component (AC: #1)
  - [ ] Create `frontend/src/components/GifButton.tsx`
  - [ ] Icon button with GIF/image icon
  - [ ] Opens GifPicker in popover (desktop) or sheet (mobile)
  - [ ] Add to chat input area

- [ ] Task 7: Mobile responsive layout (AC: #6)
  - [ ] Use Sheet component for mobile
  - [ ] Full-width grid on small screens
  - [ ] Swipe to dismiss
  - [ ] Keyboard-aware positioning

- [ ] Task 8: Add tests (AC: #1-7)
  - [ ] Test trending fetch
  - [ ] Test search with debounce
  - [ ] Test GIF selection sends message
  - [ ] Test error handling
  - [ ] Test infinite scroll

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

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
