/**
 * Theme definitions with Glance-inspired color palettes
 * All colors are in OKLCH format for CSS custom properties
 *
 * HSL to OKLCH conversion notes:
 * - Lighter colors have higher L values (0.9+)
 * - Darker colors have lower L values (0.1-0.3)
 * - Saturation maps to chroma (C) - higher saturation = higher chroma
 * - Hue is roughly the same (H)
 */

import type { Theme, ThemeId, ThemeCategory } from '@/types/theme'

/**
 * Helper to create derived colors from base background/primary
 * This ensures consistent color relationships across all themes
 */
function createDarkThemeColors(
  background: string,
  primary: string,
  accent: string = primary
): Theme['colors'] {
  // Parse L value from background to derive other colors
  const bgParts = background.split(' ')
  const bgL = parseFloat(bgParts[0])
  const bgC = parseFloat(bgParts[1])
  const bgH = bgParts[2] || '0'

  // Parse primary for foreground derivation
  const primaryParts = primary.split(' ')
  const primaryL = parseFloat(primaryParts[0])
  const primaryC = parseFloat(primaryParts[1])
  const primaryH = primaryParts[2] || '0'

  // Parse accent for foreground derivation
  const accentParts = accent.split(' ')
  const accentL = parseFloat(accentParts[0])

  // Card is slightly lighter than background
  const cardL = Math.min(bgL + 0.06, 0.3)
  // Muted is between background and card
  const mutedL = Math.min(bgL + 0.12, 0.35)

  return {
    background: `oklch(${background})`,
    foreground: 'oklch(0.985 0 0)',
    card: `oklch(${cardL} ${bgC} ${bgH})`,
    cardForeground: 'oklch(0.985 0 0)',
    popover: `oklch(${cardL} ${bgC} ${bgH})`,
    popoverForeground: 'oklch(0.985 0 0)',
    primary: `oklch(${primary})`,
    primaryForeground: primaryL > 0.6 ? 'oklch(0.2 0 0)' : 'oklch(0.985 0 0)',
    secondary: `oklch(${mutedL} ${bgC * 0.5} ${bgH})`,
    secondaryForeground: 'oklch(0.985 0 0)',
    muted: `oklch(${mutedL} ${bgC * 0.5} ${bgH})`,
    mutedForeground: 'oklch(0.708 0 0)',
    accent: `oklch(${accent})`,
    accentForeground: accentL > 0.6 ? 'oklch(0.2 0 0)' : 'oklch(0.985 0 0)',
    destructive: 'oklch(0.704 0.191 22.216)',
    border: 'oklch(1 0 0 / 10%)',
    input: 'oklch(1 0 0 / 15%)',
    ring: `oklch(${Math.max(primaryL - 0.2, 0.4)} ${primaryC * 0.8} ${primaryH})`,
    chart1: `oklch(${primary})`,
    chart2: 'oklch(0.696 0.17 162.48)',
    chart3: 'oklch(0.769 0.188 70.08)',
    chart4: 'oklch(0.627 0.265 303.9)',
    chart5: 'oklch(0.645 0.246 16.439)',
    sidebar: `oklch(${cardL} ${bgC} ${bgH})`,
    sidebarForeground: 'oklch(0.985 0 0)',
    sidebarPrimary: `oklch(${primary})`,
    sidebarPrimaryForeground: 'oklch(0.985 0 0)',
    sidebarAccent: `oklch(${mutedL} ${bgC * 0.5} ${bgH})`,
    sidebarAccentForeground: 'oklch(0.985 0 0)',
    sidebarBorder: 'oklch(1 0 0 / 10%)',
    sidebarRing: `oklch(${Math.max(primaryL - 0.2, 0.4)} ${primaryC * 0.8} ${primaryH})`,
  }
}

