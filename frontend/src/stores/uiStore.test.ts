import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from './uiStore'

describe('uiStore', () => {
  beforeEach(() => {
    // Reset the store between tests
    useUIStore.setState({ isTheaterMode: false, isSidebarOpen: false })
    localStorage.clear()
  })

  describe('isTheaterMode', () => {
    it('defaults to false', () => {
      const state = useUIStore.getState()
      expect(state.isTheaterMode).toBe(false)
    })

    it('can be set to true', () => {
      useUIStore.getState().setTheaterMode(true)
      expect(useUIStore.getState().isTheaterMode).toBe(true)
    })

    it('can be set to false', () => {
      useUIStore.getState().setTheaterMode(true)
      useUIStore.getState().setTheaterMode(false)
      expect(useUIStore.getState().isTheaterMode).toBe(false)
    })
  })

  describe('toggleTheaterMode', () => {
    it('toggles from false to true', () => {
      useUIStore.getState().toggleTheaterMode()
      expect(useUIStore.getState().isTheaterMode).toBe(true)
    })

    it('toggles from true to false', () => {
      useUIStore.getState().setTheaterMode(true)
      useUIStore.getState().toggleTheaterMode()
      expect(useUIStore.getState().isTheaterMode).toBe(false)
    })
  })

  describe('persistence', () => {
    it('uses persist middleware with correct storage key', () => {
      // Verify the store is configured with persist middleware
      // The persist middleware adds a `persist` property to the store
      expect(useUIStore.persist).toBeDefined()
      expect(useUIStore.persist.getOptions().name).toBe('ui-storage')
    })
  })

  describe('isSidebarOpen', () => {
    it('defaults to false', () => {
      const state = useUIStore.getState()
      expect(state.isSidebarOpen).toBe(false)
    })

    it('can be set to true', () => {
      useUIStore.getState().setSidebarOpen(true)
      expect(useUIStore.getState().isSidebarOpen).toBe(true)
    })

    it('can be set to false', () => {
      useUIStore.getState().setSidebarOpen(true)
      useUIStore.getState().setSidebarOpen(false)
      expect(useUIStore.getState().isSidebarOpen).toBe(false)
    })
  })

  describe('toggleSidebar', () => {
    it('toggles from false to true', () => {
      useUIStore.getState().toggleSidebar()
      expect(useUIStore.getState().isSidebarOpen).toBe(true)
    })

    it('toggles from true to false', () => {
      useUIStore.getState().setSidebarOpen(true)
      useUIStore.getState().toggleSidebar()
      expect(useUIStore.getState().isSidebarOpen).toBe(false)
    })
  })
})
