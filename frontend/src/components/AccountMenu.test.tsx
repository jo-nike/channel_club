import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, renderHook, screen, fireEvent, waitFor, within } from '@/test/utils'
import { AccountMenu } from './AccountMenu'
import { useTVMode } from '@/hooks/useTVMode'
import { activeThemeId, useThemeStore } from '@/stores/themeStore'
import { useUIStore } from '@/stores/uiStore'

const auth = vi.hoisted(() => ({
  username: 'jon' as string | null,
  isAdmin: false,
  logout: (() => {}) as () => void,
}))
const appSettings = vi.hoisted(() => ({ userChannelSelection: false }))
const feedback = vi.hoisted(() => ({ isEnabled: false, isLoading: false }))
const installPrompt = vi.hoisted(() => ({
  canInstall: false,
  shouldPromote: false,
  variant: 'native' as 'native' | 'ios',
  install: (() => Promise.resolve(false)) as () => Promise<boolean>,
  dismiss: (() => {}) as () => void,
}))

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => appSettings }))
vi.mock('@/hooks/useFeedbackFeature', () => ({ useFeedbackFeature: () => feedback }))
vi.mock('@/hooks/useInstallPrompt', () => ({ useInstallPrompt: () => installPrompt }))
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

beforeEach(() => {
  auth.username = 'jon'
  auth.isAdmin = false
  auth.logout = vi.fn()
  appSettings.userChannelSelection = false
  feedback.isEnabled = false
  installPrompt.canInstall = false
  installPrompt.variant = 'native'
  installPrompt.install = vi.fn(() => Promise.resolve(true))
  useUIStore.setState({ notificationsEnabled: true, isNHLOverlayVisible: false })
  useThemeStore.setState(useThemeStore.getInitialState())
  localStorage.removeItem('tv-mode')
})

afterEach(() => {
  document.documentElement.classList.remove('dark')
  document.documentElement.style.cssText = ''
  localStorage.removeItem('tv-mode')
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

describe('AccountMenu install', () => {
  it('leaves installation out when the app cannot be installed', () => {
    renderMenu()
    openMenu()
    expect(screen.queryByRole('menuitem', { name: 'Install app' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Add to Home Screen' })).not.toBeInTheDocument()
  })

  it("offers Install app when the browser can install it, opening the browser's dialog", () => {
    installPrompt.canInstall = true
    renderMenu()
    openMenu()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Install app' }))

    expect(installPrompt.install).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menuitem', { name: 'Add to Home Screen' })).not.toBeInTheDocument()
  })

  it('offers Add to Home Screen on iOS, opening the instructions', async () => {
    installPrompt.canInstall = true
    installPrompt.variant = 'ios'
    renderMenu()
    openMenu()
    expect(screen.queryByRole('menuitem', { name: 'Install app' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to Home Screen' }))

    const sheet = await screen.findByRole('dialog', { name: /Add Channel Club to your Home Screen/ })
    expect(sheet).toHaveTextContent('Tap Share')
    expect(installPrompt.install).not.toHaveBeenCalled()
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

describe('AccountMenu appearance', () => {
  function openAppearance() {
    renderMenu()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Appearance…' }))
    return screen.getByRole('dialog', { name: 'Appearance' })
  }

  it('opens the appearance picker in a dialog and closes the menu', () => {
    const dialog = openAppearance()

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('group', { name: 'Appearance' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Club Night' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('sets the theme from a tile in the dialog', () => {
    const dialog = openAppearance()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Dracula' }))

    expect(activeThemeId(useThemeStore.getState())).toBe('dracula')
    expect(within(dialog).getByRole('button', { name: 'Dracula' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('scrolls inside the screen and becomes a bottom sheet on phones', () => {
    const dialog = openAppearance()

    expect(dialog).toHaveClass('max-h-[85dvh]', 'overflow-y-auto', 'max-sm:bottom-0', 'max-sm:top-auto')
  })

  it('no longer has a theme submenu', () => {
    renderMenu()
    openMenu()
    expect(screen.queryByRole('menuitem', { name: 'Theme' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitemradio', { name: 'Club Night' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitemradio', { name: 'Dracula' })).not.toBeInTheDocument()
  })
})

describe('AccountMenu TV layout', () => {
  function tvLayoutGroup() {
    return screen.getByRole('group', { name: 'TV layout (10-foot)' })
  }

  function option(name: 'Auto' | 'On' | 'Off') {
    return within(tvLayoutGroup()).getByRole('menuitemradio', { name })
  }

  it('offers Auto, On and Off, on Auto when nothing is stored', () => {
    renderMenu()
    openMenu()

    expect(within(tvLayoutGroup()).getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      'Auto',
      'On',
      'Off',
    ])
    expect(option('Auto')).toHaveAttribute('aria-checked', 'true')
    expect(option('On')).toHaveAttribute('aria-checked', 'false')
  })

  it('shows the stored choice', () => {
    localStorage.setItem('tv-mode', 'false')
    renderMenu()
    openMenu()

    expect(option('Off')).toHaveAttribute('aria-checked', 'true')
    expect(option('Auto')).toHaveAttribute('aria-checked', 'false')
  })

  it('On and Off store the override, and Auto clears it', () => {
    renderMenu()

    openMenu()
    fireEvent.click(option('On'))
    expect(localStorage.getItem('tv-mode')).toBe('true')

    openMenu()
    expect(option('On')).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(option('Off'))
    expect(localStorage.getItem('tv-mode')).toBe('false')

    openMenu()
    expect(option('Off')).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(option('Auto'))
    expect(localStorage.getItem('tv-mode')).toBeNull()

    openMenu()
    expect(option('Auto')).toHaveAttribute('aria-checked', 'true')
  })

  it('switches the layout without a reload', () => {
    const { result } = renderHook(() => useTVMode())
    renderMenu()
    expect(result.current).toBe(false)

    openMenu()
    fireEvent.click(option('On'))
    expect(result.current).toBe(true)

    openMenu()
    fireEvent.click(option('Auto'))
    expect(result.current).toBe(false)
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
