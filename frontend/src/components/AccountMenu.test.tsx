import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, renderHook, screen, fireEvent, waitFor, within } from '@/test/utils'
import { useRef, useState } from 'react'
import { AccountMenu } from './AccountMenu'
import { AdminModal } from './AdminModal'
import { useTVMode } from '@/hooks/useTVMode'
import { activeThemeId, useThemeStore } from '@/stores/themeStore'
import { useUIStore } from '@/stores/uiStore'

const auth = vi.hoisted(() => ({
  username: 'jon' as string | null,
  isAdmin: false,
  logout: (() => {}) as () => void,
}))
const appSettings = vi.hoisted(() => ({ userChannelSelection: false }))
// Chat is a build-time flag, off unless a test turns it on
const chatFlag = vi.hoisted(() => ({ enabled: false }))
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
vi.mock('@/hooks/useChatEnabled', () => ({ useChatEnabled: () => chatFlag.enabled }))
vi.mock('@/hooks/useFeedbackFeature', () => ({ useFeedbackFeature: () => feedback }))
vi.mock('@/hooks/useInstallPrompt', () => ({ useInstallPrompt: () => installPrompt }))
// The props the menu last passed the feedback dialog
const feedbackDialog = vi.hoisted(() => ({ returnFocusTo: undefined as { current: HTMLElement | null } | undefined }))
vi.mock('@/components/FeedbackDialog', () => ({
  FeedbackDialog: ({ open, returnFocusTo }: { open: boolean; returnFocusTo?: { current: HTMLElement | null } }) => {
    feedbackDialog.returnFocusTo = returnFocusTo
    return open ? <div role="dialog">Feedback form</div> : null
  },
}))

