import { act, fireEvent, render, renderHook, screen } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { CouchView } from './CouchView'
import { useChannelStore } from '@/stores/channelStore'
import { useTVStore } from '@/stores/tvStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { usePresenceStore } from '@/stores/presenceStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useChatStore } from '@/stores/chatStore'
import type { ErsatzTVChannel, PresenceEntry, UnifiedChannel } from '@/types'
import type { ChannelZap } from '@/hooks/useChannelZap'
import { useTVMode } from '@/hooks/useTVMode'

const player = vi.hoisted(() => ({
  props: null as null | { isTheaterMode: boolean; onFocusSearch?: () => void; onPickLive?: () => void },
}))
// The real shell's channel keys, so keys the couch leaves alone reach the
// page's zap as they do in the app
vi.mock('@/components/tv/DualModeVideoPlayer', async () => {
  const { useVideoKeyboardShortcuts } = await import('@/hooks/useVideoKeyboardShortcuts')
  return { DualModeVideoPlayer: (props: { channel: UnifiedChannel | null; zap?: ChannelZap; isTheaterMode: boolean; onFocusSearch?: () => void; onPickLive?: () => void }) => {
    player.props = props
    const { zap } = props
    useVideoKeyboardShortcuts({
      containerRef: { current: null },
      onChannelStep: zap?.step,
      onLastChannel: zap?.tuneLast,
      onDigit: zap?.digit,
      onDigitCommit: zap?.commitDigits,
    })
    // An ErsatzTV channel has no URL of its own, so the mock names it by id
    return <div data-testid="player">{props.channel?.type === 'ersatztv' ? `/${props.channel.id}` : props.channel?.streamUrl || 'No live broadcast'}</div>
  } }
})
// The real account menu, with the hooks it reads stubbed
const auth = vi.hoisted(() => ({ username: 'jon', isAdmin: true, logout: (() => {}) as () => void }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => ({ userChannelSelection: false }) }))
vi.mock('@/hooks/useFeedbackFeature', () => ({ useFeedbackFeature: () => ({ isEnabled: false, isLoading: false }) }))
vi.mock('@/hooks/useInstallPrompt', () => ({
  useInstallPrompt: () => ({ canInstall: false, shouldPromote: false, variant: 'native', install: () => Promise.resolve(false), dismiss: () => {} }),
}))
vi.mock('@/components/tv/TVHeader', () => ({ TVHeader: () => <header data-testid="tv-header" /> }))
vi.mock('@/components/tv/TVEPGGrid', () => ({ TVEPGGrid: () => <div data-testid="tv-epg-grid" /> }))

// Unified order: slot 0 (live), then ErsatzTV 1, 2 and 12
const ersatz: ErsatzTVChannel[] = [
  { id: 'e1', name: 'Movies', number: 1, streamUrl: '/e1', logoUrl: '', group: '' },
  { id: 'e2', name: 'Cartoons', number: 2, streamUrl: '/e2', logoUrl: '', group: '' },
  { id: 'e12', name: 'Westerns', number: 12, streamUrl: '/e12', logoUrl: '', group: '' },
]

type CouchViewProps = Parameters<typeof CouchView>[0]
function renderCouch(props: Partial<CouchViewProps> = {}) {
  return render(<CouchView onOpenChannelPicker={vi.fn()} onOpenAdmin={vi.fn()} {...props} />)
}

const selectedId = () => useTVStore.getState().selectedChannel?.id
const channel = (id: string) => useTVStore.getState().getUnifiedChannels().find((c) => c.id === id)!
const press = (key: string, init: { keyCode?: number } = {}, target: Element = document.body) =>
  fireEvent.keyDown(target, { key, ...init })

// Elements outside the view (a text field, a focusable button), removed after each test
const extras: Element[] = []
function addToPage<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  document.body.appendChild(element)
  extras.push(element)
  return element
}

function setFullscreenElement(element: Element | null) {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: element })
}

