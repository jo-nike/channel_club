import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useFilterStore, FILTER_REGISTRY } from '@/stores/filterStore'
import { useMediaQuery } from '@/hooks/useMediaQuery'

interface FilterMenuProps {
  /** Whether the control is visible (for tabIndex management) */
  isVisible: boolean
}

/**
 * Filter menu component for selecting video filter effects.
 * Uses Popover on desktop, Dialog (bottom sheet) on mobile.
 */
export function FilterMenu({ isVisible }: FilterMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const isMobile = useMediaQuery('(max-width: 768px)')
  const { activeFilters, toggleFilter, isFilterActive } = useFilterStore()

  const hasActiveFilters = activeFilters.length > 0

  // Filter toggle row component
  const FilterToggle = ({ filter }: { filter: (typeof FILTER_REGISTRY)[0] }) => {
    const isActive = isFilterActive(filter.id)

    return (
      <button
        type="button"
        onClick={() => toggleFilter(filter.id)}
        className={`flex w-full items-center justify-between rounded-lg p-3 transition-colors ${
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

  // Filter list content (shared between Popover and Dialog)
  const FilterList = () => (
    <div className="flex flex-col gap-2">
      {FILTER_REGISTRY.map((filter) => (
        <FilterToggle key={filter.id} filter={filter} />
      ))}
    </div>
  )

  // Trigger button
  const TriggerButton = (
    <button
      type="button"
      tabIndex={isVisible ? 0 : -1}
      aria-label="Video filters"
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      className={`control-button relative flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/80 ${
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
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div onClick={() => setIsOpen(true)}>{TriggerButton}</div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Filters</p>
            </TooltipContent>
          </Tooltip>
          <DialogContent className="bottom-0 top-auto translate-y-0 rounded-t-xl rounded-b-none max-w-full sm:max-w-lg">
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
    <Popover open={isOpen} onOpenChange={setIsOpen}>
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
        align="center"
        sideOffset={8}
      >
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold">Video Filters</h3>
          <FilterList />
        </div>
      </PopoverContent>
    </Popover>
  )
}
