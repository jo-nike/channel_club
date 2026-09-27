import { describe, it, expect, beforeEach, vi } from 'vitest'
import { activeThemeId, DEFAULT_LIGHT_THEME_ID, useThemeStore } from './themeStore'
import { DEFAULT_THEME_ID } from '@/lib/themes'

describe('themeStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useThemeStore.setState(useThemeStore.getInitialState())
    // Clear localStorage to ensure clean state
    localStorage.removeItem('theme-storage')
  })

  const active = () => activeThemeId(useThemeStore.getState())

  describe('initial state', () => {
    it('starts on the default dark theme, not following the system', () => {
      const state = useThemeStore.getState()
      expect(state.followSystem).toBe(false)
      expect(state.mode).toBe('dark')
      expect(state.darkThemeId).toBe(DEFAULT_THEME_ID)
      expect(active()).toBe(DEFAULT_THEME_ID)
    })

    it('should have club-night as default theme and club-day as the light pick', () => {
      const state = useThemeStore.getState()
      expect(state.darkThemeId).toBe('club-night')
      expect(state.lightThemeId).toBe(DEFAULT_LIGHT_THEME_ID)
      expect(DEFAULT_LIGHT_THEME_ID).toBe('club-day')
    })
  })

  describe('default for new and existing devices', () => {
    /** Load a fresh copy of the store, as a new page load would */
    async function loadStore() {
      vi.resetModules()
      const { useThemeStore: fresh } = await import('./themeStore')
      return fresh
    }

    it('starts a device that never chose a theme on Club Night', async () => {
      const fresh = await loadStore()
      expect(activeThemeId(fresh.getState())).toBe('club-night')
    })

    it('keeps the theme a device already chose, including the old Mocha default', async () => {
      localStorage.setItem(
        'theme-storage',
        JSON.stringify({ state: { themeId: 'catppuccin-mocha' }, version: 0 })
      )

      const fresh = await loadStore()

      expect(activeThemeId(fresh.getState())).toBe('catppuccin-mocha')
    })
  })

  describe('v1 migrate from a single themeId', () => {
    async function loadWith(saved: unknown) {
      localStorage.setItem('theme-storage', JSON.stringify(saved))
      vi.resetModules()
      const { useThemeStore: fresh } = await import('./themeStore')
      return fresh.getState()
    }

    it('keeps a dark theme on screen: it becomes the dark pick, with Auto off', async () => {
      const state = await loadWith({ state: { themeId: 'dracula' }, version: 0 })

      expect(state.followSystem).toBe(false)
      expect(state.mode).toBe('dark')
      expect(state.darkThemeId).toBe('dracula')
      expect(state.lightThemeId).toBe(DEFAULT_LIGHT_THEME_ID)
      expect(activeThemeId(state)).toBe('dracula')
    })

    it('keeps a light theme on screen: it becomes the light pick in Light mode', async () => {
      const state = await loadWith({ state: { themeId: 'zebra' }, version: 0 })

      expect(state.followSystem).toBe(false)
      expect(state.mode).toBe('light')
      expect(state.lightThemeId).toBe('zebra')
      expect(state.darkThemeId).toBe(DEFAULT_THEME_ID)
      expect(activeThemeId(state)).toBe('zebra')
    })

    it('falls back to the defaults for a save without a known theme', async () => {
      const state = await loadWith({ state: { themeId: 'no-such-theme' }, version: 0 })

      expect(state.mode).toBe('dark')
      expect(state.darkThemeId).toBe(DEFAULT_THEME_ID)
      expect(state.lightThemeId).toBe(DEFAULT_LIGHT_THEME_ID)
    })

    it('saves the migrated choice at version 1 without the old themeId', async () => {
      await loadWith({ state: { themeId: 'dracula' }, version: 0 })

      expect(JSON.parse(localStorage.getItem('theme-storage') ?? 'null')).toEqual({
        state: { followSystem: false, mode: 'dark', darkThemeId: 'dracula', lightThemeId: DEFAULT_LIGHT_THEME_ID },
        version: 1,
      })
    })

    it('leaves a version 1 save as it is', async () => {
      const saved = { followSystem: true, mode: 'light', darkThemeId: 'gruvbox-dark', lightThemeId: 'peachy' }

      const state = await loadWith({ state: saved, version: 1 })

      expect(state).toMatchObject(saved)
    })
  })

  describe('setTheme', () => {
    it('shows a dark theme and keeps it as the dark pick', () => {
      useThemeStore.getState().setTheme('dracula')

      expect(useThemeStore.getState().darkThemeId).toBe('dracula')
      expect(active()).toBe('dracula')
    })

    it('shows a light theme, switching to Light mode', () => {
      useThemeStore.getState().setTheme('zebra')

      const state = useThemeStore.getState()
      expect(state.lightThemeId).toBe('zebra')
      expect(state.mode).toBe('light')
      expect(state.darkThemeId).toBe(DEFAULT_THEME_ID)
      expect(active()).toBe('zebra')
    })

    it('in Auto, fills the slot for its mode and stays in Auto', () => {
      useThemeStore.getState().setFollowSystem(true)

      useThemeStore.getState().setTheme('peachy')
      useThemeStore.getState().setTheme('gruvbox-dark')

      const state = useThemeStore.getState()
      expect(state.followSystem).toBe(true)
      expect(state.mode).toBe('dark')
      expect(state.lightThemeId).toBe('peachy')
      expect(state.darkThemeId).toBe('gruvbox-dark')
    })
  })

  describe('setFollowSystem and setMode', () => {
    it('turns Auto on and off without touching the picks', () => {
      useThemeStore.getState().setFollowSystem(true)
      expect(useThemeStore.getState()).toMatchObject({
        followSystem: true,
        darkThemeId: DEFAULT_THEME_ID,
        lightThemeId: DEFAULT_LIGHT_THEME_ID,
      })

      useThemeStore.getState().setFollowSystem(false)
      expect(useThemeStore.getState().followSystem).toBe(false)
    })

    it('switches between the remembered dark and light picks, leaving Auto', () => {
      useThemeStore.setState({ darkThemeId: 'dracula', lightThemeId: 'peachy', followSystem: true })

      useThemeStore.getState().setMode('light')
      expect(useThemeStore.getState().followSystem).toBe(false)
      expect(active()).toBe('peachy')

      useThemeStore.getState().setMode('dark')
      expect(active()).toBe('dracula')
    })
  })

  describe('persistence', () => {
    it('should use theme-storage key for localStorage', () => {
      useThemeStore.getState().setTheme('dracula')

      const stored = localStorage.getItem('theme-storage')
      expect(stored).toBeTruthy()
      expect(stored).toContain('dracula')
    })

    it('persists the whole choice at version 1', () => {
      useThemeStore.getState().setFollowSystem(true)
      useThemeStore.getState().setTheme('shades-of-purple')

      expect(JSON.parse(localStorage.getItem('theme-storage') ?? '{}')).toEqual({
        state: {
          followSystem: true,
          mode: 'dark',
          darkThemeId: 'shades-of-purple',
          lightThemeId: DEFAULT_LIGHT_THEME_ID,
        },
        version: 1,
      })
    })

    it('should not conflict with ui-storage', () => {
      useThemeStore.getState().setTheme('dracula')

      // Verify they are stored separately
      const themeStorage = localStorage.getItem('theme-storage')
      const uiStorage = localStorage.getItem('ui-storage')

      expect(themeStorage).not.toBe(uiStorage)
    })
  })
})
