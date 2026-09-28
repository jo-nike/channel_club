import { useEffect } from 'react'
import { resolveThemeId, useThemeStore } from '@/stores/themeStore'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { getTheme } from '@/lib/themes'
import { colorToCSSVar, createThemeBoot, saveThemeBoot } from '@/lib/themeBoot'
import type { ThemeId, ThemeColors } from '@/types/theme'

/**
 * Apply theme colors to the document root element
 */
function applyThemeColors(colors: ThemeColors): void {
  const root = document.documentElement

  // Set each CSS custom property
  Object.entries(colors).forEach(([key, value]) => {
    const cssVar = colorToCSSVar[key as keyof ThemeColors]
    if (cssVar) {
      root.style.setProperty(cssVar, value)
    }
  })
}

/**
 * Apply or remove dark class based on theme mode
 */
function applyDarkModeClass(isDark: boolean): void {
  const root = document.documentElement

  if (isDark) {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

/**
 * Point the browser UI colour (status bar, PWA title bar) at the theme
 * background
 */
function applyThemeColorMeta(hex: string): void {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', hex)
}

/**
 * Hook to apply and manage the current theme
 *
 * Usage: Call this hook in your root App component to initialize theming.
 * It will:
 * - Apply the current theme's colors as CSS custom properties
 * - Toggle the 'dark' class on the document root based on theme mode
 * - Automatically update when the theme changes
 * - In Auto (followSystem), show the dark or light pick to match
 *   prefers-color-scheme, and switch live when the device's scheme changes
 *
 * @returns Object containing current theme info and setTheme function
 */
export function useTheme() {
  const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)')
  const themeId = useThemeStore((s) => resolveThemeId(s, systemPrefersDark))
  const followSystem = useThemeStore((s) => s.followSystem)
  const darkThemeId = useThemeStore((s) => s.darkThemeId)
  const lightThemeId = useThemeStore((s) => s.lightThemeId)
  const setThemeId = useThemeStore((s) => s.setTheme)

  // Get the full theme object
  const theme = getTheme(themeId)

  // Apply theme whenever it changes
  useEffect(() => {
    // Apply dark/light mode class
    applyDarkModeClass(theme.mode === 'dark')

    // Apply all color CSS variables
    applyThemeColors(theme.colors)

    // In Auto, keep both picks so the boot script can match the scheme at load
    const boot = createThemeBoot(
      theme,
      followSystem ? { dark: getTheme(darkThemeId), light: getTheme(lightThemeId) } : undefined
    )

    applyThemeColorMeta(boot.themeColor)

    // Remember the resolved theme so the boot script can apply it before first paint
    saveThemeBoot(boot)
  }, [theme, followSystem, darkThemeId, lightThemeId])

  return {
    themeId,
    theme,
    isDark: theme.mode === 'dark',
    setTheme: (id: ThemeId) => setThemeId(id),
  }
}
