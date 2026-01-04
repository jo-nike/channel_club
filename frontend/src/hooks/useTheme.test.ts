import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTheme } from './useTheme'
import { useThemeStore } from '@/stores/themeStore'
import { DEFAULT_THEME_ID } from '@/lib/themes'

describe('useTheme', () => {
  beforeEach(() => {
    // Reset store to initial state
    useThemeStore.setState({ themeId: DEFAULT_THEME_ID })

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
      expect(result.current.theme.name).toBe('Catppuccin Mocha')
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

    it('should set sidebar CSS variables', () => {
      renderHook(() => useTheme())

      expect(document.documentElement.style.getPropertyValue('--sidebar')).toBeTruthy()
      expect(document.documentElement.style.getPropertyValue('--sidebar-foreground')).toBeTruthy()
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
