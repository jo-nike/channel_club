/**
 * Theme type definitions for Glance-inspired color themes
 * Supports 16 themes organized into dark and light categories
 */

// Union type of all available theme IDs
export type ThemeId =
  // Dark themes (12)
  | 'club-night'
  | 'teal-city'
  | 'catppuccin-frappe'
  | 'catppuccin-macchiato'
  | 'catppuccin-mocha'
  | 'camouflage'
  | 'gruvbox-dark'
  | 'kanagawa-dark'
  | 'tucan'
  | 'dracula'
  | 'shades-of-purple'
  | 'neon-pink'
  // Light themes (4)
  | 'club-day'
  | 'catppuccin-latte'
  | 'peachy'
  | 'zebra'

export type ThemeMode = 'dark' | 'light'

/**
 * Color value in OKLCH format (e.g., "0.145 0.021 265")
 * This matches the format used in shadcn/ui CSS variables
 */
export type OklchColor = string

/**
 * Theme color definitions using OKLCH color space
 * Maps to shadcn/ui CSS custom properties
 */
export interface ThemeColors {
  background: OklchColor
  foreground: OklchColor
  card: OklchColor
  cardForeground: OklchColor
  popover: OklchColor
  popoverForeground: OklchColor
  primary: OklchColor
  primaryForeground: OklchColor
  secondary: OklchColor
  secondaryForeground: OklchColor
  muted: OklchColor
  mutedForeground: OklchColor
  accent: OklchColor
  accentForeground: OklchColor
  destructive: OklchColor
  destructiveForeground: OklchColor
  // On-air red for LIVE badges and the guide's live row
  live: OklchColor
  liveForeground: OklchColor
  // Guide programme blocks (airing now / later)
  guideNow: OklchColor
  guideFuture: OklchColor
  // Status colours (connection dots, notices)
  success: OklchColor
  successForeground: OklchColor
  warning: OklchColor
  warningForeground: OklchColor
  info: OklchColor
  infoForeground: OklchColor
  border: OklchColor
  input: OklchColor
  ring: OklchColor
  // Chart colors
  chart1: OklchColor
  chart2: OklchColor
  chart3: OklchColor
  chart4: OklchColor
  chart5: OklchColor
  // Sidebar colors
  sidebar: OklchColor
  sidebarForeground: OklchColor
  sidebarPrimary: OklchColor
  sidebarPrimaryForeground: OklchColor
  sidebarAccent: OklchColor
  sidebarAccentForeground: OklchColor
  sidebarBorder: OklchColor
  sidebarRing: OklchColor
}

/**
 * Complete theme definition
 */
export interface Theme {
  id: ThemeId
  name: string
  mode: ThemeMode
  colors: ThemeColors
}

/**
 * Theme category for organizing theme display
 */
export interface ThemeCategory {
  label: string
  mode: ThemeMode
  themes: Theme[]
}