// The admin panel's tabs fetch on mount; only its dialog matters here
vi.mock('@/components/ChannelList', () => ({ ChannelList: () => null }))
vi.mock('@/components/admin/ChatTab', () => ({ ChatTab: () => null }))
vi.mock('@/components/admin/OnAirCard', () => ({ OnAirCard: () => null }))
vi.mock('@/components/admin/NHLGamesTab', () => ({ NHLGamesTab: () => null }))
vi.mock('@/components/admin/PeopleTab', () => ({ PeopleTab: () => null }))
vi.mock('@/components/admin/StatusTab', () => ({ StatusTab: () => null }))

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
  chatFlag.enabled = false
  feedback.isEnabled = false
  installPrompt.canInstall = false
  installPrompt.variant = 'native'
  installPrompt.install = vi.fn(() => Promise.resolve(true))
  useUIStore.setState({ notificationsEnabled: true, isNHLOverlayVisible: false, hideMyActivity: false, chatPreviews: true })
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
  it('gives an admin the admin panel and Change live channel', () => {
    auth.isAdmin = true
    const props = renderMenu()

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Admin panel' }))
    expect(props.onOpenAdmin).toHaveBeenCalledTimes(1)

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /Change live channel/ }))
    expect(props.onOpenChannelPicker).toHaveBeenCalledTimes(1)
  })

  it('gives a permitted viewer Change live channel only', () => {
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
    expect(screen.queryByRole('menuitem', { name: /Suggest a channel/ })).not.toBeInTheDocument()
  })

  it('gives a plain viewer Suggest a channel while chat is on, opening the switcher', () => {
    chatFlag.enabled = true
    const props = renderMenu()
    openMenu()

    expect(screen.queryByRole('menuitem', { name: /Change live channel/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /Suggest a channel/ }))
    expect(props.onOpenChannelPicker).toHaveBeenCalledTimes(1)
  })

  it('has no Suggest for anyone who can change live TV', () => {
    chatFlag.enabled = true
    appSettings.userChannelSelection = true
    renderMenu()
    openMenu()

    expect(screen.getByRole('menuitem', { name: /Change live channel/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Suggest a channel/ })).not.toBeInTheDocument()
  })

  // The page renders the admin panel outside the menu, as TVView and the couch view do
  function MenuWithAdmin() {
    const triggerRef = useRef<HTMLButtonElement>(null)
    const [adminOpen, setAdminOpen] = useState(false)
    return (
      <>
        <AccountMenu
          onOpenChannelPicker={() => {}}
          onOpenAdmin={() => setAdminOpen(true)}
          onReload={() => {}}
          isMobile={false}
          triggerRef={triggerRef}
        />
        <AdminModal open={adminOpen} onOpenChange={setAdminOpen} returnFocusTo={triggerRef} />
      </>
    )
  }

  // The Admin panel item unmounts with the menu, so focus goes back to the avatar, not <body>
  it('returns focus to the account menu button when the admin panel closes', async () => {
    auth.isAdmin = true
    render(<MenuWithAdmin />)
    trigger().focus()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Admin panel' }))
    const dialog = screen.getByRole('dialog', { name: 'Admin Panel' })
    // Radix moves focus on the next tick
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))

    fireEvent.keyDown(dialog, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger()).toHaveFocus())
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
  // The item that opened it unmounts with the menu, so the dialog falls back to the avatar
  it('has the feedback dialog return focus to the account menu button', () => {
    feedback.isEnabled = true
    renderMenu()

    expect(feedbackDialog.returnFocusTo?.current).toBe(trigger())
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

  it('offers the same Install app on iOS, opening the Add to Home Screen steps', async () => {
    installPrompt.canInstall = true
    installPrompt.variant = 'ios'
    renderMenu()
    openMenu()
    expect(screen.queryByRole('menuitem', { name: 'Add to Home Screen' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Install app' }))

    const sheet = await screen.findByRole('dialog', { name: /Add Channel Club to your Home Screen/ })
    expect(sheet).toHaveTextContent('Tap Share')
    expect(installPrompt.install).not.toHaveBeenCalled()
  })

  it('returns focus to the account menu button when the iOS steps close', async () => {
    installPrompt.canInstall = true
    installPrompt.variant = 'ios'
    renderMenu()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Install app' }))
    const sheet = await screen.findByRole('dialog', { name: /Add Channel Club to your Home Screen/ })

    fireEvent.keyDown(sheet, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Radix moves focus on the next tick
    await waitFor(() => expect(trigger()).toHaveFocus())
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

describe("AccountMenu 'Hide what I'm watching'", () => {
  it("is off by default, and says you won't see others' channels either and admins still see yours", () => {
    renderMenu()
    openMenu()

    const toggle = screen.getByRole('menuitemcheckbox', { name: "Hide what I'm watching" })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(toggle).toHaveAccessibleDescription(
      "Others see only your name, and you won't see their channels. Admins still see yours.",
    )
  })

  it('hides and shares again from the menu', () => {
    renderMenu()
    openMenu()

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: "Hide what I'm watching" }))
    expect(useUIStore.getState().hideMyActivity).toBe(true)

    openMenu()
    const toggle = screen.getByRole('menuitemcheckbox', { name: "Hide what I'm watching" })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle)
    expect(useUIStore.getState().hideMyActivity).toBe(false)
  })
})

describe("AccountMenu 'Show chat over the video'", () => {
  const toggle = () => screen.queryByRole('menuitemcheckbox', { name: 'Show chat over the video' })

  it('is on by default and turns the chat over the video off and on again', () => {
    chatFlag.enabled = true
    renderMenu()
    openMenu()

    expect(toggle()).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle()!)
    expect(useUIStore.getState().chatPreviews).toBe(false)

    openMenu()
    expect(toggle()).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle()!)
    expect(useUIStore.getState().chatPreviews).toBe(true)
  })

  it('is left out without chat', () => {
    renderMenu()
    openMenu()
    expect(toggle()).not.toBeInTheDocument()
  })

  it('is left out on the TV layout, which never draws chat over the video', () => {
    chatFlag.enabled = true
    localStorage.setItem('tv-mode', 'true')
    renderMenu()
    openMenu()
    expect(toggle()).not.toBeInTheDocument()
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

  // Lets the menu finish closing (Radix defers its own focus work a tick), as it has by the time anyone
  // closes the dialog again
  async function openAppearanceSettled() {
    const dialog = openAppearance()
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    return dialog
  }

  // The Appearance… item unmounts with the menu, so focus goes back to the avatar, not <body>
  it('returns focus to the account menu button when closed with Escape', async () => {
    const dialog = await openAppearanceSettled()

    fireEvent.keyDown(dialog, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger()).toHaveFocus())
  })

  it('returns focus to the account menu button when closed with the Close button', async () => {
    const dialog = await openAppearanceSettled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger()).toHaveFocus())
  })

  it('opens with focus on the selected mode, not on Auto', async () => {
    useThemeStore.setState({ followSystem: false, mode: 'dark' })
    const dialog = await openAppearanceSettled()

    const dark = within(dialog).getByRole('button', { name: 'Dark' })
    expect(dark).toHaveAttribute('aria-pressed', 'true')
    expect(dark).toHaveFocus()
  })

  it('opens with focus on Auto when the device follows the system', async () => {
    useThemeStore.setState({ followSystem: true })
    const dialog = await openAppearanceSettled()

    const auto = within(dialog).getByRole('button', { name: 'Auto' })
    expect(auto).toHaveAttribute('aria-pressed', 'true')
    expect(auto).toHaveFocus()
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
