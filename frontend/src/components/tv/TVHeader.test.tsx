import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act } from '@/test/utils'
import { TVHeader } from './TVHeader'
import { useTVStore } from '@/stores/tvStore'
import { useUIStore } from '@/stores/uiStore'
import { useChannelStore } from '@/stores/channelStore'
import { useChatStore } from '@/stores/chatStore'
import { usePresenceStore } from '@/stores/presenceStore'
import type { PresenceEntry } from '@/types'
import { useSettingsStore } from '@/stores/settingsStore'

const auth = vi.hoisted(() => ({ isAdmin: false }))
const appSettings = vi.hoisted(() => ({ userChannelSelection: false }))
const chatFlag = vi.hoisted(() => ({ enabled: true }))
const accountMenu = vi.hoisted(() => ({
  props: undefined as
    | undefined
    | { onOpenChannelPicker: () => void; onOpenAdmin: () => void; onReload: () => void; isMobile: boolean },
}))

vi.mock('@/services/api', () => ({ fetchNowPlaying: vi.fn(() => new Promise(() => {})) }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => appSettings }))
vi.mock('@/hooks/useChatEnabled', () => ({ useChatEnabled: () => chatFlag.enabled }))
vi.mock('@/components/AccountMenu', () => ({ AccountMenu: (props: NonNullable<typeof accountMenu.props>) => {
  accountMenu.props = props
  return <div data-testid="account-menu" />
} }))

const movies = { id: 'e1', name: 'Movies', number: 1, streamUrl: '/e1', type: 'ersatztv' as const, group: '' }

function renderHeader(overrides: Partial<Parameters<typeof TVHeader>[0]> = {}) {
  const props = {
    status: 'connected' as const,
    onReconnect: vi.fn(),
    onOpenAdmin: vi.fn(),
    onOpenChannelPicker: vi.fn(),
    onReload: vi.fn(),
    isMobile: false,
    ...overrides,
  }
  render(<TVHeader {...props} />)
  return props
}

