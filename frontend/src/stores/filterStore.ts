import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Filter definition interface for the extensible filter registry.
 * New filters can be added by extending FILTER_REGISTRY without restructuring.
 */
export interface FilterDefinition {
  id: string
  name: string
  description: string
}

/**
 * Filter registry - add new filters here.
 * Components are rendered separately to avoid circular dependencies.
 */
export const FILTER_REGISTRY: FilterDefinition[] = [
  {
    id: 'retro-tv',
    name: 'Retro TV',
    description: 'CRT scanlines and VHS tracking effects',
  },
  {
    id: 'film-grain',
    name: 'Film Grain',
    description: '8mm film texture with subtle flicker',
  },
  {
    id: 'noir',
    name: 'Noir',
    description: 'Black & white with high contrast',
  },
  {
    id: 'grindhouse',
    name: 'Grindhouse',
    description: 'Damaged film: scratches, burns, splices',
  },
]

interface FilterState {
  /** List of currently active filter IDs */
  activeFilters: string[]
  /** Toggle a filter on/off */
  toggleFilter: (filterId: string) => void
  /** Check if a specific filter is active */
  isFilterActive: (filterId: string) => boolean
  /** Get all active filters */
  getActiveFilters: () => string[]
}

export const useFilterStore = create<FilterState>()(
  persist(
    (set, get) => ({
      activeFilters: [],

      toggleFilter: (filterId: string) =>
        set((state) => ({
          activeFilters: state.activeFilters.includes(filterId)
            ? state.activeFilters.filter((id) => id !== filterId)
            : [...state.activeFilters, filterId],
        })),

      isFilterActive: (filterId: string) => get().activeFilters.includes(filterId),

      getActiveFilters: () => get().activeFilters,
    }),
    {
      name: 'filter-storage',
    }
  )
)
