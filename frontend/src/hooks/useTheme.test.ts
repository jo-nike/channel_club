import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@/test/utils'
import { useTheme } from './useTheme'
import { DEFAULT_LIGHT_THEME_ID, useThemeStore } from '@/stores/themeStore'
import { DEFAULT_THEME_ID, getTheme, themes } from '@/lib/themes'
import { toHex } from '@/lib/color'
import { THEME_BOOT_KEY } from '@/lib/themeBoot'
import type { ThemeId } from '@/types/theme'

describe('useTheme', () => {
  beforeEach(() => {
    // Reset store to initial state
    useThemeStore.setState(useThemeStore.getInitialState())

    // Clean up document root classes and styles
    document.documentElement.classList.remove('dark')
    document.documentElement.style.cssText = ''
  })

  afterEach(() => {
    // Clean up after each test
    document.documentElement.classList.remove('dark')
    document.documentElement.style.cssText = ''
  })

  describe('initial state', () => {
    it('should return the default theme ID', () => {
      const { result } = renderHook(() => useTheme())

      expect(result.current.themeId).toBe(DEFAULT_THEME_ID)
    })

    it('should return the full theme object', () => {
      const { result } = renderHook(() => useTheme())

      expect(result.current.theme).toBeDefined()
      expect(result.current.theme.id).toBe(DEFAULT_THEME_ID)
      expect(result.current.theme.name).toBe('Club Night')
    })

    it('should return isDark as true for default dark theme', () => {
      const { result } = renderHook(() => useTheme())

      expect(result.current.isDark).toBe(true)
    })
  })

  describe('dark mode class toggling', () => {
    it('should add dark class to document root for dark theme', () => {
      renderHook(() => useTheme())

      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })

    it('should remove dark class when switching to light theme', () => {
      const { result } = renderHook(() => useTheme())

      act(() => {
        result.current.setTheme('zebra')
      })

      expect(document.documentElement.classList.contains('dark')).toBe(false)
    })

    it('should add dark class when switching back to dark theme', () => {
      const { result } = renderHook(() => useTheme())

      // Switch to light
      act(() => {
        result.current.setTheme('zebra')
      })
      expect(document.documentElement.classList.contains('dark')).toBe(false)

      // Switch back to dark
      act(() => {
        result.current.setTheme('dracula')
      })
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })
  })

  describe('CSS variable application', () => {
    it('should set --background CSS variable', () => {
      renderHook(() => useTheme())

      const bgValue = document.documentElement.style.getPropertyValue('--background')
      expect(bgValue).toBeTruthy()
      expect(bgValue).toContain('oklch')
    })

    it('should set --primary CSS variable', () => {
      renderHook(() => useTheme())

      const primaryValue = document.documentElement.style.getPropertyValue('--primary')
      expect(primaryValue).toBeTruthy()
      expect(primaryValue).toContain('oklch')
    })

    it('should set --foreground CSS variable', () => {
      renderHook(() => useTheme())

      const fgValue = document.documentElement.style.getPropertyValue('--foreground')
      expect(fgValue).toBeTruthy()
      expect(fgValue).toContain('oklch')
    })

    it('should update CSS variables when theme changes', () => {
      const { result } = renderHook(() => useTheme())

      const initialPrimary = document.documentElement.style.getPropertyValue('--primary')

      act(() => {
        result.current.setTheme('neon-pink')
      })

      const newPrimary = document.documentElement.style.getPropertyValue('--primary')
      expect(newPrimary).not.toBe(initialPrimary)
    })

    it('should set chart CSS variables', () => {
      renderHook(() => useTheme())

      expect(document.documentElement.style.getPropertyValue('--chart-1')).toBeTruthy()
      expect(document.documentElement.style.getPropertyValue('--chart-2')).toBeTruthy()
      expect(document.documentElement.style.getPropertyValue('--chart-3')).toBeTruthy()
    })

    it('should set the live, destructive-foreground and guide variables', () => {
      renderHook(() => useTheme())

      const style = document.documentElement.style
      expect(style.getPropertyValue('--live')).toBe('oklch(0.55 0.22 27)')
      expect(style.getPropertyValue('--live-foreground')).toBe('oklch(0.985 0 0)')
      expect(style.getPropertyValue('--destructive-foreground')).toBe('oklch(0.985 0 0)')
      expect(style.getPropertyValue('--guide-now')).toContain('oklch')
      expect(style.getPropertyValue('--guide-future')).toContain('oklch')
    })

    it('should set the status variables', () => {
      renderHook(() => useTheme())

      const style = document.documentElement.style
      for (const name of ['success', 'warning', 'info']) {
        expect(style.getPropertyValue(`--${name}`)).toContain('oklch')
        expect(style.getPropertyValue(`--${name}-foreground`)).toContain('oklch')
      }
    })

    it('should set sidebar CSS variables', () => {
      renderHook(() => useTheme())

      expect(document.documentElement.style.getPropertyValue('--sidebar')).toBeTruthy()
      expect(document.documentElement.style.getPropertyValue('--sidebar-foreground')).toBeTruthy()
    })
  })

  describe('boot snapshot', () => {
    beforeEach(() => {
      localStorage.clear()
    })

    const readBoot = () => JSON.parse(localStorage.getItem(THEME_BOOT_KEY) ?? 'null')

    it('writes the resolved selected theme for the pre-paint script', () => {
      renderHook(() => useTheme())

      const boot = readBoot()
      expect(boot).toMatchObject({ v: 1, dark: true })
      expect(boot.vars['--background']).toBe(getTheme(DEFAULT_THEME_ID).colors.background)
      expect(boot.vars['--primary']).toBe(getTheme(DEFAULT_THEME_ID).colors.primary)
      expect(boot.themeColor).toBe(toHex(getTheme(DEFAULT_THEME_ID).colors.background))
    })

    it('rewrites the snapshot when the theme changes', () => {
      const { result } = renderHook(() => useTheme())

      act(() => {
        result.current.setTheme('catppuccin-latte')
      })

      const boot = readBoot()
      expect(boot.dark).toBe(false)
      expect(boot.vars['--background']).toBe(getTheme('catppuccin-latte').colors.background)
      expect(boot.themeColor).toBe(toHex(getTheme('catppuccin-latte').colors.background))
    })

    it('still applies the theme when storage is unavailable', () => {
      vi.mocked(localStorage.setItem).mockImplementationOnce(() => {
        throw new DOMException('QuotaExceededError')
      })

      renderHook(() => useTheme())

      expect(readBoot()).toBeNull()
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })
  })

  describe('following the system colour scheme', () => {
    const originalMatchMedia = window.matchMedia
    const readBoot = () => JSON.parse(localStorage.getItem(THEME_BOOT_KEY) ?? 'null')

    /** A prefers-color-scheme the test can flip, notifying 'change' listeners */
    function mockColorScheme(initiallyDark: boolean) {
      let dark = initiallyDark
      const listeners = new Set<() => void>()
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn((query: string) => ({
          get matches() {
            return query === '(prefers-color-scheme: dark)' ? dark : false
          },
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
          removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
          dispatchEvent: vi.fn(),
        })),
      })
      return {
        setDark(value: boolean) {
          dark = value
          listeners.forEach((listener) => listener())
        },
      }
    }

    beforeEach(() => {
      localStorage.clear()
      useThemeStore.setState({ darkThemeId: 'dracula', lightThemeId: 'peachy' })
    })

    afterEach(() => {
      Object.defineProperty(window, 'matchMedia', { writable: true, value: originalMatchMedia })
    })

    it('shows the dark pick on a dark device and swaps to the light pick when it turns light', () => {
      const scheme = mockColorScheme(true)
      useThemeStore.getState().setFollowSystem(true)
      const { result } = renderHook(() => useTheme())

      expect(result.current.themeId).toBe('dracula')
      expect(document.documentElement.classList.contains('dark')).toBe(true)

      act(() => scheme.setDark(false))

      expect(result.current.themeId).toBe('peachy')
      expect(result.current.isDark).toBe(false)
      expect(document.documentElement.classList.contains('dark')).toBe(false)
      expect(document.documentElement.style.getPropertyValue('--background')).toBe(
        getTheme('peachy').colors.background
      )

      act(() => scheme.setDark(true))

      expect(result.current.themeId).toBe('dracula')
      expect(document.documentElement.style.getPropertyValue('--background')).toBe(
        getTheme('dracula').colors.background
      )
    })

    it('ignores the device scheme outside Auto', () => {
      const scheme = mockColorScheme(false)
      const { result } = renderHook(() => useTheme())

      expect(result.current.themeId).toBe('dracula')

      act(() => scheme.setDark(true))
      act(() => scheme.setDark(false))

      expect(result.current.themeId).toBe('dracula')
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })

    it('stores both picks in the boot snapshot while following the system', () => {
      mockColorScheme(false)
      useThemeStore.getState().setFollowSystem(true)
      renderHook(() => useTheme())

      const boot = readBoot()
      expect(boot.dark).toBe(false)
      expect(boot.vars['--background']).toBe(getTheme('peachy').colors.background)
      expect(boot.system.dark.vars['--background']).toBe(getTheme('dracula').colors.background)
      expect(boot.system.dark.dark).toBe(true)
      expect(boot.system.light.vars['--background']).toBe(getTheme('peachy').colors.background)
      expect(boot.system.light.dark).toBe(false)
    })

    it('rewrites the snapshot when an Auto pick changes and drops the pair when Auto is off', () => {
      mockColorScheme(true)
      useThemeStore.getState().setFollowSystem(true)
      const { result } = renderHook(() => useTheme())

      // The light pick is not on screen, but the next load may need it
      act(() => result.current.setTheme('zebra'))
      expect(readBoot().system.light.vars['--background']).toBe(getTheme('zebra').colors.background)

      act(() => useThemeStore.getState().setFollowSystem(false))
      expect(readBoot().system).toBeUndefined()
      expect(readBoot().vars['--background']).toBe(getTheme('dracula').colors.background)
    })

    it('uses the default picks for a device that just turned Auto on', () => {
      mockColorScheme(false)
      useThemeStore.setState(useThemeStore.getInitialState())
      useThemeStore.getState().setFollowSystem(true)

      const { result } = renderHook(() => useTheme())

      expect(result.current.themeId).toBe(DEFAULT_LIGHT_THEME_ID)
    })
  })

  describe('meta theme-color', () => {
    let meta: HTMLMetaElement

    beforeEach(() => {
      meta = document.createElement('meta')
      meta.name = 'theme-color'
      meta.content = '#0f172a'
      document.head.appendChild(meta)
    })

    afterEach(() => {
      meta.remove()
    })

    it('follows the theme background as hex', () => {
      const { result } = renderHook(() => useTheme())
      expect(meta.content).toBe(toHex(getTheme(DEFAULT_THEME_ID).colors.background))

      act(() => {
        result.current.setTheme('catppuccin-latte')
      })
      expect(meta.content).toBe(toHex(getTheme('catppuccin-latte').colors.background))
    })

    it('produces a hex colour for every theme', () => {
      const { result } = renderHook(() => useTheme())

      for (const id of Object.keys(themes) as ThemeId[]) {
        act(() => {
          result.current.setTheme(id)
        })
        expect(meta.content).toMatch(/^#[0-9a-f]{6}$/)
      }
    })
  })

  describe('setTheme function', () => {
    it('should update theme ID when setTheme is called', () => {
      const { result } = renderHook(() => useTheme())

      act(() => {
        result.current.setTheme('dracula')
      })

      expect(result.current.themeId).toBe('dracula')
    })

    it('should update theme object when setTheme is called', () => {
      const { result } = renderHook(() => useTheme())

      act(() => {
        result.current.setTheme('gruvbox-dark')
      })

      expect(result.current.theme.id).toBe('gruvbox-dark')
      expect(result.current.theme.name).toBe('Gruvbox Dark')
    })

    it('should update isDark when switching to light theme', () => {
      const { result } = renderHook(() => useTheme())

      expect(result.current.isDark).toBe(true)

      act(() => {
        result.current.setTheme('catppuccin-latte')
      })

      expect(result.current.isDark).toBe(false)
    })
  })

  describe('theme persistence across mounts', () => {
    it('should persist theme selection across hook remounts', () => {
      // First mount and set theme
      const { result, unmount } = renderHook(() => useTheme())

      act(() => {
        result.current.setTheme('shades-of-purple')
      })

      unmount()

      // Second mount should have the same theme
      const { result: result2 } = renderHook(() => useTheme())
      expect(result2.current.themeId).toBe('shades-of-purple')
    })
  })

  describe('all theme modes', () => {
    it('should correctly identify dark themes', () => {
      const { result } = renderHook(() => useTheme())

      const darkThemes = [
        'catppuccin-mocha',
        'dracula',
        'neon-pink',
        'gruvbox-dark',
      ] as const

      darkThemes.forEach((themeId) => {
        act(() => {
          result.current.setTheme(themeId)
        })
        expect(result.current.isDark).toBe(true)
        expect(result.current.theme.mode).toBe('dark')
      })
    })

    it('should correctly identify light themes', () => {
      const { result } = renderHook(() => useTheme())

      const lightThemes = ['catppuccin-latte', 'peachy', 'zebra'] as const

      lightThemes.forEach((themeId) => {
        act(() => {
          result.current.setTheme(themeId)
        })
        expect(result.current.isDark).toBe(false)
        expect(result.current.theme.mode).toBe('light')
      })
    })
  })
})
