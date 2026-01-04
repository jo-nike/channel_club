import { useEffect } from 'react'
import { useThemeStore } from '@/stores/themeStore'
import { getTheme } from '@/lib/themes'
import type { ThemeId, ThemeColors } from '@/types/theme'

/**
 * Map of ThemeColors property names to CSS variable names
 */
const colorToCSSVar: Record<keyof ThemeColors, string> = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  cardForeground: '--card-foreground',
  popover: '--popover',
  popoverForeground: '--popover-foreground',
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  secondary: '--secondary',
  secondaryForeground: '--secondary-foreground',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  accent: '--accent',
  accentForeground: '--accent-foreground',
  destructive: '--destructive',
  border: '--border',
  input: '--input',
  ring: '--ring',
  chart1: '--chart-1',
  chart2: '--chart-2',
  chart3: '--chart-3',
  chart4: '--chart-4',
  chart5: '--chart-5',
  sidebar: '--sidebar',
  sidebarForeground: '--sidebar-foreground',
  sidebarPrimary: '--sidebar-primary',
  sidebarPrimaryForeground: '--sidebar-primary-foreground',
  sidebarAccent: '--sidebar-accent',
  sidebarAccentForeground: '--sidebar-accent-foreground',
  sidebarBorder: '--sidebar-border',
  sidebarRing: '--sidebar-ring',
}

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
 * Hook to apply and manage the current theme
 *
 * Usage: Call this hook in your root App component to initialize theming.
 * It will:
 * - Apply the current theme's colors as CSS custom properties
 * - Toggle the 'dark' class on the document root based on theme mode
 * - Automatically update when the theme changes
 *
 * @returns Object containing current theme info and setTheme function
 */
export function useTheme() {
  const themeId = useThemeStore((s) => s.themeId)
  const setThemeId = useThemeStore((s) => s.setTheme)

  // Get the full theme object
  const theme = getTheme(themeId)

  // Apply theme whenever it changes
  useEffect(() => {
    // Apply dark/light mode class
    applyDarkModeClass(theme.mode === 'dark')

    // Apply all color CSS variables
    applyThemeColors(theme.colors)
  }, [theme])

  return {
    themeId,
    theme,
    isDark: theme.mode === 'dark',
    setTheme: (id: ThemeId) => setThemeId(id),
  }
}
