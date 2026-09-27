import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
import { UserSettingsMenu } from './UserSettingsMenu'
import { useThemeStore } from '@/stores/themeStore'
import { useUIStore } from '@/stores/uiStore'
import { DEFAULT_THEME_ID, getTheme } from '@/lib/themes'

function openMenu() {
  render(<UserSettingsMenu onLogout={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /user settings/i }))
}

function themeRow(name: string) {
  return screen.getByRole('button', { name })
}

describe('UserSettingsMenu theme options', () => {
  beforeEach(() => {
    useThemeStore.setState({ themeId: DEFAULT_THEME_ID })
    document.documentElement.classList.remove('dark')
    document.documentElement.style.cssText = ''
  })

  afterEach(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.style.cssText = ''
  })

  it('marks the selected theme row as pressed and readable on the accent surface', () => {
    openMenu()

    const selected = themeRow('Club Night')
    expect(selected).toHaveAttribute('aria-pressed', 'true')
    expect(selected).toHaveClass('bg-accent', 'text-accent-foreground')
  })

  it('shows a primary check only on the selected row', () => {
    openMenu()

    expect(themeRow('Club Night').querySelector('svg.text-primary')).not.toBeNull()

    const other = themeRow('Dracula')
    expect(other).toHaveAttribute('aria-pressed', 'false')
    expect(other).not.toHaveClass('bg-accent')
    expect(other.querySelector('svg.text-primary')).toBeNull()
  })

  it('moves the selected state when another theme is picked', () => {
    openMenu()

    fireEvent.click(themeRow('Catppuccin Latte'))

    expect(themeRow('Catppuccin Latte')).toHaveAttribute('aria-pressed', 'true')
    expect(themeRow('Catppuccin Latte')).toHaveClass('text-accent-foreground')
    expect(themeRow('Club Night')).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows background, card and primary swatches for each theme', () => {
    openMenu()

    const { colors } = getTheme('dracula')
    const swatches = themeRow('Dracula').querySelectorAll<HTMLElement>('div[aria-hidden="true"]')
    expect(Array.from(swatches, (s) => s.getAttribute('style'))).toEqual([
      `background-color: ${colors.background};`,
      `background-color: ${colors.card};`,
      `background-color: ${colors.primary};`,
    ])
  })
})

describe('UserSettingsMenu live-change pop-up toggle', () => {
  beforeEach(() => {
    useUIStore.setState({ notificationsEnabled: true })
  })

  it('names the setting after what it does and toggles it', () => {
    openMenu()

    const toggle = screen.getByRole('button', { name: /pop-up when the live channel changes/i })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(toggle)

    expect(useUIStore.getState().notificationsEnabled).toBe(false)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })
})
