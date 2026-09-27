import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@/test/utils'
import { AppearancePicker } from './AppearancePicker'
import { activeThemeId, useThemeStore } from '@/stores/themeStore'
import { getTheme, getThemeCategories } from '@/lib/themes'

/** A colour as the browser reports it back from an inline style */
function asStyled(color: string) {
  const el = document.createElement('span')
  el.style.backgroundColor = color
  return el.style.backgroundColor
}

function tile(name: string) {
  return screen.getByRole('button', { name })
}

function mode(name: 'Auto' | 'Dark' | 'Light') {
  return within(screen.getByRole('group', { name: 'Appearance' })).getByRole('button', { name })
}

function group(name: 'Dark' | 'Light') {
  return screen.queryByRole('region', { name })
}

beforeEach(() => {
  useThemeStore.setState(useThemeStore.getInitialState())
  localStorage.removeItem('theme-storage')
})

describe('AppearancePicker tiles', () => {
  it('shows long theme names in full, wrapping instead of truncating', () => {
    useThemeStore.setState({ darkThemeId: 'catppuccin-macchiato' })
    render(<AppearancePicker />)

    for (const name of ['Catppuccin Macchiato', 'Catppuccin Frappé', 'Catppuccin Mocha']) {
      const label = within(tile(name)).getByText(name)
      expect(label).not.toHaveClass('truncate')
      expect(label).toHaveClass('min-w-0', '[overflow-wrap:anywhere]')
    }
  })

  it('sets the theme from a tile and marks only that tile pressed', () => {
    render(<AppearancePicker />)
    expect(tile('Club Night')).toHaveAttribute('aria-pressed', 'true')
    expect(tile('Dracula')).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(tile('Dracula'))

    expect(activeThemeId(useThemeStore.getState())).toBe('dracula')
    expect(tile('Dracula')).toHaveAttribute('aria-pressed', 'true')
    expect(tile('Club Night')).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows a check on the chosen tile, not colour alone', () => {
    render(<AppearancePicker />)
    expect(tile('Club Night').querySelector('svg')).not.toBeNull()
    expect(tile('Dracula').querySelector('svg')).toBeNull()
  })

  it("draws each preview in the theme's own colours", () => {
    render(<AppearancePicker />)

    const { colors } = getTheme('gruvbox-dark')
    const preview = tile('Gruvbox Dark').querySelector<HTMLElement>('[data-slot="theme-preview"]')
    expect(preview).toHaveAttribute('aria-hidden', 'true')
    expect(preview?.style.backgroundColor).toBe(asStyled(colors.background))

    const painted = Array.from(preview?.querySelectorAll<HTMLElement>('span') ?? [], (el) => el.style.backgroundColor)
    for (const color of [colors.card, colors.primary, colors.live, colors.guideNow, colors.guideFuture, colors.secondary]) {
      expect(painted).toContain(asStyled(color))
    }
  })
})

describe('AppearancePicker Dark and Light', () => {
  it('starts on Dark with only the dark themes', () => {
    render(<AppearancePicker />)

    expect(mode('Dark')).toHaveAttribute('aria-pressed', 'true')
    expect(mode('Auto')).toHaveAttribute('aria-pressed', 'false')
    const darkCount = getThemeCategories().find((c) => c.mode === 'dark')?.themes.length
    expect(within(group('Dark')!).getAllByRole('button')).toHaveLength(darkCount!)
    expect(group('Light')).toBeNull()
  })

  it('switches to the remembered light pick and lists the light themes', () => {
    useThemeStore.setState({ lightThemeId: 'peachy' })
    render(<AppearancePicker />)

    fireEvent.click(mode('Light'))

    expect(activeThemeId(useThemeStore.getState())).toBe('peachy')
    expect(mode('Light')).toHaveAttribute('aria-pressed', 'true')
    expect(group('Dark')).toBeNull()
    expect(within(group('Light')!).getByRole('button', { name: 'Peachy' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('AppearancePicker Auto', () => {
  it('sets followSystem and shows both groups with one pick pressed in each', () => {
    useThemeStore.setState({ darkThemeId: 'dracula', lightThemeId: 'zebra' })
    render(<AppearancePicker />)

    fireEvent.click(mode('Auto'))

    expect(useThemeStore.getState().followSystem).toBe(true)
    expect(mode('Auto')).toHaveAttribute('aria-pressed', 'true')
    expect(mode('Dark')).toHaveAttribute('aria-pressed', 'false')

    const dark = within(group('Dark')!)
    const light = within(group('Light')!)
    expect(dark.getByText('When your device is in dark mode')).toBeInTheDocument()
    expect(light.getByText('When your device is in light mode')).toBeInTheDocument()
    expect(dark.getAllByRole('button', { pressed: true }).map((b) => b.textContent)).toEqual(['Dracula'])
    expect(light.getAllByRole('button', { pressed: true }).map((b) => b.textContent)).toEqual(['Zebra'])
  })

  it('picks the light theme without leaving Auto', () => {
    useThemeStore.setState({ followSystem: true })
    render(<AppearancePicker />)

    fireEvent.click(tile('Catppuccin Latte'))

    const state = useThemeStore.getState()
    expect(state.followSystem).toBe(true)
    expect(state.lightThemeId).toBe('catppuccin-latte')
    expect(tile('Catppuccin Latte')).toHaveAttribute('aria-pressed', 'true')
    // The dark pick stays pressed too
    expect(tile('Club Night')).toHaveAttribute('aria-pressed', 'true')
  })

  it('leaves Auto for Dark', () => {
    useThemeStore.setState({ followSystem: true })
    render(<AppearancePicker />)

    fireEvent.click(mode('Dark'))

    expect(useThemeStore.getState().followSystem).toBe(false)
    expect(useThemeStore.getState().mode).toBe('dark')
    expect(group('Light')).toBeNull()
  })
})
