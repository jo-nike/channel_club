import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act } from '@/test/utils'
import { TVHeader } from './TVHeader'
import { useTVStore } from '@/stores/tvStore'
import { useUIStore } from '@/stores/uiStore'
import { useChannelStore } from '@/stores/channelStore'
import { useChatStore } from '@/stores/chatStore'

const auth = vi.hoisted(() => ({ isAdmin: false }))
const appSettings = vi.hoisted(() => ({ userChannelSelection: false }))
const accountMenu = vi.hoisted(() => ({
  props: undefined as
    | undefined
    | { onOpenChannelPicker: () => void; onOpenAdmin: () => void; onReload: () => void; isMobile: boolean },
}))

vi.mock('@/services/api', () => ({ fetchNowPlaying: vi.fn(() => new Promise(() => {})) }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => appSettings }))
vi.mock('@/hooks/useChatEnabled', () => ({ useChatEnabled: () => true }))
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
  appSettings.userChannelSelection = false
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

  it('toggles the guide and NHL scores on desktop', () => {
    renderHeader()

    const guide = screen.getByRole('button', { name: 'Hide guide' })
    expect(guide).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(guide)
    expect(useUIStore.getState().isEPGVisible).toBe(false)
    expect(screen.getByRole('button', { name: 'Show guide' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'NHL Scores' }))
    expect(useUIStore.getState().isNHLOverlayVisible).toBe(true)
    expect(screen.getByRole('button', { name: 'Hide NHL Scores' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('asks the guide to take focus only when it is opened from the keyboard', () => {
    useUIStore.setState({ isEPGVisible: false, guideFocusRequested: false })
    renderHeader()

    // A pointer click counts its presses in detail
    fireEvent.click(screen.getByRole('button', { name: 'Show guide' }), { detail: 1 })
    expect(useUIStore.getState()).toMatchObject({ isEPGVisible: true, guideFocusRequested: false })
    fireEvent.click(screen.getByRole('button', { name: 'Hide guide' }), { detail: 1 })

    // Enter, Space and a remote's OK click with detail 0
    fireEvent.click(screen.getByRole('button', { name: 'Show guide' }), { detail: 0 })
    expect(useUIStore.getState()).toMatchObject({ isEPGVisible: true, guideFocusRequested: true })

    // Closing withdraws a request the guide hasn't taken up
    fireEvent.click(screen.getByRole('button', { name: 'Hide guide' }), { detail: 0 })
    expect(useUIStore.getState()).toMatchObject({ isEPGVisible: false, guideFocusRequested: false })
  })

  it('groups the actions in a Watch controls landmark, in order', () => {
    auth.isAdmin = true
    renderHeader()

    const nav = screen.getByRole('navigation', { name: 'Watch controls' })
    expect(within(nav).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Hide guide',
      'NHL Scores',
      'Open admin panel',
      'Open chat',
    ])
    // The account menu comes last and replaces the feedback icon and settings popover
    expect(within(nav).getByTestId('account-menu')).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: 'Open chat' }).compareDocumentPosition(
      within(nav).getByTestId('account-menu'),
    ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send feedback' })).not.toBeInTheDocument()
  })

  it('labels Guide and Chat from lg, with Chat as the one filled action', () => {
    renderHeader()

    const guide = screen.getByRole('button', { name: 'Hide guide' })
    expect(within(guide).getByText('Guide')).toHaveClass('hidden', 'lg:inline')
    expect(guide).toHaveAttribute('data-variant', 'toolbar')

    const chat = screen.getByRole('button', { name: 'Open chat' })
    expect(within(chat).getByText('Chat')).toHaveClass('hidden', 'lg:inline')
    expect(chat).toHaveAttribute('data-variant', 'default')
  })

  it('shows the pressed toggles with the toolbar pressed style', () => {
    useUIStore.setState({ isEPGVisible: false, isNHLOverlayVisible: true })
    renderHeader()

    const guide = screen.getByRole('button', { name: 'Show guide', pressed: false })
    const nhl = screen.getByRole('button', { name: 'Hide NHL Scores', pressed: true })
    for (const toggle of [guide, nhl]) {
      expect(toggle).toHaveClass('aria-pressed:bg-primary/15', 'aria-pressed:text-primary')
    }
  })

  it('draws the NHL toggle as the word NHL, not the Arial shield', () => {
    renderHeader()
    const nhl = screen.getByRole('button', { name: 'NHL Scores' })
    expect(nhl).toHaveTextContent('NHL')
    expect(nhl.querySelector('svg')).toBeNull()
    expect(within(nhl).getByText('NHL')).toHaveClass('size-[18px]', 'font-extrabold')
  })

  it('leaves the guide and NHL toggles out on a phone', () => {
    renderHeader({ isMobile: true })
    expect(screen.queryByRole('button', { name: /guide/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /NHL Scores/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open chat' })).toBeVisible()
  })

  it('keeps Host, Chat and the account menu on a phone, all 44px', () => {
    auth.isAdmin = true
    renderHeader({ isMobile: true })

    const nav = screen.getByRole('navigation', { name: 'Watch controls' })
    const actions = within(nav).getAllByRole('button')
    expect(actions.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Open admin panel',
      'Open chat',
    ])
    for (const action of actions) expect(action).toHaveClass('size-11', 'md:size-9')
    expect(within(nav).getByTestId('account-menu')).toBeInTheDocument()
    // The menu carries NHL scores on a phone
    expect(accountMenu.props?.isMobile).toBe(true)
    // Tighter gaps so the 44px targets leave room for the title
    expect(nav).toHaveClass('gap-1', 'md:gap-2')
  })

  it('keeps the live channel picker one tap away for a permitted viewer on a phone', () => {
    appSettings.userChannelSelection = true
    const props = renderHeader({ isMobile: true })

    const picker = screen.getByRole('button', { name: 'Change live channel' })
    expect(picker).toHaveClass('size-11')
    fireEvent.click(picker)
    expect(props.onOpenChannelPicker).toHaveBeenCalledTimes(1)
  })

  it('has no top-level Refresh: Reload stream lives in the account menu and the player', () => {
    const props = renderHeader()
    expect(screen.queryByRole('button', { name: /Refresh|Reload/ })).not.toBeInTheDocument()
    expect(accountMenu.props?.onReload).toBe(props.onReload)
  })

  it('gives an admin the admin panel and no separate live picker', () => {
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

  it('gives a viewer the live picker only when the admin allows it', () => {
    const props = renderHeader()
    expect(screen.queryByRole('button', { name: 'Change live channel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open admin panel' })).not.toBeInTheDocument()
    cleanup()

    appSettings.userChannelSelection = true
    const allowed = renderHeader()
    const picker = screen.getByRole('button', { name: 'Change live channel' })
    expect(within(picker).getByText('Change live')).toHaveClass('hidden', 'lg:inline')
    fireEvent.click(picker)
    expect(allowed.onOpenChannelPicker).toHaveBeenCalledTimes(1)
    expect(props.onOpenChannelPicker).not.toHaveBeenCalled()
  })

  it("keeps chat, and wires the account menu to the header's picker, admin and reload", () => {
    const props = renderHeader()
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))
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