beforeEach(() => {
  vi.useFakeTimers()
  player.props = null
  useErsatztvStore.setState({ channels: ersatz })
  useChannelStore.getState().setCurrentChannel({ id: 'a', name: 'Sports', streamUrl: 'https://fixture/a', guideId: '' })
  useTVStore.setState({ selectedChannel: channel('e1'), previousChannelId: null })
})

afterEach(() => {
  vi.useRealTimers()
  extras.splice(0).forEach((element) => element.remove())
  setFullscreenElement(null)
  // jsdom has neither; tests that need them define their own
  Reflect.deleteProperty(document.documentElement, 'requestFullscreen')
  Reflect.deleteProperty(document, 'exitFullscreen')
  localStorage.removeItem('tv-mode')
})

describe('CouchView: layout', () => {
  it('renders only the player, filling the screen: no header and no guide grid', () => {
    renderCouch()

    expect(screen.getByTestId('player')).toHaveTextContent('/e1')
    expect(screen.queryByTestId('tv-header')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tv-epg-grid')).not.toBeInTheDocument()
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    expect(screen.getByTestId('player').closest('.couch-view')).toHaveClass('fixed', 'inset-0')
    // The player lays out as in theater, which the couch has no way to leave
    expect(player.props?.isTheaterMode).toBe(true)
  })

  it("offers the player no channel search, as a remote has no '/'", () => {
    renderCouch()

    expect(player.props?.onFocusSearch).toBeUndefined()
  })

  it('passes the live TV switcher to the player for the empty live slot', () => {
    const onPickLive = vi.fn()
    renderCouch({ onPickLive })

    expect(player.props?.onPickLive).toBe(onPickLive)
  })
})

describe('CouchView: zapping', () => {
  it('tunes to the next channel 700ms after ArrowUp', () => {
    renderCouch()

    press('ArrowUp')
    act(() => { vi.advanceTimersByTime(699) })
    expect(selectedId()).toBe('e1')

    act(() => { vi.advanceTimersByTime(1) })
    expect(selectedId()).toBe('e2')
    expect(screen.getByTestId('player')).toHaveTextContent('/e2')
  })

  it('tunes once to where a burst of presses lands, wrapping through slot 0', () => {
    renderCouch()
    const tune = vi.spyOn(useTVStore.getState(), 'selectChannel')

    press('ArrowDown') // wraps to 0
    press('ArrowDown') // wraps to 12
    press('PageUp', { keyCode: 33 }) // webOS CH+: 0
    press('ChannelUp') // 1
    press('Unidentified', { keyCode: 34 }) // webOS CH- with no key name: 0
    act(() => { vi.advanceTimersByTime(700) })

    expect(selectedId()).toBe('live-channel-0')
    expect(tune).toHaveBeenCalledTimes(1)
  })

  it('keeps zap keys from the player and page handlers', () => {
    renderCouch()
    const bubble = vi.fn()
    window.addEventListener('keydown', bubble)

    const notPrevented = press('ArrowDown')

    window.removeEventListener('keydown', bubble)
    expect(notPrevented).toBe(false)
    expect(bubble).not.toHaveBeenCalled()
  })

  it('ignores zap keys typed into an input', () => {
    renderCouch()
    const input = addToPage('input')

    const notPrevented = press('ArrowUp', {}, input)
    act(() => { vi.advanceTimersByTime(700) })

    expect(notPrevented).toBe(true)
    expect(selectedId()).toBe('e1')
  })

  it('hides the channel banner while the guide is open, so it never covers the guide', () => {
    renderCouch()
    const hint = '▲▼ change channel · 0-9 channel number · OK guide'
    expect(screen.getByText(hint)).toBeInTheDocument()

    press('Enter', { keyCode: 13 })

    expect(screen.getByRole('listbox', { name: 'Channels' })).toBeInTheDocument()
    expect(screen.queryByText(hint)).not.toBeInTheDocument()
  })

  it('shows a banner for the channel being zapped to, then hides it 3s after the last change', () => {
    renderCouch()
    const banner = screen.getByRole('status')
    // Opening the view shows the playing channel and the hint
    expect(banner).toHaveTextContent('CH 1 · Movies')
    expect(banner).toHaveTextContent('▲▼ change channel · 0-9 channel number · OK guide')

    act(() => { vi.advanceTimersByTime(2000) })
    press('ArrowUp')
    expect(banner).toHaveTextContent('CH 2 · Cartoons')

    act(() => { vi.advanceTimersByTime(2999) })
    expect(banner).toHaveTextContent('CH 2 · Cartoons')
    act(() => { vi.advanceTimersByTime(1) })
    expect(banner).toBeEmptyDOMElement()
  })

  it('names who changed the live channel in the banner, on channel 0', () => {
    useTVStore.setState({ selectedChannel: channel('live-channel-0') })
    renderCouch()

    act(() => {
      useChannelStore.getState().setCurrentChannel({ id: 'tsn5', name: 'TSN 5', streamUrl: 'https://fixture/tsn5' })
      useChannelStore.getState().setLastChange({ by: 'jon', at: Date.now(), channelName: 'TSN 5' })
    })

    expect(screen.getByRole('status')).toHaveTextContent('jon put on TSN 5')
  })

  it('announces no live change on other channels, which get the toast', () => {
    renderCouch()

    act(() => {
      useChannelStore.getState().setCurrentChannel({ id: 'tsn5', name: 'TSN 5', streamUrl: 'https://fixture/tsn5' })
      useChannelStore.getState().setLastChange({ by: 'jon', at: Date.now(), channelName: 'TSN 5' })
    })

    expect(screen.queryByText('jon put on TSN 5')).not.toBeInTheDocument()
  })
})

describe('CouchView: channel numbers', () => {
  it("tunes channel 12 1.5s after '1', '2'", () => {
    renderCouch()
    const banner = screen.getByRole('status')

    press('1', { keyCode: 49 })
    press('2', { keyCode: 50 })
    expect(banner).toHaveTextContent('CH 12 · Westerns')
    act(() => { vi.advanceTimersByTime(1499) })
    expect(selectedId()).toBe('e1')

    act(() => { vi.advanceTimersByTime(1) })
    expect(selectedId()).toBe('e12')
  })

  it('reads number keys a remote sends without a key name, number pad included', () => {
    renderCouch()

    press('Unidentified', { keyCode: 49 }) // 1
    press('Unidentified', { keyCode: 98 }) // number pad 2
    act(() => { vi.advanceTimersByTime(1500) })

    expect(selectedId()).toBe('e12')
  })

  it('tunes the number at once on OK, without going fullscreen', () => {
    const requestFullscreen = vi.fn(() => Promise.resolve())
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: requestFullscreen })
    renderCouch()

    press('2', { keyCode: 50 })
    const notPrevented = press('Enter', { keyCode: 13 })

    expect(notPrevented).toBe(false)
    expect(selectedId()).toBe('e2')
    expect(requestFullscreen).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('keeps digits from the player, which would read them a second time', () => {
    renderCouch()
    const bubble = vi.fn()
    window.addEventListener('keydown', bubble)

    const notPrevented = press('5', { keyCode: 53 })

    window.removeEventListener('keydown', bubble)
    expect(notPrevented).toBe(false)
    expect(bubble).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('CH 5')
  })

  it('leaves digits typed into an input to the input', () => {
    renderCouch()
    const input = addToPage('input')

    expect(press('1', { keyCode: 49 }, input)).toBe(true)
    act(() => { vi.advanceTimersByTime(1500) })
    expect(selectedId()).toBe('e1')
  })
})

describe('CouchView: OK and fullscreen', () => {
  let requestFullscreen: ReturnType<typeof vi.fn>

  beforeEach(() => {
    requestFullscreen = vi.fn(() => Promise.resolve())
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: requestFullscreen })
  })

  it('takes the page fullscreen on the first OK, a user gesture', () => {
    renderCouch()
    expect(requestFullscreen).not.toHaveBeenCalled()

    const notPrevented = press('Enter', { keyCode: 13 })

    expect(notPrevented).toBe(false)
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
    expect(requestFullscreen.mock.contexts[0]).toBe(document.documentElement)
  })

  it('reads a remote OK with no key name', () => {
    renderCouch()

    press('Unidentified', { keyCode: 13 })

    expect(requestFullscreen).toHaveBeenCalledTimes(1)
  })

  it('opens the guide without asking for fullscreen again once the page is fullscreen', () => {
    setFullscreenElement(document.documentElement)
    renderCouch()

    expect(press('Enter', { keyCode: 13 })).toBe(false)
    expect(screen.getByRole('listbox', { name: 'Channels' })).toBeInTheDocument()
    expect(requestFullscreen).not.toHaveBeenCalled()
  })

  it('opens the guide and goes fullscreen on OK on the idle live slot, also for someone who can pick', () => {
    useChannelStore.getState().setCurrentChannel(null)
    useTVStore.setState({ selectedChannel: channel('live-channel-0') })
    const onPickLive = vi.fn()
    renderCouch({ onPickLive })

    expect(press('Enter', { keyCode: 13 })).toBe(false)

    // The hints say OK opens the guide; the desktop live switcher isn't made for a remote
    expect(onPickLive).not.toHaveBeenCalled()
    expect(screen.getByRole('listbox', { name: 'Channels' })).toBeInTheDocument()
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
  })

  it('opens the guide on OK on channel 0 while something is live', () => {
    useTVStore.setState({ selectedChannel: channel('live-channel-0') })
    const onPickLive = vi.fn()
    renderCouch({ onPickLive })

    press('Enter', { keyCode: 13 })

    expect(onPickLive).not.toHaveBeenCalled()
    expect(screen.getByRole('listbox', { name: 'Channels' })).toBeInTheDocument()
  })

  it('opens the guide on OK on the idle live slot for someone not allowed to pick', () => {
    useChannelStore.getState().setCurrentChannel(null)
    useTVStore.setState({ selectedChannel: channel('live-channel-0') })
    renderCouch()

    press('Enter', { keyCode: 13 })

    expect(screen.getByRole('listbox', { name: 'Channels' })).toBeInTheDocument()
  })

  it('leaves OK on a focused button to the button', () => {
    renderCouch()
    const button = addToPage('button')
    button.focus()

    expect(press('Enter', { keyCode: 13 }, button)).toBe(true)
    expect(requestFullscreen).not.toHaveBeenCalled()
  })

  it('shrugs off a refused fullscreen request', async () => {
    requestFullscreen.mockReturnValue(Promise.reject(new TypeError('Permissions check failed')))
    renderCouch()

    press('Enter', { keyCode: 13 })
    await act(async () => {})

    expect(requestFullscreen).toHaveBeenCalledTimes(1)
  })
})

