import { useState, type RefObject } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useFilterStore, FILTER_REGISTRY } from '@/stores/filterStore'
import { useMediaQuery } from '@/hooks/useMediaQuery'

/** Filter toggle row. Declared at module scope so it keeps its identity across renders. */
function FilterToggle({ filter }: { filter: (typeof FILTER_REGISTRY)[0] }) {
  const { toggleFilter, isFilterActive } = useFilterStore()
  const isActive = isFilterActive(filter.id)

  return (
    <button
      type="button"
      onClick={() => toggleFilter(filter.id)}
      className={`flex w-full items-center justify-between rounded-lg p-3 text-left transition-colors ${
        isActive
          ? 'bg-primary/20 hover:bg-primary/30'
          : 'hover:bg-muted'
      }`}
      aria-pressed={isActive}
    >
      <div className="flex flex-col items-start gap-0.5">
        <span className="font-medium">{filter.name}</span>
        <span className="text-xs text-muted-foreground">{filter.description}</span>
      </div>
      <div
        className={`h-6 w-11 rounded-full transition-colors ${
          isActive ? 'bg-primary' : 'bg-muted-foreground/30'
        } relative`}
      >
        <div
          className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${
            isActive ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </div>
    </button>
  )
}

/** Filter list content, shared between the Popover and Dialog layouts. */
function FilterList() {
  return (
    <div className="flex flex-col gap-2">
      {FILTER_REGISTRY.map((filter) => (
        <FilterToggle key={filter.id} filter={filter} />
      ))}
    </div>
  )
}

interface FilterMenuProps {
  /** Whether the control is visible (for tabIndex management) */
  isVisible: boolean
  /** Container ref for portal rendering (needed for fullscreen support) */
  containerRef?: RefObject<HTMLElement | null>
}

/**
 * Filter menu component for selecting video filter effects.
 * Uses Popover on desktop, Dialog (bottom sheet) on mobile.
 */
export function FilterMenu({ isVisible, containerRef }: FilterMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [portalContainer, setPortalContainer] = useState<HTMLElement | undefined>(undefined)
  const isMobile = useMediaQuery('(max-width: 768px)')
  const activeFilters = useFilterStore((s) => s.activeFilters)

  const hasActiveFilters = activeFilters.length > 0

  // The menu portals into the player container, which is also the element the
  // player fullscreens, so it shows in and out of fullscreen alike. Refs are
  // not render-time values: resolve it as the menu opens, when it is populated.
  const handleOpenChange = (open: boolean) => {
    if (open) {
      setPortalContainer(containerRef?.current ?? undefined)
    }
    setIsOpen(open)
  }

  // Trigger button
  const TriggerButton = (
    <button
      type="button"
      tabIndex={isVisible ? 0 : -1}
      aria-label="Video filters"
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      className={`control-button relative flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-ring-media ${
        hasActiveFilters ? 'text-primary' : 'text-white'
      }`}
    >
      <SlidersHorizontal className="h-6 w-6" />
      {/* Active indicator dot */}
      {hasActiveFilters && (
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary" />
      )}
    </button>
  )

  // Mobile: Use Dialog as bottom sheet
  if (isMobile) {
    return (
      <div className="relative">
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div onClick={() => handleOpenChange(true)}>{TriggerButton}</div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Filters</p>
            </TooltipContent>
          </Tooltip>
          <DialogContent
            className="bottom-0 top-auto translate-y-0 rounded-t-xl rounded-b-none max-w-full sm:max-w-lg"
            container={portalContainer}
          >
            <DialogHeader>
              <DialogTitle>Video Filters</DialogTitle>
            </DialogHeader>
            <FilterList />
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // Desktop: Use Popover
  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>{TriggerButton}</PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p>Filters</p>
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        className="w-72"
        side="top"
        align="start"
        sideOffset={8}
        container={portalContainer}
      >
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold">Video Filters</h3>
          <FilterList />
        </div>
      </PopoverContent>
    </Popover>
  )
}
