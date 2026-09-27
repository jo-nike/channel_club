import { toHex } from '@/lib/color'
import type { Theme, ThemeColors } from '@/types/theme'

/**
 * Map of ThemeColors property names to CSS variable names
 */
export const colorToCSSVar: Record<keyof ThemeColors, string> = {
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
  destructiveForeground: '--destructive-foreground',
  live: '--live',
  liveForeground: '--live-foreground',
  guideNow: '--guide-now',
  guideFuture: '--guide-future',
  success: '--success',
  successForeground: '--success-foreground',
  warning: '--warning',
  warningForeground: '--warning-foreground',
  info: '--info',
  infoForeground: '--info-foreground',
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

/** localStorage key read by the inline boot script in index.html */
export const THEME_BOOT_KEY = 'theme-boot'

/** One theme's resolved values, as useTheme applies them */
export interface ThemeBootPalette {
  dark: boolean
  /** CSS variable name to value, exactly as useTheme applies them */
  vars: Record<string, string>
  /**
   * The background as #rrggbb for meta[name=theme-color] (status bar, PWA
   * title bar). Browsers don't all accept oklch() there. Snapshots written
   * before this field existed lack it; the script then leaves the meta alone.
   */
  themeColor: string
}

/**
 * Resolved theme values for the inline script in index.html, which applies
 * them before first paint. Storing resolved values means index.html never
 * needs its own copy of lib/themes.ts.
 *
 * The top-level palette is the theme on screen when the snapshot was
 * written. While the theme follows the system, `system` also holds both
 * palettes and the script picks one with prefers-color-scheme, so a scheme
 * change between visits doesn't flash the old theme. A script without
 * `system` support (an index.html cached before it) uses the top level.
 */
export interface ThemeBoot extends ThemeBootPalette {
  v: 1
  system?: { dark: ThemeBootPalette; light: ThemeBootPalette }
}

function createThemeBootPalette(theme: Theme): ThemeBootPalette {
  const vars: Record<string, string> = {}
  for (const [key, value] of Object.entries(theme.colors)) {
    const cssVar = colorToCSSVar[key as keyof ThemeColors]
    if (cssVar) {
      vars[cssVar] = value
    }
  }
  return { dark: theme.mode === 'dark', vars, themeColor: toHex(theme.colors.background) }
}

/**
 * Snapshot `theme`, the one on screen. Pass the dark and light picks as
 * `system` while following the system.
 */
export function createThemeBoot(theme: Theme, system?: { dark: Theme; light: Theme }): ThemeBoot {
  const boot: ThemeBoot = { v: 1, ...createThemeBootPalette(theme) }
  if (system) {
    boot.system = {
      dark: createThemeBootPalette(system.dark),
      light: createThemeBootPalette(system.light),
    }
  }
  return boot
}

/**
 * Store the snapshot for the next page load. Storage can be unavailable
 * (private mode, quota, blocked site data); the app still works without it.
 */
export function saveThemeBoot(boot: ThemeBoot): void {
  try {
    localStorage.setItem(THEME_BOOT_KEY, JSON.stringify(boot))
  } catch {
    // Without a snapshot the next load falls back to the default dark theme
  }
}