describe('CouchView: guide', () => {
  const guide = () => screen.queryByRole('listbox', { name: 'Channels' })
  const focusedRow = () => document.activeElement!
  const pressInGuide = (key: string, init: { keyCode?: number } = {}) => press(key, init, focusedRow())

  it('opens the now/next guide on OK, focused on the channel playing, with no guide grid', () => {
    renderCouch()
    expect(guide()).not.toBeInTheDocument()

    press('Enter', { keyCode: 13 })

    expect(guide()).toBeInTheDocument()
    expect(focusedRow()).toHaveAttribute('role', 'option')
    expect(focusedRow()).toHaveTextContent('Movies')
    expect(focusedRow()).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('tv-epg-grid')).not.toBeInTheDocument()
  })

  it.each([
    ['Guide', 'Guide', 0],
    ['Info', 'Info', 0],
    ['Tizen Guide', 'Unidentified', 458],
  ])('opens it on the remote %s key too', (_label, key, keyCode) => {
    renderCouch()

    expect(press(key, { keyCode })).toBe(false)

    expect(guide()).toBeInTheDocument()
  })

  it('moves through the guide with the arrows without zapping, and tunes on OK', () => {
    renderCouch()
    press('Enter', { keyCode: 13 })

    pressInGuide('ArrowDown')
    pressInGuide('ArrowDown')
    act(() => { vi.advanceTimersByTime(700) })
    expect(selectedId()).toBe('e1')
    expect(focusedRow()).toHaveTextContent('Westerns')

    pressInGuide('Enter', { keyCode: 13 })

    expect(selectedId()).toBe('e12')
    expect(guide()).not.toBeInTheDocument()
    expect(screen.getByTestId('player')).toHaveTextContent('/e12')
  })

  it('leaves digits alone while the guide is open', () => {
    renderCouch()
    press('Enter', { keyCode: 13 })

    pressInGuide('2', { keyCode: 50 })
    act(() => { vi.advanceTimersByTime(1500) })

    expect(selectedId()).toBe('e1')
    expect(guide()).toBeInTheDocument()
  })

  it('hides it on Back without leaving fullscreen, and a later OK opens it again', () => {
    const exitFullscreen = vi.fn(() => Promise.resolve())
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
    setFullscreenElement(document.documentElement)
    renderCouch()
    press('Enter', { keyCode: 13 })

    expect(pressInGuide('Unidentified', { keyCode: 461 })).toBe(false)

    expect(guide()).not.toBeInTheDocument()
    expect(exitFullscreen).not.toHaveBeenCalled()
    expect(selectedId()).toBe('e1')

    press('Enter', { keyCode: 13 })
    expect(guide()).toBeInTheDocument()
  })

  it('hides it when a pointer click takes focus elsewhere', () => {
    renderCouch()
    press('Enter', { keyCode: 13 })

    act(() => screen.getByRole('button', { name: 'Account menu' }).focus())

    expect(guide()).not.toBeInTheDocument()
  })
})

