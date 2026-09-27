import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useUIStore } from './uiStore'

describe('uiStore', () => {
  beforeEach(() => {
    // Reset the store between tests
    useUIStore.setState({
      isTheaterMode: false,
      isSidebarOpen: false,
      isEPGVisible: false,
      epgHeightPercent: 50,
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

    it('seeds audio-storage from a legacy save even though importing uiStore rewrites ui-storage', async () => {
      localStorage.setItem('ui-storage', JSON.stringify({ state: { volume: 0.3 }, version: 0 }))
      expect(localStorage.getItem('audio-storage')).toBeNull()
      vi.resetModules()

      // Importing alone hydrates, migrates and writes ui-storage back without volume
      await import('./uiStore')

      const ui = JSON.parse(localStorage.getItem('ui-storage') ?? 'null')
      expect(ui.version).toBe(2)
      expect(ui.state).not.toHaveProperty('volume')
      const audio = JSON.parse(localStorage.getItem('audio-storage') ?? 'null')
      expect(audio?.state).toEqual({ volume: 0.3, muted: false })
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
    it('defaults to 50', () => {
      expect(useUIStore.getInitialState().epgHeightPercent).toBe(50)
    })

    it('can be set to a valid value', () => {
      useUIStore.getState().setEPGHeightPercent(60)
      expect(useUIStore.getState().epgHeightPercent).toBe(60)
    })

    it('clamps to minimum of 30', () => {
      useUIStore.getState().setEPGHeightPercent(20)
      expect(useUIStore.getState().epgHeightPercent).toBe(30)
    })

    it('clamps to maximum of 75', () => {
      useUIStore.getState().setEPGHeightPercent(80)
      expect(useUIStore.getState().epgHeightPercent).toBe(75)
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
      useUIStore.setState({ lastTVChannelId: null, epgHeightPercent: 50 })
    })

    it('saves at version 2', () => {
      expect(useUIStore.persist.getOptions().version).toBe(2)
      useUIStore.getState().setSidebarOpen(true)
      expect(JSON.parse(localStorage.getItem('ui-storage') ?? 'null').version).toBe(2)
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
        version: 2,
      })
    })

    it('keeps pop-ups off when they were switched off after the migration', async () => {
      localStorage.setItem('ui-storage', JSON.stringify({ state: { notificationsEnabled: false }, version: 1 }))

      await useUIStore.persist.rehydrate()

      expect(useUIStore.getState().notificationsEnabled).toBe(false)
    })

    it('passes unknown fields such as the legacy volume through (partialize drops them on write)', () => {
      const migrate = useUIStore.persist.getOptions().migrate
      expect(migrate).toBeDefined()

      const migrated = migrate?.({ volume: 0.3, notificationsEnabled: false }, 0)

      expect(migrated).toEqual({ volume: 0.3, notificationsEnabled: true })
    })

    it.each([0, 1])('moves the untouched old 25%% guide height to 50%% and clamps others to 30-75%% (from v%i)', (fromVersion) => {
      const migrate = useUIStore.persist.getOptions().migrate!
      const height = (epgHeightPercent: number) =>
        (migrate({ epgHeightPercent, notificationsEnabled: false }, fromVersion) as { epgHeightPercent: number }).epgHeightPercent

      expect(height(25)).toBe(50)
      expect(height(45)).toBe(45)
      expect(height(10)).toBe(30)
      expect(height(15)).toBe(30)
      expect(height(90)).toBe(75)
    })

    it('chains the v1 step before the v2 one for a version 0 save', () => {
      const migrate = useUIStore.persist.getOptions().migrate!

      expect(migrate({ epgHeightPercent: 25, notificationsEnabled: false }, 0)).toEqual({
        epgHeightPercent: 50,
        notificationsEnabled: true,
      })
      // A v1 save keeps its pop-up choice
      expect(migrate({ epgHeightPercent: 25, notificationsEnabled: false }, 1)).toEqual({
        epgHeightPercent: 50,
        notificationsEnabled: false,
      })
    })

    it('leaves a save without a guide height to the default', () => {
      const migrate = useUIStore.persist.getOptions().migrate!
      expect(migrate({ lastTVChannelId: 'ersatz-7' }, 1)).toEqual({ lastTVChannelId: 'ersatz-7' })
    })

    it('rehydrates a version 1 save at the old default as 50% and saves it at version 2', async () => {
      localStorage.setItem('ui-storage', JSON.stringify({ state: { epgHeightPercent: 25 }, version: 1 }))

      await useUIStore.persist.rehydrate()

      expect(useUIStore.getState().epgHeightPercent).toBe(50)
      expect(JSON.parse(localStorage.getItem('ui-storage') ?? 'null')).toMatchObject({
        state: { epgHeightPercent: 50 },
        version: 2,
      })
    })

    it('runs the height step only once (a version 2 save is taken as it is)', async () => {
      localStorage.setItem('ui-storage', JSON.stringify({ state: { epgHeightPercent: 25 }, version: 2 }))

      await useUIStore.persist.rehydrate()

      expect(useUIStore.getState().epgHeightPercent).toBe(25)
    })
  })

  describe('guide focus request', () => {
    it('is off by default and never saved, so a reload does not move focus', () => {
      expect(useUIStore.getInitialState().guideFocusRequested).toBe(false)
      useUIStore.getState().setGuideFocusRequested(true)
      expect(useUIStore.getState().guideFocusRequested).toBe(true)

      const partialize = useUIStore.persist.getOptions().partialize!
      expect('guideFocusRequested' in partialize(useUIStore.getState())).toBe(false)
      useUIStore.setState({ guideFocusRequested: false })
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