beforeEach(() => {
  auth.isAdmin = false
  // NHL scores on, as the server's switch would have them for these tests
  useSettingsStore.setState({ serverFeatures: { chat: false, gif: false, nhl: true } })
  appSettings.userChannelSelection = false
  chatFlag.enabled = true
  accountMenu.props = undefined
  useChannelStore.setState({ currentChannel: null })
  useTVStore.setState({ selectedChannel: null, liveEPG: null })
  useUIStore.setState({ isEPGVisible: true, isNHLOverlayVisible: false })
  useChatStore.setState({ isOpen: false, unreadCount: 0 })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('TVHeader', () => {
  it('is the page banner, padded below the status bar', () => {
    renderHeader()
    expect(screen.getByRole('banner')).toHaveClass('pt-header-safe', 'pb-2')
  })

  it('is a square-edged bar, since it is anchored to the top edge', () => {
    renderHeader()
    expect(screen.getByRole('banner').className).not.toMatch(/\brounded/)
  })

  it('leads with the wordmark and a thin rule before the now-watching block on desktop', () => {
    renderHeader()
    const banner = screen.getByRole('banner')
    const wordmark = within(banner).getByRole('img', { name: 'Channel Club' })
    expect(wordmark).toHaveClass('font-display', 'uppercase')
    expect(wordmark).toHaveAttribute('data-size', 'md')

    const rule = banner.querySelector('[data-slot="header-separator"]')
    expect(rule).toHaveAttribute('aria-hidden', 'true')
    expect(rule).toHaveClass('w-px', 'bg-border')

    const block = within(banner).getByTestId('now-watching')
    expect(wordmark.compareDocumentPosition(rule!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(rule!.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('leaves the wordmark out on a phone, where the title needs the room', () => {
    renderHeader({ isMobile: true })
    const banner = screen.getByRole('banner')
    expect(within(banner).queryByRole('img', { name: 'Channel Club' })).not.toBeInTheDocument()
    expect(banner.querySelector('[data-slot="header-separator"]')).toBeNull()
    expect(within(banner).getByTestId('now-watching')).toBeInTheDocument()
  })

  it('shows what is on in the now-watching block, right of the connection status', () => {
    renderHeader()
    expect(screen.getByText('Tuning in...')).toBeVisible()
    cleanup()

    useTVStore.setState({ selectedChannel: movies })
    renderHeader()
    expect(screen.getByText('Movies')).toBeVisible()
    expect(screen.getByText('CH 1')).toBeVisible()
    cleanup()

    useTVStore.setState({
      selectedChannel: { id: 'live-channel-0', name: 'Sports', number: 0, streamUrl: '/a', type: 'live' },
      liveEPG: { channelId: 'a', currentProgram: { title: 'Big Game', startTime: '2026-09-06T11:00:00Z', endTime: '2099-01-01T00:00:00Z' } },
    })
    vi.useFakeTimers()
    renderHeader({ status: 'disconnected' })
    // The connection status shows once the socket has been down for 3s
    act(() => { vi.advanceTimersByTime(3000) })
    const block = within(screen.getByRole('banner')).getByTestId('now-watching')
    expect(within(block).getByText('Big Game')).toHaveClass('truncate')
    // The connection status stays to the left of the block
    const reconnect = screen.getByRole('button', { name: 'Retry' })
    expect(reconnect.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("offers 'Live now · Join' on a phone while live TV is on elsewhere", () => {
    useChannelStore.setState({ currentChannel: { id: 'a', name: 'Sports', streamUrl: '/a', guideId: 'g' } })
    useTVStore.setState({ selectedChannel: movies })
    renderHeader({ isMobile: true })

    fireEvent.click(screen.getByRole('button', { name: /Live now: Sports/ }))
    expect(useTVStore.getState().selectedChannel).toMatchObject({ type: 'live', name: 'Sports' })
  })

  it('reports the connection and reconnects from it', () => {
    vi.useFakeTimers()
    const props = renderHeader({ status: 'disconnected' })
    act(() => { vi.advanceTimersByTime(3000) })
    expect(screen.getByRole('status')).toHaveTextContent('Chat offline')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(props.onReconnect).toHaveBeenCalledTimes(1)
  })

  it('has no NHL scores toggle while the server has them off', () => {
    useSettingsStore.setState({ serverFeatures: { chat: false, gif: false, nhl: false } })
    renderHeader()

    expect(screen.getByRole('button', { name: 'Guide' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'NHL scores' })).not.toBeInTheDocument()
  })

  it('toggles the guide and NHL scores on desktop', () => {
    renderHeader()

    const guide = screen.getByRole('button', { name: 'Guide' })
    expect(guide).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(guide)
    expect(useUIStore.getState().isEPGVisible).toBe(false)
    expect(screen.getByRole('button', { name: 'Guide' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'NHL scores' }))
    expect(useUIStore.getState().isNHLOverlayVisible).toBe(true)
    expect(screen.getByRole('button', { name: 'NHL scores' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps the toggle names fixed and lets aria-pressed carry the state', async () => {
    renderHeader()
    const guide = screen.getByRole('button', { name: 'Guide', pressed: true })
    const nhl = screen.getByRole('button', { name: 'NHL scores', pressed: false })

    fireEvent.click(guide)
    fireEvent.click(nhl)
    // Same elements, same names; only the pressed state flips
    expect(guide).toHaveAccessibleName('Guide')
    expect(guide).toHaveAttribute('aria-pressed', 'false')
    expect(nhl).toHaveAccessibleName('NHL scores')
    expect(nhl).toHaveAttribute('aria-pressed', 'true')

    // The tooltip agrees with the name rather than naming an action
    await act(async () => {
      nhl.focus()
    })
    expect(await screen.findByRole('tooltip')).toHaveTextContent('NHL scores')
    expect(screen.queryByText(/Hide|Show/)).not.toBeInTheDocument()
  })

  it('asks the guide to take focus only when it is opened from the keyboard', () => {
    useUIStore.setState({ isEPGVisible: false, guideFocusRequested: false })
    renderHeader()

    // A pointer click counts its presses in detail
    fireEvent.click(screen.getByRole('button', { name: 'Guide' }), { detail: 1 })
    expect(useUIStore.getState()).toMatchObject({ isEPGVisible: true, guideFocusRequested: false })
    fireEvent.click(screen.getByRole('button', { name: 'Guide' }), { detail: 1 })

    // Enter, Space and a remote's OK click with detail 0
    fireEvent.click(screen.getByRole('button', { name: 'Guide' }), { detail: 0 })
    expect(useUIStore.getState()).toMatchObject({ isEPGVisible: true, guideFocusRequested: true })

    // Closing withdraws a request the guide hasn't taken up
    fireEvent.click(screen.getByRole('button', { name: 'Guide' }), { detail: 0 })
    expect(useUIStore.getState()).toMatchObject({ isEPGVisible: false, guideFocusRequested: false })
  })

  it('groups the actions in a Watch controls landmark, in order', () => {
    auth.isAdmin = true
    renderHeader()

    const nav = screen.getByRole('navigation', { name: 'Watch controls' })
    expect(within(nav).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Guide',
      'NHL scores',
      'Open admin panel',
      'Chat',
    ])
    // The account menu comes last and replaces the feedback icon and settings popover
    expect(within(nav).getByTestId('account-menu')).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: 'Chat' }).compareDocumentPosition(
      within(nav).getByTestId('account-menu'),
    ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send feedback' })).not.toBeInTheDocument()
  })

  it('labels Guide and Chat from lg, with Chat as the one filled action', () => {
    renderHeader()

    const guide = screen.getByRole('button', { name: 'Guide' })
    expect(within(guide).getByText('Guide')).toHaveClass('hidden', 'lg:inline')
    expect(guide).toHaveAttribute('data-variant', 'toolbar')

    const chat = screen.getByRole('button', { name: 'Chat' })
    expect(within(chat).getByText('Chat')).toHaveClass('hidden', 'lg:inline')
    expect(chat).toHaveAttribute('data-variant', 'default')
  })

  it('shows the pressed toggles with the toolbar pressed style', () => {
    useUIStore.setState({ isEPGVisible: false, isNHLOverlayVisible: true })
    renderHeader()

    const guide = screen.getByRole('button', { name: 'Guide', pressed: false })
    const nhl = screen.getByRole('button', { name: 'NHL scores', pressed: true })
    for (const toggle of [guide, nhl]) {
      expect(toggle).toHaveClass('aria-pressed:bg-primary/15', 'aria-pressed:text-foreground')
    }
  })

  it('draws the NHL toggle as the word NHL, not the Arial shield', () => {
    renderHeader()
    const nhl = screen.getByRole('button', { name: 'NHL scores' })
    expect(nhl).toHaveTextContent('NHL')
    expect(nhl.querySelector('svg')).toBeNull()
    expect(within(nhl).getByText('NHL')).toHaveClass('size-[18px]', 'font-extrabold')
  })

  it('leaves the guide and NHL toggles out on a phone', () => {
    renderHeader({ isMobile: true })
    expect(screen.queryByRole('button', { name: /guide/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /NHL scores/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Chat' })).toBeVisible()
  })

  it('keeps Host, Chat and the account menu on a phone, all 44px', () => {
    auth.isAdmin = true
    renderHeader({ isMobile: true })

    const nav = screen.getByRole('navigation', { name: 'Watch controls' })
    const actions = within(nav).getAllByRole('button')
    expect(actions.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Open admin panel',
      'Chat',
    ])
    for (const action of actions) expect(action).toHaveClass('size-11', 'pointer-fine:md:size-9')
    expect(within(nav).getByTestId('account-menu')).toBeInTheDocument()
    // The menu carries NHL scores on a phone
    expect(accountMenu.props?.isMobile).toBe(true)
    // Tighter gaps so the 44px targets leave room for the title
    expect(nav).toHaveClass('gap-1', 'md:gap-2')
  })

  describe("who's here facepile", () => {
    const person = (displayName: string, userId: string): PresenceEntry => ({
      userId, displayName, channelId: null, channelName: null, programme: null, view: null, since: null,
    })

    beforeEach(() => {
      useChatStore.setState({ nickname: null, me: { username: 'jonike', userId: 'u_me' } })
    })

    afterEach(() => {
      usePresenceStore.setState({ entries: [] })
    })

    it('sits immediately left of Chat with the others here', () => {
      usePresenceStore.setState({
        entries: [person('jonike', 'u_me'), person('maya', 'u_maya'), person('dev', 'u_dev'), person('sam', 'u_sam')],
      })
      renderHeader()

      const nav = screen.getByRole('navigation', { name: 'Watch controls' })
      const buttons = within(nav).getAllByRole('button')
      expect(buttons.at(-2)).toHaveAccessibleName('3 here')
      expect(buttons.at(-1)).toHaveAccessibleName('Chat')

      const facepile = within(nav).getByRole('button', { name: '3 here' })
      expect(facepile).toHaveAttribute('aria-haspopup', 'dialog')
      const stack = facepile.querySelector('[data-slot="presence-stack"]')!
      expect(Array.from(stack.children).map((a) => a.textContent)).toEqual(['M', 'D', 'S'])
      expect(within(facepile).getByText('3 here')).not.toHaveClass('sr-only')
    })

    it('opens the Here-now list', () => {
      usePresenceStore.setState({ entries: [person('maya', 'u_maya')] })
      renderHeader()
      fireEvent.click(screen.getByRole('button', { name: '1 here' }))
      expect(screen.getByRole('region', { name: 'Here now' })).toHaveTextContent('maya')
    })

    it('is absent while nobody else is here', () => {
      usePresenceStore.setState({ entries: [person('jonike', 'u_me')] })
      renderHeader()
      const nav = screen.getByRole('navigation', { name: 'Watch controls' })
      expect(within(nav).queryByRole('button', { name: /here$/ })).not.toBeInTheDocument()
      expect(within(nav).getAllByRole('button').at(-1)).toHaveAccessibleName('Chat')
    })

    it('draws the avatars only on a phone, in a 44px target named by the count', () => {
      usePresenceStore.setState({ entries: [person('maya', 'u_maya'), person('dev', 'u_dev'), person('sam', 'u_sam')] })
      renderHeader({ isMobile: true })

      const facepile = screen.getByRole('button', { name: '3 here' })
      expect(facepile).toHaveClass('h-11')
      expect(within(facepile).getByText('3 here')).toHaveClass('sr-only')
      // Two avatars and '+1' fit beside Chat's badge
      const stack = facepile.querySelector('[data-slot="presence-stack"]')!
      expect(Array.from(stack.children).map((a) => a.textContent)).toEqual(['M', 'D', '+1'])
      expect(facepile.compareDocumentPosition(screen.getByRole('button', { name: 'Chat' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })
  })

  it('keeps the Live TV switcher one tap away for a permitted viewer on a phone', () => {
    appSettings.userChannelSelection = true
    const props = renderHeader({ isMobile: true })

    const changeLive = screen.getByRole('button', { name: 'Change live channel' })
    expect(changeLive).toHaveClass('size-11')
    fireEvent.click(changeLive)
    expect(props.onOpenChannelPicker).toHaveBeenCalledTimes(1)
  })

  it('has no top-level Refresh: Reload stream lives in the account menu and the player', () => {
    const props = renderHeader()
    expect(screen.queryByRole('button', { name: /Refresh|Reload/ })).not.toBeInTheDocument()
    expect(accountMenu.props?.onReload).toBe(props.onReload)
  })

  it('gives an admin the admin panel and no separate Change live button', () => {
    auth.isAdmin = true
    appSettings.userChannelSelection = true
    const props = renderHeader()

    fireEvent.click(screen.getByRole('button', { name: 'Open admin panel' }))
    expect(props.onOpenAdmin).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Change live channel' })).not.toBeInTheDocument()
  })

  it("labels the admin button 'Host' from lg and gives it a tooltip", async () => {
    auth.isAdmin = true
    renderHeader()

    const host = screen.getByRole('button', { name: 'Open admin panel' })
    expect(within(host).getByText('Host')).toHaveClass('hidden', 'lg:inline')

    await act(async () => {
      host.focus()
    })
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Open admin panel')
  })

  it('gives a viewer Change live only when the admin allows it', () => {
    const props = renderHeader()
    expect(screen.queryByRole('button', { name: 'Change live channel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open admin panel' })).not.toBeInTheDocument()
    cleanup()

    appSettings.userChannelSelection = true
    const allowed = renderHeader()
    const changeLive = screen.getByRole('button', { name: 'Change live channel' })
    expect(within(changeLive).getByText('Change live')).toHaveClass('hidden', 'lg:inline')
    fireEvent.click(changeLive)
    expect(allowed.onOpenChannelPicker).toHaveBeenCalledTimes(1)
    expect(props.onOpenChannelPicker).not.toHaveBeenCalled()
  })

  it('gives any other viewer Suggest, which opens the switcher, while chat is on', () => {
    const props = renderHeader()

    const suggest = screen.getByRole('button', { name: 'Suggest a channel' })
    expect(within(suggest).getByText('Suggest')).toHaveClass('hidden', 'lg:inline')
    fireEvent.click(suggest)
    expect(props.onOpenChannelPicker).toHaveBeenCalledTimes(1)
  })

  it('has no Suggest while chat is off, nor for anyone who can change live TV', () => {
    chatFlag.enabled = false
    renderHeader()
    expect(screen.queryByRole('button', { name: 'Suggest a channel' })).not.toBeInTheDocument()
    cleanup()

    chatFlag.enabled = true
    appSettings.userChannelSelection = true
    renderHeader()
    expect(screen.queryByRole('button', { name: 'Suggest a channel' })).not.toBeInTheDocument()
    cleanup()

    appSettings.userChannelSelection = false
    auth.isAdmin = true
    renderHeader()
    expect(screen.queryByRole('button', { name: 'Suggest a channel' })).not.toBeInTheDocument()
  })

  it("keeps chat, and wires the account menu to the header's switcher, admin and reload", () => {
    const props = renderHeader()
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }))
    expect(useChatStore.getState().isOpen).toBe(true)

    expect(screen.getByTestId('account-menu')).toBeInTheDocument()
    expect(accountMenu.props).toEqual({
      onOpenChannelPicker: props.onOpenChannelPicker,
      onOpenAdmin: props.onOpenAdmin,
      onReload: props.onReload,
      isMobile: false,
    })
  })
})