describe('CouchView: who is here', () => {
  const panel = () => screen.queryByRole('listbox', { name: 'Here now' })
  const focusedRow = () => document.activeElement!
  const green = (target: Element = document.body) => press('ColorF1Green', { keyCode: 404 }, target)
  const person = (overrides: Partial<PresenceEntry> & Pick<PresenceEntry, 'displayName'>): PresenceEntry => ({
    userId: null, channelId: null, channelName: null, programme: null, view: null, since: null, ...overrides,
  })
  const me = person({ userId: 'u_me', displayName: 'jonike', view: 'ersatztv', channelId: 'e1', channelName: 'Movies' })
  const sam = person({ userId: 'u_sam', displayName: 'sam', view: 'ersatztv', channelId: 'e2', channelName: 'Cartoons' })

  beforeEach(() => {
    useChatStore.setState({ nickname: null, me: { username: 'jonike', userId: 'u_me' } })
    usePresenceStore.setState({ entries: [me, sam] })
  })

  afterEach(() => {
    usePresenceStore.setState({ entries: [] })
    useSettingsStore.setState({ presenceVisible: false })
  })

  it("opens on the remote's green key and hides on it again, keeping the key from the page", () => {
    renderCouch()
    expect(panel()).not.toBeInTheDocument()
    const bubble = vi.fn()
    window.addEventListener('keydown', bubble)

    expect(green()).toBe(false)
    expect(panel()).toBeInTheDocument()
    expect(focusedRow()).toHaveAttribute('role', 'option')

    expect(green(focusedRow())).toBe(false)
    window.removeEventListener('keydown', bubble)
    expect(panel()).not.toBeInTheDocument()
    expect(bubble).not.toHaveBeenCalled()

    // A remote whose green key has no name
    press('Unidentified', { keyCode: 404 })
    expect(panel()).toBeInTheDocument()
  })

  it('shows names only while the admin keeps channels hidden, with nothing to join', () => {
    usePresenceStore.setState({ entries: [me, person({ userId: 'u_sam', displayName: 'sam' })] })
    renderCouch()

    green()
    press('Enter', { keyCode: 13 }, focusedRow())

    expect(panel()).toHaveTextContent('sam')
    expect(panel()).not.toHaveTextContent('Cartoons')
    expect(panel()).not.toHaveTextContent('Join')
    expect(selectedId()).toBe('e1')
  })

  it("joins a friend's channel on OK once the admin shows channels, and hides the panel", () => {
    useSettingsStore.setState({ presenceVisible: true })
    renderCouch()

    green()
    expect(panel()).toHaveTextContent('Cartoons')
    press('Enter', { keyCode: 13 }, focusedRow())

    expect(selectedId()).toBe('e2')
    expect(panel()).not.toBeInTheDocument()
    expect(screen.getByTestId('player')).toHaveTextContent('/e2')
  })

  it("says briefly that nobody else is here, and doesn't spring open when a friend arrives", () => {
    usePresenceStore.setState({ entries: [me] })
    renderCouch()

    green()
    expect(screen.getByText('Nobody else is here')).toBeInTheDocument()
    expect(panel()).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(3000))
    expect(screen.queryByText('Nobody else is here')).not.toBeInTheDocument()

    act(() => usePresenceStore.setState({ entries: [me, sam] }))
    expect(panel()).not.toBeInTheDocument()

    // Open again, it lists them
    green()
    expect(panel()).toHaveTextContent('sam')
  })

  it('opens and hides on W from a keyboard too, for testing with ?tv=1', () => {
    renderCouch()

    expect(press('w')).toBe(false)
    expect(panel()).toBeInTheDocument()

    expect(press('W', {}, focusedRow())).toBe(false)
    expect(panel()).not.toBeInTheDocument()
  })

  it("swaps the open guide for who's here on the green key, which the guide's hints name", () => {
    renderCouch()
    press('Guide')
    const guide = screen.getByRole('listbox', { name: 'Channels' })
    expect(screen.getByText('Green', { selector: 'kbd' }).parentElement).toHaveTextContent("Who's here")

    green(focusedRow())

    expect(guide).not.toBeInTheDocument()
    expect(panel()).toBeInTheDocument()
    expect(focusedRow()).toHaveTextContent('sam')
  })
})

