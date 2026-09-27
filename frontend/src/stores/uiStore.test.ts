import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useUIStore } from './uiStore'

describe('uiStore', () => {
  beforeEach(() => {
    // Reset the store between tests
    useUIStore.setState({
      isTheaterMode: false,
      isSidebarOpen: false,
      isEPGVisible: false,
      epgHeightPercent: 25,
      isChannelSidebarCollapsed: false,
      notificationsEnabled: false,
    })
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

    it('no longer persists volume (the audio store owns it)', () => {
      useUIStore.getState().setSidebarOpen(true)
      const saved = JSON.parse(localStorage.getItem('ui-storage') ?? 'null')
      expect(saved.state.isSidebarOpen).toBe(true)
      expect(saved.state).not.toHaveProperty('volume')
      expect(useUIStore.getState()).not.toHaveProperty('setVolume')
    })

    it('lets the audio store seed from the legacy volume before ui-storage drops it', async () => {
      localStorage.setItem('ui-storage', JSON.stringify({ state: { volume: 0.3 }, version: 0 }))
      vi.resetModules()
      const { useUIStore: freshUIStore } = await import('./uiStore')
      freshUIStore.getState().setSidebarOpen(true)

      expect(JSON.parse(localStorage.getItem('ui-storage') ?? 'null').state).not.toHaveProperty('volume')
      const { useAudioStore } = await import('./audioStore')
      expect(useAudioStore.getState()).toMatchObject({ volume: 0.3, muted: false })
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

  describe('isEPGVisible', () => {
    it('defaults to closed', () => {
      expect(useUIStore.getInitialState().isEPGVisible).toBe(false)
      expect(useUIStore.getState().isEPGVisible).toBe(false)
    })

    it('can be set to true', () => {
      useUIStore.getState().setEPGVisible(true)
      expect(useUIStore.getState().isEPGVisible).toBe(true)
    })

    it('toggles from false to true', () => {
      useUIStore.getState().toggleEPG()
      expect(useUIStore.getState().isEPGVisible).toBe(true)
    })

    it('toggles from true to false', () => {
      useUIStore.getState().setEPGVisible(true)
      useUIStore.getState().toggleEPG()
      expect(useUIStore.getState().isEPGVisible).toBe(false)
    })
  })

  describe('epgHeightPercent', () => {
    it('defaults to 25', () => {
      const state = useUIStore.getState()
      expect(state.epgHeightPercent).toBe(25)
    })

    it('can be set to a valid value', () => {
      useUIStore.getState().setEPGHeightPercent(30)
      expect(useUIStore.getState().epgHeightPercent).toBe(30)
    })

    it('clamps to minimum of 15', () => {
      useUIStore.getState().setEPGHeightPercent(10)
      expect(useUIStore.getState().epgHeightPercent).toBe(15)
    })

    it('clamps to maximum of 50', () => {
      useUIStore.getState().setEPGHeightPercent(60)
      expect(useUIStore.getState().epgHeightPercent).toBe(50)
    })
  })

  describe('isChannelSidebarCollapsed', () => {
    it('defaults to false', () => {
      const state = useUIStore.getState()
      expect(state.isChannelSidebarCollapsed).toBe(false)
    })

    it('can be set to true', () => {
      useUIStore.getState().setChannelSidebarCollapsed(true)
      expect(useUIStore.getState().isChannelSidebarCollapsed).toBe(true)
    })

    it('toggles from false to true', () => {
      useUIStore.getState().toggleChannelSidebar()
      expect(useUIStore.getState().isChannelSidebarCollapsed).toBe(true)
    })

    it('toggles from true to false', () => {
      useUIStore.getState().setChannelSidebarCollapsed(true)
      useUIStore.getState().toggleChannelSidebar()
      expect(useUIStore.getState().isChannelSidebarCollapsed).toBe(false)
    })
  })

  describe('notificationsEnabled', () => {
    it('defaults to true', () => {
      expect(useUIStore.getInitialState().notificationsEnabled).toBe(true)
    })

    it('can be set to true', () => {
      useUIStore.getState().setNotificationsEnabled(true)
      expect(useUIStore.getState().notificationsEnabled).toBe(true)
    })

    it('can be set to false', () => {
      useUIStore.getState().setNotificationsEnabled(true)
      useUIStore.getState().setNotificationsEnabled(false)
      expect(useUIStore.getState().notificationsEnabled).toBe(false)
    })
  })

  describe('toggleNotifications', () => {
    it('toggles from false to true', () => {
      useUIStore.getState().toggleNotifications()
      expect(useUIStore.getState().notificationsEnabled).toBe(true)
    })

    it('toggles from true to false', () => {
      useUIStore.getState().setNotificationsEnabled(true)
      useUIStore.getState().toggleNotifications()
      expect(useUIStore.getState().notificationsEnabled).toBe(false)
    })
  })

  describe('ui-storage migration', () => {
    afterEach(() => {
      useUIStore.setState({ lastTVChannelId: null })
    })

    it('saves at version 1', () => {
      expect(useUIStore.persist.getOptions().version).toBe(1)
      useUIStore.getState().setSidebarOpen(true)
      expect(JSON.parse(localStorage.getItem('ui-storage') ?? 'null').version).toBe(1)
    })

    it('turns live-change pop-ups on once for a version 0 save that had them off', async () => {
      localStorage.setItem(
        'ui-storage',
        JSON.stringify({ state: { notificationsEnabled: false, lastTVChannelId: 'ersatz-7' }, version: 0 })
      )

      await useUIStore.persist.rehydrate()

      expect(useUIStore.getState().notificationsEnabled).toBe(true)
      expect(useUIStore.getState().lastTVChannelId).toBe('ersatz-7')
      // The migrated state is saved at the new version, so this runs only once
      expect(JSON.parse(localStorage.getItem('ui-storage') ?? 'null')).toMatchObject({
        state: { notificationsEnabled: true },
        version: 1,
      })
    })

    it('keeps pop-ups off when they were switched off after the migration', async () => {
      localStorage.setItem('ui-storage', JSON.stringify({ state: { notificationsEnabled: false }, version: 1 }))

      await useUIStore.persist.rehydrate()

      expect(useUIStore.getState().notificationsEnabled).toBe(false)
    })

    it('leaves the legacy volume in place for the audio store', () => {
      const migrate = useUIStore.persist.getOptions().migrate
      expect(migrate).toBeDefined()

      const migrated = migrate?.({ volume: 0.3, notificationsEnabled: false }, 0)

      expect(migrated).toEqual({ volume: 0.3, notificationsEnabled: true })
    })
  })

  describe('notificationsEnabled persistence', () => {
    it('persists notificationsEnabled to localStorage', () => {
      // Verify the partialize includes notificationsEnabled
      const partialize = useUIStore.persist.getOptions().partialize
      if (partialize) {
        const result = partialize(useUIStore.getState())
        expect('notificationsEnabled' in result).toBe(true)
      }
    })
  })
})
