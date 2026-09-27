import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@/test/utils'
import { AccountMenu } from './AccountMenu'
import { useThemeStore } from '@/stores/themeStore'
import { useUIStore } from '@/stores/uiStore'
import { DEFAULT_THEME_ID, getTheme } from '@/lib/themes'

const auth = vi.hoisted(() => ({
  username: 'jon' as string | null,
  isAdmin: false,
  logout: (() => {}) as () => void,
}))
const appSettings = vi.hoisted(() => ({ userChannelSelection: false }))
const feedback = vi.hoisted(() => ({ isEnabled: false, isLoading: false }))

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => appSettings }))
vi.mock('@/hooks/useFeedbackFeature', () => ({ useFeedbackFeature: () => feedback }))
vi.mock('@/components/FeedbackDialog', () => ({
  FeedbackDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog">Feedback form</div> : null),
}))

function renderMenu(overrides: { isMobile?: boolean } = {}) {
  const props = {
    onOpenChannelPicker: vi.fn(),
    onOpenAdmin: vi.fn(),
    onReload: vi.fn(),
    isMobile: false,
    ...overrides,
  }
  render(<AccountMenu {...props} />)
  return props
}

function trigger() {
  return screen.getByRole('button', { name: 'Account menu' })
}

function openMenu() {
  fireEvent.keyDown(trigger(), { key: 'Enter' })
  return screen.getByRole('menu')
}

function openThemes() {
  renderMenu()
  openMenu()
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Theme' }), { key: 'ArrowRight' })
}

function themeRow(name: string) {
  return screen.getByRole('menuitemradio', { name })
}

beforeEach(() => {
  auth.username = 'jon'
  auth.isAdmin = false
  auth.logout = vi.fn()
  appSettings.userChannelSelection = false
  feedback.isEnabled = false
  useUIStore.setState({ notificationsEnabled: true, isNHLOverlayVisible: false })
  useThemeStore.setState({ themeId: DEFAULT_THEME_ID })
})

afterEach(() => {
  document.documentElement.classList.remove('dark')
  document.documentElement.style.cssText = ''
})

describe('AccountMenu trigger', () => {
  it("shows the first letter of the user's name on a 44px/36px toolbar avatar", () => {
    renderMenu()
    const button = trigger()
    expect(button).toHaveTextContent(/^J$/)
    expect(button).toHaveAttribute('data-variant', 'toolbar')
    expect(button).toHaveClass('size-11', 'md:size-9')
  })

  it('falls back to a person icon without a username', () => {
    auth.username = null
    renderMenu()
    expect(trigger()).toHaveTextContent('')
    expect(trigger().querySelector('svg')).not.toBeNull()
  })

  it('names who is signed in at the top of the menu', () => {
    renderMenu()
    expect(within(openMenu()).getByText('jon')).toBeInTheDocument()
  })
})