function createLightThemeColors(
  background: string,
  primary: string
): Theme['colors'] {
  const bgParts = background.split(' ')
  const bgL = parseFloat(bgParts[0])
  const bgC = parseFloat(bgParts[1])
  const bgH = bgParts[2] || '0'

  const primaryParts = primary.split(' ')
  const primaryL = parseFloat(primaryParts[0])
  const primaryC = parseFloat(primaryParts[1])
  const primaryH = primaryParts[2] || '0'

  // Light theme cards are white or very light
  const cardL = Math.min(bgL + 0.02, 1)
  const mutedL = Math.max(bgL - 0.05, 0.9)
  const borderL = Math.max(bgL - 0.1, 0.85)

  return {
    background: `oklch(${background})`,
    foreground: 'oklch(0.145 0 0)',
    card: `oklch(${cardL} ${bgC * 0.5} ${bgH})`,
    cardForeground: 'oklch(0.145 0 0)',
    popover: `oklch(${cardL} ${bgC * 0.5} ${bgH})`,
    popoverForeground: 'oklch(0.145 0 0)',
    primary: `oklch(${primary})`,
    primaryForeground: primaryL > 0.6 ? 'oklch(0.145 0 0)' : 'oklch(0.985 0 0)',
    secondary: `oklch(${mutedL} ${bgC * 0.3} ${bgH})`,
    secondaryForeground: 'oklch(0.205 0 0)',
    muted: `oklch(${mutedL} ${bgC * 0.3} ${bgH})`,
    mutedForeground: 'oklch(0.45 0 0)',
    accent: `oklch(${mutedL} ${bgC * 0.3} ${bgH})`,
    accentForeground: 'oklch(0.205 0 0)',
    destructive: 'oklch(0.577 0.245 27.325)',
    border: `oklch(${borderL} ${bgC * 0.2} ${bgH})`,
    input: `oklch(${borderL} ${bgC * 0.2} ${bgH})`,
    ring: `oklch(${primaryL} ${primaryC * 0.8} ${primaryH})`,
    chart1: `oklch(${primary})`,
    chart2: 'oklch(0.6 0.118 184.704)',
    chart3: 'oklch(0.398 0.07 227.392)',
    chart4: 'oklch(0.828 0.189 84.429)',
    chart5: 'oklch(0.769 0.188 70.08)',
    sidebar: `oklch(${cardL} ${bgC * 0.3} ${bgH})`,
    sidebarForeground: 'oklch(0.145 0 0)',
    sidebarPrimary: `oklch(${primary})`,
    sidebarPrimaryForeground: 'oklch(0.985 0 0)',
    sidebarAccent: `oklch(${mutedL} ${bgC * 0.3} ${bgH})`,
    sidebarAccentForeground: 'oklch(0.205 0 0)',
    sidebarBorder: `oklch(${borderL} ${bgC * 0.2} ${bgH})`,
    sidebarRing: `oklch(${primaryL} ${primaryC * 0.8} ${primaryH})`,
  }
}

/**
 * All available themes - 14 Glance themes
 *
 * HSL to OKLCH approximate conversions:
 * HSL(240, 21%, 15%) → oklch(0.19 0.022 265) - Catppuccin Mocha bg
 * HSL(217, 92%, 83%) → oklch(0.85 0.14 250)  - Catppuccin Mocha primary
 */
