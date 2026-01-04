/**
 * Theme type definitions for Glance-inspired color themes
 * Supports 14 themes organized into dark and light categories
 */

// Union type of all available theme IDs
export type ThemeId =
  // Dark themes (11)
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
  // Light themes (3)
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