describe('AccountMenu live channel and admin items', () => {
  it('gives an admin the admin panel and the live channel picker', () => {
    auth.isAdmin = true
    const props = renderMenu()

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Admin panel' }))
    expect(props.onOpenAdmin).toHaveBeenCalledTimes(1)

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /Change live channel/ }))
    expect(props.onOpenChannelPicker).toHaveBeenCalledTimes(1)
  })

  it('gives a permitted viewer the live channel picker only', () => {
    appSettings.userChannelSelection = true
    renderMenu()
    openMenu()
    expect(screen.getByRole('menuitem', { name: /Change live channel/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Admin panel' })).not.toBeInTheDocument()
  })

  it('gives a plain viewer neither', () => {
    renderMenu()
    openMenu()
    expect(screen.queryByRole('menuitem', { name: /Change live channel/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Admin panel' })).not.toBeInTheDocument()
  })

  it('reloads the stream', () => {
    const props = renderMenu()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reload stream' }))
    expect(props.onReload).toHaveBeenCalledTimes(1)
  })
})

describe('AccountMenu feedback', () => {
  it('offers Send feedback when feedback is configured', () => {
    feedback.isEnabled = true
    renderMenu()
    openMenu()
    expect(screen.getByRole('menuitem', { name: 'Send feedback' })).toBeInTheDocument()
  })

  it('leaves Send feedback out when feedback is not configured', () => {
    renderMenu()
    openMenu()
    expect(screen.queryByRole('menuitem', { name: 'Send feedback' })).not.toBeInTheDocument()
  })

  it('opens the feedback dialog from the item', () => {
    feedback.isEnabled = true
    renderMenu()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Send feedback' }))

    expect(screen.getByRole('dialog')).toHaveTextContent('Feedback form')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('AccountMenu live-change pop-up checkbox', () => {
  it('names the setting after what it does and toggles it', () => {
    renderMenu()
    openMenu()

    const toggle = screen.getByRole('menuitemcheckbox', { name: 'Pop-up when the live channel changes' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle)
    expect(useUIStore.getState().notificationsEnabled).toBe(false)

    openMenu()
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Pop-up when the live channel changes' }),
    ).toHaveAttribute('aria-checked', 'false')
  })
})

describe('AccountMenu NHL scores', () => {
  it('carries the NHL toggle on phones, where the header has none', () => {
    renderMenu({ isMobile: true })
    openMenu()

    const nhl = screen.getByRole('menuitemcheckbox', { name: 'NHL scores' })
    expect(nhl).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(nhl)
    expect(useUIStore.getState().isNHLOverlayVisible).toBe(true)
  })

  it('leaves it to the header toggle on desktop', () => {
    renderMenu()
    openMenu()
    expect(screen.queryByRole('menuitemcheckbox', { name: 'NHL scores' })).not.toBeInTheDocument()
  })
})

describe('AccountMenu theme submenu', () => {
  it('lists the themes by category as a radio group with the current one checked', () => {
    openThemes()
    expect(screen.getByRole('group', { name: 'Dark Themes' })).toContainElement(themeRow('Club Night'))
    expect(screen.getByRole('group', { name: 'Light Themes' })).toContainElement(themeRow('Catppuccin Latte'))
    expect(themeRow('Club Night')).toHaveAttribute('aria-checked', 'true')
    expect(themeRow('Dracula')).toHaveAttribute('aria-checked', 'false')
  })

  it('sets the theme from a row', () => {
    openThemes()
    fireEvent.click(themeRow('Catppuccin Latte'))
    expect(useThemeStore.getState().themeId).toBe('catppuccin-latte')
  })

  it('marks the selected row readable on the accent surface with a primary check', () => {
    openThemes()

    const selected = themeRow('Club Night')
    expect(selected).toHaveClass(
      'data-[state=checked]:bg-accent',
      'data-[state=checked]:text-accent-foreground',
    )
    expect(selected).toHaveAttribute('data-state', 'checked')
    expect(selected.querySelector('svg.text-primary')).not.toBeNull()

    const other = themeRow('Dracula')
    expect(other).toHaveAttribute('data-state', 'unchecked')
    expect(other.querySelector('svg.text-primary')).toBeNull()
  })

  it('shows background, card and primary swatches for each theme', () => {
    openThemes()

    const { colors } = getTheme('dracula')
    const swatches = themeRow('Dracula').querySelectorAll<HTMLElement>('span[aria-hidden="true"] > span')
    expect(Array.from(swatches, (s) => s.getAttribute('style'))).toEqual([
      `background-color: ${colors.background};`,
      `background-color: ${colors.card};`,
      `background-color: ${colors.primary};`,
    ])
  })
})

describe('AccountMenu sign out and keyboard', () => {
  it('signs out', () => {
    renderMenu()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(auth.logout).toHaveBeenCalledTimes(1)
  })

  it('moves focus with ArrowDown, and Escape closes and returns focus to the avatar', async () => {
    renderMenu()
    openMenu()

    const reload = screen.getByRole('menuitem', { name: 'Reload stream' })
    expect(reload).toHaveFocus()
    fireEvent.keyDown(reload, { key: 'ArrowDown' })
    // Radix moves roving focus on the next tick
    await waitFor(() =>
      expect(
        screen.getByRole('menuitemcheckbox', { name: 'Pop-up when the live channel changes' }),
      ).toHaveFocus(),
    )

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(trigger()).toHaveFocus()
  })
})
