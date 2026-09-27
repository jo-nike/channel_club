import { describe, it, expect } from 'vitest'
import {
  themes,
  getTheme,
  getThemeCategories,
  getAllThemeIds,
  DEFAULT_THEME_ID,
} from './themes'
import { contrast } from './color'
import type { ThemeId } from '@/types/theme'

const darkThemes = Object.values(themes).filter((t) => t.mode === 'dark')
const lightThemes = Object.values(themes).filter((t) => t.mode === 'light')

describe('themes', () => {
  describe('theme definitions', () => {
    it('should have 14 themes defined', () => {
      expect(Object.keys(themes)).toHaveLength(14)
    })

    it('should have 11 dark themes', () => {
      const darkThemes = Object.values(themes).filter((t) => t.mode === 'dark')
      expect(darkThemes).toHaveLength(11)
    })

    it('should have 3 light themes', () => {
      const lightThemes = Object.values(themes).filter((t) => t.mode === 'light')
      expect(lightThemes).toHaveLength(3)
    })

    it('should have all required dark themes', () => {
      const expectedDarkThemes: ThemeId[] = [
        'teal-city',
        'catppuccin-frappe',
        'catppuccin-macchiato',
        'catppuccin-mocha',
        'camouflage',
        'gruvbox-dark',
        'kanagawa-dark',
        'tucan',
        'dracula',
        'shades-of-purple',
        'neon-pink',
      ]
      expectedDarkThemes.forEach((id) => {
        expect(themes[id]).toBeDefined()
        expect(themes[id].mode).toBe('dark')
      })
    })

    it('should have all required light themes', () => {
      const expectedLightThemes: ThemeId[] = [
        'catppuccin-latte',
        'peachy',
        'zebra',
      ]
      expectedLightThemes.forEach((id) => {
        expect(themes[id]).toBeDefined()
        expect(themes[id].mode).toBe('light')
      })
    })

    it('each theme should have valid OKLCH color format', () => {
      const oklchPattern = /oklch\([0-9.]+\s+[0-9.]+\s+[0-9./\s%]+\)/

      Object.values(themes).forEach((theme) => {
        // Check essential colors
        expect(theme.colors.background).toMatch(oklchPattern)
        expect(theme.colors.primary).toMatch(oklchPattern)
        expect(theme.colors.foreground).toMatch(oklchPattern)
      })
    })

    it('each theme should have all required color properties', () => {
      const requiredProps = [
        'background',
        'foreground',
        'card',
        'cardForeground',
        'popover',
        'popoverForeground',
        'primary',
        'primaryForeground',
        'secondary',
        'secondaryForeground',
        'muted',
        'mutedForeground',
        'accent',
        'accentForeground',
        'destructive',
        'destructiveForeground',
        'live',
        'liveForeground',
        'guideNow',
        'guideFuture',
        'success',
        'successForeground',
        'warning',
        'warningForeground',
        'info',
        'infoForeground',
        'border',
        'input',
        'ring',
        'chart1',
        'chart2',
        'chart3',
        'chart4',
        'chart5',
        'sidebar',
        'sidebarForeground',
        'sidebarPrimary',
        'sidebarPrimaryForeground',
        'sidebarAccent',
        'sidebarAccentForeground',
        'sidebarBorder',
        'sidebarRing',
      ] as const

      Object.values(themes).forEach((theme) => {
        requiredProps.forEach((prop) => {
          expect(theme.colors[prop]).toBeDefined()
          expect(typeof theme.colors[prop]).toBe('string')
          expect(theme.colors[prop].length).toBeGreaterThan(0)
        })
      })
    })

    it('each theme should have a unique id matching its key', () => {
      Object.entries(themes).forEach(([key, theme]) => {
        expect(theme.id).toBe(key)
      })
    })

    it('each theme should have a display name', () => {
      Object.values(themes).forEach((theme) => {
        expect(theme.name).toBeDefined()
        expect(theme.name.length).toBeGreaterThan(0)
      })
    })
  })

  describe('contrast', () => {
    it.each(Object.values(themes).map((t) => [t.id, t] as const))(
      '%s: live foreground on live is at least 4.5:1',
      (_id, theme) => {
        expect(contrast(theme.colors.liveForeground, theme.colors.live)).toBeGreaterThanOrEqual(4.5)
      }
    )

    it.each(lightThemes.map((t) => [t.id, t] as const))(
      '%s: destructive foreground on destructive is at least 4.5:1',
      (_id, theme) => {
        expect(
          contrast(theme.colors.destructiveForeground, theme.colors.destructive)
        ).toBeGreaterThanOrEqual(4.5)
      }
    )

    it.each(darkThemes.map((t) => [t.id, t] as const))(
      '%s: foreground on the airing-now guide block is at least 7:1',
      (_id, theme) => {
        expect(contrast(theme.colors.foreground, theme.colors.guideNow)).toBeGreaterThanOrEqual(7)
      }
    )

    it.each(lightThemes.map((t) => [t.id, t] as const))(
      '%s: foreground on the airing-now guide block is at least 4.5:1',
      (_id, theme) => {
        expect(contrast(theme.colors.foreground, theme.colors.guideNow)).toBeGreaterThanOrEqual(4.5)
      }
    )

    it.each(Object.values(themes).map((t) => [t.id, t] as const))(
      '%s: muted foreground on a later guide block is at least 4.5:1',
      (_id, theme) => {
        expect(
          contrast(theme.colors.mutedForeground, theme.colors.guideFuture)
        ).toBeGreaterThanOrEqual(4.5)
      }
    )

    it.each(Object.values(themes).map((t) => [t.id, t] as const))(
      '%s: status colours carry readable text and stand out from the page',
      (_id, theme) => {
        const { colors } = theme
        const pairs = [
          [colors.success, colors.successForeground],
          [colors.warning, colors.warningForeground],
          [colors.info, colors.infoForeground],
        ] as const
        pairs.forEach(([status, foreground]) => {
          expect(contrast(foreground, status)).toBeGreaterThanOrEqual(4.5)
          // Non-text contrast (WCAG 1.4.11) for status dots on the page
          expect(contrast(status, colors.background)).toBeGreaterThanOrEqual(3)
        })
      }
    )
  })

  describe('getTheme', () => {
    it('should return a theme by ID', () => {
      const theme = getTheme('catppuccin-mocha')
      expect(theme).toBeDefined()
      expect(theme.id).toBe('catppuccin-mocha')
      expect(theme.name).toBe('Catppuccin Mocha')
      expect(theme.mode).toBe('dark')
    })

    it('should return correct mode for light theme', () => {
      const theme = getTheme('zebra')
      expect(theme.mode).toBe('light')
    })
  })

  describe('getThemeCategories', () => {
    it('should return two categories (dark and light)', () => {
      const categories = getThemeCategories()
      expect(categories).toHaveLength(2)
    })

    it('should have dark themes first', () => {
      const categories = getThemeCategories()
      expect(categories[0].mode).toBe('dark')
      expect(categories[0].label).toBe('Dark Themes')
    })

    it('should have light themes second', () => {
      const categories = getThemeCategories()
      expect(categories[1].mode).toBe('light')
      expect(categories[1].label).toBe('Light Themes')
    })

    it('should have correct number of themes in each category', () => {
      const categories = getThemeCategories()
      expect(categories[0].themes).toHaveLength(11) // dark
      expect(categories[1].themes).toHaveLength(3) // light
    })
  })

  describe('getAllThemeIds', () => {
    it('should return all 14 theme IDs', () => {
      const ids = getAllThemeIds()
      expect(ids).toHaveLength(14)
    })

    it('should return valid theme IDs', () => {
      const ids = getAllThemeIds()
      ids.forEach((id) => {
        expect(themes[id]).toBeDefined()
      })
    })
  })

  describe('DEFAULT_THEME_ID', () => {
    it('should be catppuccin-mocha', () => {
      expect(DEFAULT_THEME_ID).toBe('catppuccin-mocha')
    })

    it('should be a valid theme ID', () => {
      expect(themes[DEFAULT_THEME_ID]).toBeDefined()
    })

    it('should be a dark theme', () => {
      expect(themes[DEFAULT_THEME_ID].mode).toBe('dark')
    })
  })
})
