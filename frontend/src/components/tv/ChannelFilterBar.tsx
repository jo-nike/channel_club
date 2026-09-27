import { useEffect, useRef } from 'react'
import { Search, Star, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useChannelPrefsStore, type ChannelFilterMode } from '@/stores/channelPrefsStore'
import { cn } from '@/lib/utils'

const CHIPS: { mode: ChannelFilterMode; label: string }[] = [
  { mode: 'all', label: 'All' },
  { mode: 'favourites', label: 'Favourites' },
  { mode: 'recent', label: 'Recent' },
]

interface ChannelFilterBarProps {
  // Stacked in the sidebar; one row in the guide, which is wide but short
  layout?: 'stacked' | 'inline'
  className?: string
}

/**
 * The channel search box and the All, Favourites and Recent chips. The
 * filter lives in channelPrefsStore, so the sidebar and the guide show the
 * same channels and it survives either one unmounting.
 */
export function ChannelFilterBar({ layout = 'stacked', className }: ChannelFilterBarProps) {
  const query = useChannelPrefsStore((s) => s.filter.query)
  const mode = useChannelPrefsStore((s) => s.filter.mode)
  const setFilterQuery = useChannelPrefsStore((s) => s.setFilterQuery)
  const setFilterMode = useChannelPrefsStore((s) => s.setFilterMode)
  const inputRef = useRef<HTMLInputElement>(null)

  // '/' asks for the search box; this one is on screen, so it takes focus,
  // with what's there selected so typing replaces it
  const searchFocusRequested = useChannelPrefsStore((s) => s.searchFocusRequested)
  const clearSearchFocusRequest = useChannelPrefsStore((s) => s.clearSearchFocusRequest)
  useEffect(() => {
    if (!searchFocusRequested) return
    clearSearchFocusRequest()
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [searchFocusRequested, clearSearchFocusRequest])

  const clearQuery = () => {
    setFilterQuery('')
    // Back to the box, rather than losing focus with the button that went away
    inputRef.current?.focus()
  }

  return (
    <div
      role="search"
      aria-label="Channels"
      className={cn(layout === 'inline' ? 'flex items-center gap-3' : 'space-y-2', className)}
    >
      <div className={cn('relative', layout === 'inline' && 'w-72 min-w-0 shrink')}>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder="Search channels and shows"
          aria-label="Search channels and shows"
          aria-keyshortcuts="/"
          autoComplete="off"
          spellCheck={false}
          className="pr-8 pl-8"
        />
        {/* The shortcut, while there's room for it */}
        {!query && (
          <kbd
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-b-2 border-border bg-muted px-1.5 font-mono text-xs font-semibold text-muted-foreground pointer-coarse:hidden"
          >
            /
          </kbd>
        )}
        {query && (
          <button
            type="button"
            onClick={clearQuery}
            aria-label="Clear search"
            className="absolute top-1/2 right-1 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div role="group" aria-label="Show" className="flex gap-1.5">
        {CHIPS.map((chip) => {
          const isOn = mode === chip.mode
          return (
            <button
              key={chip.mode}
              type="button"
              aria-pressed={isOn}
              // Pressing the chip that's on goes back to All
              onClick={() => setFilterMode(isOn ? 'all' : chip.mode)}
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold whitespace-nowrap transition-colors',
                isOn
                  ? 'border-transparent bg-foreground text-background'
                  : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {chip.mode === 'favourites' && <Star aria-hidden="true" className="h-3.5 w-3.5" />}
              {chip.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Where the channels would be when the filter leaves none (row 0 always
 * stays, so nothing after it): says so, with a Clear that resets the search
 * and chips. Shared by the sidebar and the guide.
 */
export function NoChannelsMatch({ className }: { className?: string }) {
  const clearFilter = useChannelPrefsStore((s) => s.clearFilter)
  return (
    <div className={cn('flex flex-col items-center gap-3 p-6 text-center', className)}>
      <p className="text-sm text-muted-foreground">No channels match</p>
      <Button variant="outline" size="sm" onClick={clearFilter}>
        Clear
      </Button>
    </div>
  )
}
