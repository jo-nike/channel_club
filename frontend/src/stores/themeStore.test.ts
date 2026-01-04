import { describe, it, expect, beforeEach } from 'vitest'
import { useThemeStore } from './themeStore'
import { DEFAULT_THEME_ID } from '@/lib/themes'

describe('themeStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useThemeStore.setState({ themeId: DEFAULT_THEME_ID })
    // Clear localStorage to ensure clean state
    localStorage.removeItem('theme-storage')
  })

  describe('initial state', () => {
    it('should have default theme as initial theme', () => {
      const { themeId } = useThemeStore.getState()
      expect(themeId).toBe(DEFAULT_THEME_ID)
    })

    it('should have catppuccin-mocha as default theme', () => {
      const { themeId } = useThemeStore.getState()
      expect(themeId).toBe('catppuccin-mocha')
    })
  })

  describe('setTheme', () => {
    it('should update the theme ID', () => {
      const { setTheme } = useThemeStore.getState()

      setTheme('dracula')

      const { themeId } = useThemeStore.getState()
      expect(themeId).toBe('dracula')
    })

    it('should update to light theme', () => {
      const { setTheme } = useThemeStore.getState()

      setTheme('zebra')

      const { themeId } = useThemeStore.getState()
      expect(themeId).toBe('zebra')
    })

    it('should update to any valid dark theme', () => {
      const { setTheme } = useThemeStore.getState()

      setTheme('neon-pink')
      expect(useThemeStore.getState().themeId).toBe('neon-pink')

      setTheme('gruvbox-dark')
      expect(useThemeStore.getState().themeId).toBe('gruvbox-dark')

      setTheme('catppuccin-frappe')
      expect(useThemeStore.getState().themeId).toBe('catppuccin-frappe')
    })

    it('should update to any valid light theme', () => {
      const { setTheme } = useThemeStore.getState()

      setTheme('catppuccin-latte')
      expect(useThemeStore.getState().themeId).toBe('catppuccin-latte')

      setTheme('peachy')
      expect(useThemeStore.getState().themeId).toBe('peachy')
    })
  })

  describe('persistence', () => {
    it('should use theme-storage key for localStorage', () => {
      const { setTheme } = useThemeStore.getState()
      setTheme('dracula')

      const stored = localStorage.getItem('theme-storage')
      expect(stored).toBeTruthy()
      expect(stored).toContain('dracula')
    })

    it('should persist theme changes', () => {
      const { setTheme } = useThemeStore.getState()
      setTheme('shades-of-purple')

      const stored = JSON.parse(localStorage.getItem('theme-storage') ?? '{}')
      expect(stored.state?.themeId).toBe('shades-of-purple')
    })

    it('should not conflict with ui-storage', () => {
      // Set both stores
      const { setTheme } = useThemeStore.getState()
      setTheme('dracula')

      // Verify they are stored separately
      const themeStorage = localStorage.getItem('theme-storage')
      const uiStorage = localStorage.getItem('ui-storage')

      expect(themeStorage).not.toBe(uiStorage)
    })
  })
})
