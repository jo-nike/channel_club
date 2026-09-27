import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act } from '@/test/utils'
import { TVHeader } from './TVHeader'
import { useTVStore } from '@/stores/tvStore'
import { useUIStore } from '@/stores/uiStore'
import { useChannelStore } from '@/stores/channelStore'
import { useChatStore } from '@/stores/chatStore'

const auth = vi.hoisted(() => ({ isAdmin: false, logout: () => {} }))
const appSettings = vi.hoisted(() => ({ userChannelSelection: false }))
const settingsMenu = vi.hoisted(() => ({ onLogout: undefined as undefined | (() => void) }))

vi.mock('@/services/api', () => ({ fetchNowPlaying: vi.fn(() => new Promise(() => {})) }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => appSettings }))
vi.mock('@/hooks/useChatEnabled', () => ({ useChatEnabled: () => true }))
vi.mock('@/components/FeedbackButton', () => ({ FeedbackButton: () => <div data-testid="feedback" /> }))
vi.mock('@/components/UserSettingsMenu', () => ({ UserSettingsMenu: ({ onLogout }: { onLogout: () => void }) => {
  settingsMenu.onLogout = onLogout
  return <div data-testid="settings-menu" />
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
  auth.logout = vi.fn()
  appSettings.userChannelSelection = false
  settingsMenu.onLogout = undefined
  useChannelStore.setState({ currentChannel: null })
  useTVStore.setState({ selectedChannel: null, liveEPG: null })
  useUIStore.setState({ isEPGVisible: true, isNHLOverlayVisible: false })
  useChatStore.setState({ isOpen: false, unreadCount: 0 })
})

afterEach(() => cleanup())

describe('TVHeader', () => {
  it('is the page banner, padded below the status bar', () => {
    renderHeader()
    expect(screen.getByRole('banner')).toHaveClass('pt-header-safe', 'pb-2')
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
    renderHeader({ status: 'disconnected' })
    const block = within(screen.getByRole('banner')).getByTestId('now-watching')
    expect(within(block).getByText('Big Game')).toHaveClass('truncate')
    // The connection status stays to the left of the block
    const reconnect = screen.getByRole('button', { name: 'Reconnect' })
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
    const props = renderHeader({ status: 'disconnected' })
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
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

  it('groups the actions in a Watch controls landmark, in order', () => {
    auth.isAdmin = true
    renderHeader()

    const nav = screen.getByRole('navigation', { name: 'Watch controls' })
    expect(within(nav).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Hide guide',
      'NHL Scores',
      'Open admin panel',
      'Open chat',
      'Refresh video',
    ])
    expect(within(nav).getByTestId('feedback')).toBeInTheDocument()
    expect(within(nav).getByTestId('settings-menu')).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Refresh video' })).toBeVisible()
  })

  it('reloads the video from Refresh video', () => {
    const props = renderHeader()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh video' }))
    expect(props.onReload).toHaveBeenCalledTimes(1)
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

  it('keeps feedback, chat and the settings menu, which signs out through auth', () => {
    renderHeader()
    expect(screen.getByTestId('feedback')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))
    expect(useChatStore.getState().isOpen).toBe(true)
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
    expect(settingsMenu.onLogout).toBe(auth.logout)
  })
})
