import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useFilterStore, FILTER_REGISTRY } from './filterStore'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
  }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

describe('filterStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useFilterStore.setState({ activeFilters: [] })
    localStorageMock.clear()
  })

  describe('FILTER_REGISTRY', () => {
    it('should contain retro-tv filter as first entry', () => {
      expect(FILTER_REGISTRY[0].id).toBe('retro-tv')
      expect(FILTER_REGISTRY[0].name).toBe('Retro TV')
    })

    it('should have valid filter definitions', () => {
      FILTER_REGISTRY.forEach((filter) => {
        expect(filter.id).toBeTruthy()
        expect(filter.name).toBeTruthy()
        expect(filter.description).toBeTruthy()
      })
    })
  })

  describe('toggleFilter', () => {
    it('should add filter when not active', () => {
      const { toggleFilter, activeFilters } = useFilterStore.getState()

      toggleFilter('retro-tv')

      expect(useFilterStore.getState().activeFilters).toContain('retro-tv')
    })

    it('should remove filter when already active', () => {
      useFilterStore.setState({ activeFilters: ['retro-tv'] })
      const { toggleFilter } = useFilterStore.getState()

      toggleFilter('retro-tv')

      expect(useFilterStore.getState().activeFilters).not.toContain('retro-tv')
    })

    it('should handle multiple filters', () => {
      const { toggleFilter } = useFilterStore.getState()

      toggleFilter('retro-tv')
      toggleFilter('film-grain')

      const state = useFilterStore.getState()
      expect(state.activeFilters).toContain('retro-tv')
      expect(state.activeFilters).toContain('film-grain')
    })
  })

  describe('isFilterActive', () => {
    it('should return true for active filter', () => {
      useFilterStore.setState({ activeFilters: ['retro-tv'] })
      const { isFilterActive } = useFilterStore.getState()

      expect(isFilterActive('retro-tv')).toBe(true)
    })

    it('should return false for inactive filter', () => {
      useFilterStore.setState({ activeFilters: [] })
      const { isFilterActive } = useFilterStore.getState()

      expect(isFilterActive('retro-tv')).toBe(false)
    })
  })

  describe('getActiveFilters', () => {
    it('should return empty array when no filters active', () => {
      const { getActiveFilters } = useFilterStore.getState()

      expect(getActiveFilters()).toEqual([])
    })

    it('should return all active filters', () => {
      useFilterStore.setState({ activeFilters: ['retro-tv', 'film-grain'] })
      const { getActiveFilters } = useFilterStore.getState()

      expect(getActiveFilters()).toEqual(['retro-tv', 'film-grain'])
    })
  })

  describe('persistence', () => {
    it('should use filter-storage key for persistence', () => {
      // The persist middleware should use 'filter-storage' as the key
      // This is verified by the store configuration
      expect(useFilterStore.persist.getOptions().name).toBe('filter-storage')
    })

    it('should have persist middleware configured for state restoration (AC #6)', () => {
      // Verify persist middleware is properly configured
      const persistOptions = useFilterStore.persist.getOptions()

      // Should persist activeFilters state
      expect(persistOptions.name).toBe('filter-storage')

      // Verify the store has the persist API (hasHydrated, rehydrate, etc.)
      expect(typeof useFilterStore.persist.hasHydrated).toBe('function')
      expect(typeof useFilterStore.persist.rehydrate).toBe('function')
      expect(typeof useFilterStore.persist.clearStorage).toBe('function')

      // Verify state structure supports persistence (activeFilters array)
      const state = useFilterStore.getState()
      expect(Array.isArray(state.activeFilters)).toBe(true)
    })
  })
})