export const themes: Record<ThemeId, Theme> = {
  // === DARK THEMES (11) ===

  'teal-city': {
    id: 'teal-city',
    name: 'Teal City',
    mode: 'dark',
    colors: createDarkThemeColors(
      '0.16 0.015 200', // Dark teal-blue background
      '0.72 0.14 190' // Teal primary
    ),
  },

  'catppuccin-frappe': {
    id: 'catppuccin-frappe',
    name: 'Catppuccin Frappé',
    mode: 'dark',
    colors: createDarkThemeColors(
      '0.32 0.025 260', // HSL(229, 20%, 30%)
      '0.80 0.13 250' // HSL(220, 83%, 75%)
    ),
  },

  'catppuccin-macchiato': {
    id: 'catppuccin-macchiato',
    name: 'Catppuccin Macchiato',
    mode: 'dark',
    colors: createDarkThemeColors(
      '0.25 0.022 265', // HSL(232, 20%, 23%)
      '0.82 0.14 250' // HSL(220, 91%, 80%)
    ),
  },

  'catppuccin-mocha': {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    mode: 'dark',
    colors: createDarkThemeColors(
      '0.19 0.022 265', // HSL(240, 21%, 15%)
      '0.85 0.14 250' // HSL(217, 92%, 83%)
    ),
  },

  camouflage: {
    id: 'camouflage',
    name: 'Camouflage',
    mode: 'dark',
    colors: createDarkThemeColors(
      '0.18 0.025 130', // Dark olive green
      '0.60 0.12 135' // Military green
    ),
  },

  'gruvbox-dark': {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    mode: 'dark',
    colors: createDarkThemeColors(
      '0.21 0.005 50', // HSL(0, 0%, 16%) - neutral dark
      '0.85 0.11 85' // HSL(43, 59%, 81%) - warm yellow
    ),
  },

  'kanagawa-dark': {
    id: 'kanagawa-dark',
    name: 'Kanagawa Dark',
    mode: 'dark',
    colors: createDarkThemeColors(
      '0.18 0.025 270', // Deep purple-blue
      '0.75 0.12 240' // Japanese wave blue
    ),
  },

  tucan: {
    id: 'tucan',
    name: 'Tucan',
    mode: 'dark',
    colors: createDarkThemeColors(
      '0.15 0.01 270', // Very dark
      '0.75 0.20 35' // Orange-yellow (tucan beak)
    ),
  },

  dracula: {
    id: 'dracula',
    name: 'Dracula',
    mode: 'dark',
    colors: createDarkThemeColors(
      '0.24 0.028 270', // HSL(231, 15%, 21%)
      '0.72 0.22 295' // HSL(265, 89%, 79%) - purple
    ),
  },

  'shades-of-purple': {
    id: 'shades-of-purple',
    name: 'Shades of Purple',
    mode: 'dark',
    colors: createDarkThemeColors(
      '0.18 0.06 285', // Deep purple background
      '0.68 0.25 300' // Vibrant purple
    ),
  },

  'neon-pink': {
    id: 'neon-pink',
    name: 'Neon Pink',
    mode: 'dark',
    colors: createDarkThemeColors(
      '0.15 0.03 270', // HSL(240, 27%, 11%)
      '0.70 0.28 340' // HSL(321, 100%, 71%) - neon pink
    ),
  },

  // === LIGHT THEMES (3) ===

  'catppuccin-latte': {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    mode: 'light',
    colors: createLightThemeColors(
      '0.96 0.01 250', // HSL(220, 23%, 95%)
      '0.55 0.20 250' // HSL(220, 91%, 54%)
    ),
  },

  peachy: {
    id: 'peachy',
    name: 'Peachy',
    mode: 'light',
    colors: createLightThemeColors(
      '0.85 0.06 55', // HSL(28, 40%, 77%) - warm peach
      '0.45 0.14 160' // HSL(155, 100%, 20%) - teal accent
    ),
  },

  zebra: {
    id: 'zebra',
    name: 'Zebra',
    mode: 'light',
    colors: createLightThemeColors(
      '0.96 0 0', // HSL(0, 0%, 95%) - pure light gray
      '0.20 0 0' // HSL(0, 0%, 10%) - pure dark gray
    ),
  },
}

/**
 * Get theme by ID
 */
export function getTheme(id: ThemeId): Theme {
  return themes[id] ?? themes[DEFAULT_THEME_ID]
}

/**
 * Get all themes grouped by category (dark/light)
 */
export function getThemeCategories(): ThemeCategory[] {
  const darkThemes = Object.values(themes).filter((t) => t.mode === 'dark')
  const lightThemes = Object.values(themes).filter((t) => t.mode === 'light')

  return [
    { label: 'Dark Themes', mode: 'dark', themes: darkThemes },
    { label: 'Light Themes', mode: 'light', themes: lightThemes },
  ]
}

/**
 * Get list of all theme IDs
 */
export function getAllThemeIds(): ThemeId[] {
  return Object.keys(themes) as ThemeId[]
}

/**
 * Default theme ID
 */
export const DEFAULT_THEME_ID: ThemeId = 'catppuccin-mocha'