describe('CouchView: pointer', () => {
  const view = () => screen.getByTestId('player').closest('.couch-view')!

  it('hides the pointer after 3s at rest, over the player controls too', () => {
    renderCouch()
    expect(view()).not.toHaveClass('cursor-none')

    act(() => { vi.advanceTimersByTime(2999) })
    expect(view()).not.toHaveClass('cursor-none')

    act(() => { vi.advanceTimersByTime(1) })
    expect(view()).toHaveClass('cursor-none', '[&_*]:cursor-none!')
  })

  it('shows it again when the Magic Remote pointer moves or clicks, and hides it 3s later', () => {
    renderCouch()
    act(() => { vi.advanceTimersByTime(3000) })

    fireEvent.mouseMove(window)
    expect(view()).not.toHaveClass('cursor-none')
    act(() => { vi.advanceTimersByTime(2000) })
    fireEvent.mouseDown(window)
    act(() => { vi.advanceTimersByTime(2999) })
    expect(view()).not.toHaveClass('cursor-none')

    act(() => { vi.advanceTimersByTime(1) })
    expect(view()).toHaveClass('cursor-none')
  })
})

describe('CouchView: account menu', () => {
  const avatar = () => screen.getByRole('button', { name: 'Account menu' })
  const corner = () => avatar().parentElement!

  function openMenu() {
    avatar().focus()
    press('Enter', { keyCode: 13 }, avatar())
    return screen.getByRole('menu')
  }

  it('offers the account menu in the top corner, inside the title-safe area', () => {
    renderCouch()

    expect(corner()).toHaveClass('absolute', 'right-(--couch-safe-x)', 'top-(--couch-safe-y)')
  })

  it('fades it with the idle pointer, and brings it back on a move or when focus reaches it', () => {
    renderCouch()
    expect(corner()).not.toHaveClass('opacity-0')

    act(() => { vi.advanceTimersByTime(3000) })
    expect(corner()).toHaveClass('opacity-0', 'has-[:focus-visible]:opacity-100')

    fireEvent.mouseMove(window)
    expect(corner()).not.toHaveClass('opacity-0')
  })

  it('keeps it on screen while its menu is open, which portals outside the corner', () => {
    renderCouch()
    act(() => { vi.advanceTimersByTime(3000) })
    // The open menu hides the rest of the page from the accessibility tree
    const button = avatar()
    const wrapper = corner()
    expect(wrapper.matches(':has([aria-expanded=true])')).toBe(false)

    openMenu()

    // jsdom applies no CSS: the class that wins over opacity-0 matches the open trigger
    expect(wrapper).toHaveClass('opacity-0', 'has-[[aria-expanded=true]]:opacity-100')
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(wrapper.matches(':has([aria-expanded=true])')).toBe(true)
  })

  it.each([
    ['Escape', 'Escape', 27],
    ['webOS Back', 'Unidentified', 461],
  ])('lets go of the avatar on %s after the menu closes, so the next OK opens the guide', (_label, key, keyCode) => {
    renderCouch()
    openMenu()
    press('Escape', { keyCode: 27 }, screen.getByRole('menu'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    // Radix hands focus back to the avatar, where OK would open the menu again
    act(() => avatar().focus())

    expect(press(key, { keyCode }, avatar())).toBe(false)
    expect(document.activeElement).toBe(document.body)

    press('Enter', { keyCode: 13 })
    expect(screen.getByRole('listbox', { name: 'Channels' })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens the menu on OK from the avatar, instead of going fullscreen', () => {
    const requestFullscreen = vi.fn(() => Promise.resolve())
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: requestFullscreen })
    renderCouch()

    expect(openMenu()).toBeInTheDocument()
    expect(requestFullscreen).not.toHaveBeenCalled()
  })

  it('turns the TV layout off from the couch, back to the page layout', () => {
    localStorage.setItem('tv-mode', 'true')
    const { result } = renderHook(() => useTVMode())
    renderCouch()
    expect(result.current).toBe(true)

    openMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Off' }))

    expect(localStorage.getItem('tv-mode')).toBe('false')
    expect(result.current).toBe(false)
  })

  it('reaches the admin panel and sign out', () => {
    auth.logout = vi.fn()
    const onOpenAdmin = vi.fn()
    renderCouch({ onOpenAdmin })

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Admin panel' }))
    expect(onOpenAdmin).toHaveBeenCalledTimes(1)

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(auth.logout).toHaveBeenCalledTimes(1)
  })
})

describe('CouchView: Back', () => {
  it.each([
    ['webOS Back', 'Unidentified', 461],
    ['Tizen Return', 'Unidentified', 10009],
    ['GoBack', 'GoBack', 0],
    ['Backspace', 'Backspace', 8],
  ])('%s leaves fullscreen and cancels the browser default', (_label, key, keyCode) => {
    const exitFullscreen = vi.fn(() => Promise.resolve())
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
    setFullscreenElement(document.documentElement)
    renderCouch()

    const notPrevented = press(key, { keyCode })

    expect(notPrevented).toBe(false)
    expect(exitFullscreen).toHaveBeenCalledTimes(1)
  })

  it('lets go of a focused button first, then leaves fullscreen on the next Back', () => {
    const exitFullscreen = vi.fn(() => Promise.resolve())
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
    setFullscreenElement(document.documentElement)
    renderCouch()
    const button = addToPage('button')
    button.focus()

    expect(press('Unidentified', { keyCode: 461 }, button)).toBe(false)
    expect(document.activeElement).toBe(document.body)
    expect(exitFullscreen).not.toHaveBeenCalled()

    expect(press('Unidentified', { keyCode: 461 })).toBe(false)
    expect(exitFullscreen).toHaveBeenCalledTimes(1)
  })

  it('leaves Back to the browser when nothing is fullscreen', () => {
    renderCouch()

    expect(press('Unidentified', { keyCode: 461 })).toBe(true)
  })

  it('leaves Backspace in an input to the input', () => {
    const exitFullscreen = vi.fn(() => Promise.resolve())
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
    setFullscreenElement(document.documentElement)
    renderCouch()
    const input = addToPage('input')

    expect(press('Backspace', { keyCode: 8 }, input)).toBe(true)
    expect(exitFullscreen).not.toHaveBeenCalled()
  })
})

describe('couch styles', () => {
  const css = readFileSync('src/index.css', 'utf8')
  /** The body of the rule whose selector is exactly `selector` */
  const rule = (selector: string) => {
    const at = css.indexOf(`\n${selector} {`)
    if (at === -1) return undefined
    const open = css.indexOf('{', at)
    return css.slice(open + 1, css.indexOf('}', open)).trim()
  }

  it('hides tooltips under html.couch', () => {
    expect(rule('.couch [data-slot="tooltip-content"]')).toBe('display: none;')
  })

  it('defines the safe area and the focus colour as .couch tokens, focus in the brand colour', () => {
    expect(rule('.couch')).toBe('--couch-safe-x: 5vw;\n  --couch-safe-y: 5vh;\n  --couch-focus: var(--primary);')
  })

  it('never changes the root font size, which would rescale every dialog', () => {
    const couchRules = [...css.matchAll(/^([^\n{}]*\.couch[^\n{}]*)\{([^}]*)\}/gm)]
    expect(couchRules.length).toBeGreaterThan(0)
    // Only the account menu's and the idle live slot's own rules size their text
    for (const [, selector, body] of couchRules) {
      if (
        !selector.startsWith('.couch [data-slot="dropdown-menu-content"] ') &&
        !selector.startsWith('.couch .couch-view .live-slot-idle ')
      ) {
        expect(body).not.toMatch(/font-size/)
      }
    }
  })

  it('sizes the portalled account menu for the couch, with focus shown by an outline, not colour alone', () => {
    const menu = '.couch [data-slot="dropdown-menu-content"]'
    expect(rule(menu)).toBe('min-width: 24rem;')
    expect(rule(`${menu} :is([role^="menuitem"], [data-slot="dropdown-menu-label"])`)).toBe('font-size: 1.5rem;\n  padding-block: 0.5rem;')
    expect(rule(`${menu} .text-xs`)).toBe('font-size: 1.125rem;')
    expect(rule(`${menu} [data-highlighted]`)).toBe('outline: 0.3125rem solid var(--couch-focus);\n  outline-offset: -0.3125rem;')
  })

  it('shows remote focus in the couch focus colour with a non-colour cue: a thick outline and a scale', () => {
    expect(rule('.couch .couch-view :focus-visible')).toBe('outline: 0.3125rem solid var(--couch-focus);\n  outline-offset: 0.1875rem;')
    expect(rule('.couch .couch-view :is(button, [role="button"]):focus-visible')).toBe('transform: scale(1.1);')
  })

  it('sizes the idle live slot for the TV and hides the pick button a remote cannot reach', () => {
    expect(rule('.couch .couch-view .live-slot-idle p')).toBe('font-size: 1.5rem;')
    expect(rule('.couch .couch-view .live-slot-idle button')).toBe('display: none;')
  })

  it('keeps the control bar inside the title-safe area', () => {
    expect(rule('.couch .couch-view .video-controls.px-3')).toContain('max(0.75rem, var(--couch-safe-x))')
    expect(rule('.couch .couch-view .video-controls.pb-2')).toBe('padding-bottom: max(0.5rem, var(--couch-safe-y));')
  })

  it('places the channel banner inside the title-safe area', () => {
    renderCouch()

    expect(screen.getByRole('status')).toHaveClass('left-(--couch-safe-x)', 'top-(--couch-safe-y)')
  })
})
