import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, AlertCircle, RefreshCw } from 'lucide-react'
import { useDebounce } from '@/hooks/useDebounce'
import { fetchTrending, searchGifs, type GifItem } from '@/services/gifApi'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { logger } from '@/lib/logger'

export interface GifPickerProps {
  onSelect: (gifUrl: string) => void
  onClose: () => void
}

const DEBOUNCE_MS = 300
const PAGE_SIZE = 25

export function GifPicker({ onSelect, onClose }: GifPickerProps) {
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState<GifItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)

  const debouncedQuery = useDebounce(query, DEBOUNCE_MS)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  // Load trending on mount
  useEffect(() => {
    loadTrending()
    // Focus input after render
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  // Search when debounced query changes
  useEffect(() => {
    if (debouncedQuery) {
      search(debouncedQuery, 0)
    } else if (debouncedQuery === '' && query === '') {
      // Only reload trending if user cleared the search
      loadTrending()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery])

  // Set up infinite scroll observer
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect()
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading && !loadingMore && hasMore && debouncedQuery) {
          loadMore()
        }
      },
      { threshold: 0.1 }
    )

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current)
    }

    return () => observerRef.current?.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, loadingMore, hasMore, debouncedQuery, offset])

  const loadTrending = useCallback(async () => {
    setLoading(true)
    setError(null)
    setQuery('')

    try {
      const data = await fetchTrending(PAGE_SIZE)
      setGifs(data.gifs)
      setOffset(0)
      setHasMore(false) // Trending doesn't support pagination
      logger.debug('GIF', `Loaded ${data.gifs.length} trending GIFs`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load GIFs'
      setError(message)
      logger.error('GIF', `Failed to load trending: ${message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  const search = useCallback(async (q: string, off: number) => {
    if (off === 0) {
      setLoading(true)
      setGifs([])
    } else {
      setLoadingMore(true)
    }
    setError(null)

    try {
      const data = await searchGifs(q, off, PAGE_SIZE)
      if (off === 0) {
        setGifs(data.gifs)
      } else {
        setGifs((prev) => [...prev, ...data.gifs])
      }
      setOffset(off)
      // Check if there are more results
      setHasMore(data.gifs.length === PAGE_SIZE)
      logger.debug('GIF', `Search "${q}" returned ${data.gifs.length} GIFs (offset=${off})`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Search failed'
      setError(message)
      logger.error('GIF', `Search failed: ${message}`)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  const loadMore = useCallback(() => {
    if (debouncedQuery && !loadingMore && hasMore) {
      search(debouncedQuery, offset + PAGE_SIZE)
    }
  }, [debouncedQuery, loadingMore, hasMore, offset, search])

  const handleSelect = useCallback(
    (gif: GifItem) => {
      logger.debug('GIF', `Selected GIF: ${gif.id}`)
      onSelect(gif.url)
      onClose()
    },
    [onSelect, onClose]
  )

  const handleRetry = useCallback(() => {
    if (debouncedQuery) {
      search(debouncedQuery, 0)
    } else {
      loadTrending()
    }
  }, [debouncedQuery, search, loadTrending])

  return (
    <div className="flex flex-col w-full h-full max-h-[400px] sm:max-h-[450px]">
      {/* Search input */}
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="text"
            placeholder="Search GIFs..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* GIF grid */}
      <div ref={gridRef} className="flex-1 overflow-y-auto p-2 min-h-0">
        {error ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-4">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={handleRetry}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        ) : loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-md" />
            ))}
          </div>
        ) : gifs.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground">No GIFs found</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {gifs.map((gif) => (
                <button
                  key={gif.id}
                  onClick={() => handleSelect(gif)}
                  className="aspect-square overflow-hidden rounded-md hover:ring-2 ring-primary transition-all focus:outline-none focus:ring-2 focus:ring-primary bg-accent/30"
                  title={gif.title || 'GIF'}
                >
                  <img
                    src={gif.previewUrl}
                    alt={gif.title || 'GIF'}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
            {/* Infinite scroll trigger */}
            {hasMore && (
              <div ref={loadMoreRef} className="h-8 mt-2">
                {loadingMore && (
                  <div className="flex justify-center py-2">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 w-full">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="aspect-square rounded-md" />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Powered by Giphy attribution */}
      <div className="px-3 py-2 border-t border-border">
        <p className="text-xs text-muted-foreground text-center">Powered by GIPHY</p>
      </div>
    </div>
  )
}
