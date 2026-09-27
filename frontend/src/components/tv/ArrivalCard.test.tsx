import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@/test/utils'
import { ArrivalCard, ARRIVAL_DISMISS_MS, ARRIVAL_SHOWN_KEY, UNDER_RAIL_MIN_PLAYER_HEIGHT } from './ArrivalCard'
import { PlayerShellContext, type PlayerShell } from '@/components/player/PlayerShellContext'
import { useAuthStore } from '@/stores/authStore'
import { useChannelStore } from '@/stores/channelStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore } from '@/stores/tvStore'
import { useUIStore } from '@/stores/uiStore'
import type { UnifiedChannel } from '@/types'

// The live stream needs MSE; iPhone Safari has none
const mpegtsSupport = vi.hoisted(() => ({ supported: true }))
vi.mock('mpegts.js', () => ({
  default: { isSupported: () => mpegtsSupport.supported },
}))

const cinema: UnifiedChannel = { id: 'e7', name: 'Cinema', number: 7, streamUrl: '', type: 'ersatztv' }
const liveSlot: UnifiedChannel = {
  id: 'live-channel-0',
  name: 'TSN 5',
  number: 0,
  streamUrl: 'https://fixture/tsn5',
  type: 'live',
}

const makeShell = (overrides: Partial<PlayerShell> = {}): PlayerShell => ({
  containerRef: { current: null },
  isFullscreen: false,
  toggleFullscreen: vi.fn(),
  isTheaterMode: false,
  toggleTheaterMode: vi.fn(),
  controlsVisible: false,
  setPlaying: vi.fn(),
  setHoveringControls: vi.fn(),
  isInfoRailVisible: false,
  setInfoRailVisible: vi.fn(),
  behindLive: null,
  setBehindLive: vi.fn(),
  isLivePaused: false,
  setLivePaused: vi.fn(),
  isAutoplayNoticeShown: false,
  setAutoplayNoticeShown: vi.fn(),
  reload: vi.fn(),
  reloadKey: 0,
  ...overrides,
})

const renderCard = (channel: UnifiedChannel | null = cinema, shell: Partial<PlayerShell> = {}) => {
  const view = render(
    <PlayerShellContext value={makeShell(shell)}>
      <ArrivalCard channel={channel} />
    </PlayerShellContext>
  )
  return {
    ...view,
    update: (next: UnifiedChannel | null, nextShell: Partial<PlayerShell> = shell) =>
      view.rerender(
        <PlayerShellContext value={makeShell(nextShell)}>
          <ArrivalCard channel={next} />
        </PlayerShellContext>
      ),
  }
}

const welcome = () => screen.queryByText(/^Welcome/)
const joinLive = () => screen.queryByRole('button', { name: 'Join live' })
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.useFakeTimers()
  mpegtsSupport.supported = true
  useAuthStore.setState({ username: 'maya' })
  useChannelStore.setState({
    currentChannel: { id: '55', name: 'TSN 5', streamUrl: 'https://fixture/tsn5', guideId: 'tsn5.ca' },
  })
  useErsatztvStore.setState({
    channels: [{ id: 'e7', name: 'Cinema', number: 7, streamUrl: '', logoUrl: '', group: '' }],
  })
  useTVStore.setState({ selectedChannel: cinema, previousChannelId: null })
  useUIStore.setState({
    hasSeenWelcome: false,
    isNHLOverlayVisible: false,
    isEPGVisible: false,
    guideFocusRequested: false,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ArrivalCard: first-run welcome', () => {
  it('greets the viewer by name and says what channel 0 is, as a status message', () => {
    renderCard()

    const card = screen.getByRole('status')
    expect(card).toHaveTextContent('Welcome, maya')
    expect(card).toHaveTextContent('Channel 0 is the club channel: whoever hosts picks it and everyone can join.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Browse channels' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('says just Welcome when there is no username', () => {
    useAuthStore.setState({ username: null })
    renderCard()

    expect(welcome()).toHaveTextContent(/^Welcome$/)
  })

  it('offers Join live only while live TV has something on and the viewer is elsewhere', () => {
    const { update } = renderCard()
    expect(joinLive()).toBeInTheDocument()

    update(liveSlot)
    expect(welcome()).toBeInTheDocument()
    expect(joinLive()).not.toBeInTheDocument()

    update(cinema)
    act(() => useChannelStore.setState({ currentChannel: null }))
    expect(welcome()).toBeInTheDocument()
    expect(joinLive()).not.toBeInTheDocument()
  })

  it("hides Join live where the browser can't play the live stream", () => {
    mpegtsSupport.supported = false
    renderCard()

    expect(welcome()).toBeInTheDocument()
    expect(joinLive()).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Browse channels' })).toBeInTheDocument()
  })

  it('Join live tunes to channel 0, closes and marks the welcome seen', () => {
    renderCard()

    fireEvent.click(joinLive()!)

    expect(useTVStore.getState().selectedChannel).toEqual(useTVStore.getState().getUnifiedChannels()[0])
    expect(useTVStore.getState().selectedChannel?.id).toBe('live-channel-0')
    expect(welcome()).not.toBeInTheDocument()
    expect(useUIStore.getState().hasSeenWelcome).toBe(true)
  })

  it('Browse channels opens the guide, closes and marks the welcome seen', () => {
    renderCard()

    // A mouse click (detail 1): the guide opens without taking focus
    fireEvent.click(screen.getByRole('button', { name: 'Browse channels' }), { detail: 1 })

    expect(useUIStore.getState().isEPGVisible).toBe(true)
    expect(useUIStore.getState().guideFocusRequested).toBe(false)
    expect(welcome()).not.toBeInTheDocument()
    expect(useUIStore.getState().hasSeenWelcome).toBe(true)
    expect(useTVStore.getState().selectedChannel).toBe(cinema)
  })

  it('Browse channels from the keyboard hands the guide focus', () => {
    renderCard()

    // Enter or Space on a button clicks with detail 0
    fireEvent.click(screen.getByRole('button', { name: 'Browse channels' }), { detail: 0 })

    expect(useUIStore.getState().isEPGVisible).toBe(true)
    expect(useUIStore.getState().guideFocusRequested).toBe(true)
  })

  it('the close button marks the welcome seen', () => {
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(welcome()).not.toBeInTheDocument()
    expect(useUIStore.getState().hasSeenWelcome).toBe(true)
  })

  it('closes itself after 12s without marking the welcome seen, so it comes back next session', () => {
    renderCard()

    advance(ARRIVAL_DISMISS_MS - 1)
    expect(welcome()).toBeInTheDocument()
    advance(1)
    expect(welcome()).not.toBeInTheDocument()
    expect(useUIStore.getState().hasSeenWelcome).toBe(false)
  })

  it('stays up while the pointer is on it, then gets a fresh 12s', () => {
    renderCard()
    const card = welcome()!.closest('.video-controls')!

    fireEvent.pointerEnter(card)
    advance(ARRIVAL_DISMISS_MS * 2)
    expect(welcome()).toBeInTheDocument()

    fireEvent.pointerLeave(card)
    advance(ARRIVAL_DISMISS_MS - 1)
    expect(welcome()).toBeInTheDocument()
    advance(1)
    expect(welcome()).not.toBeInTheDocument()
  })

  it('stays up while focus is in it', () => {
    renderCard()

    act(() => screen.getByRole('button', { name: 'Browse channels' }).focus())
    advance(ARRIVAL_DISMISS_MS * 2)

    expect(welcome()).toBeInTheDocument()
  })

  it('shows once per browser session', () => {
    const { unmount } = renderCard()
    expect(welcome()).toBeInTheDocument()
    expect(sessionStorage.getItem(ARRIVAL_SHOWN_KEY)).not.toBeNull()
    unmount()

    renderCard()
    expect(welcome()).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('is not shown once the welcome has been seen', () => {
    useUIStore.setState({ hasSeenWelcome: true })
    renderCard()

    expect(welcome()).not.toBeInTheDocument()
  })

  it('waits for the first tune, with its status region already there', () => {
    const { update } = renderCard(null)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(sessionStorage.getItem(ARRIVAL_SHOWN_KEY)).toBeNull()

    update(cinema)
    expect(screen.getByRole('status')).toHaveTextContent('Welcome, maya')
  })

  it('stays up across a channel change', () => {
    const { update } = renderCard()

    update({ ...cinema, id: 'e8', name: 'Kids', number: 8 })

    expect(welcome()).toBeInTheDocument()
  })
})

describe('ArrivalCard: placement', () => {
  const BELOW_RAIL = 'top-[calc(4.25rem+var(--player-inset-top,0px))]'
  const AT_TOP = 'top-[calc(1rem+var(--player-inset-top,0px))]'

  // The shell element, as tall as the player
  const playerOfHeight = (height: number): PlayerShell['containerRef'] => {
    const element = document.createElement('div')
    Object.defineProperty(element, 'clientHeight', { configurable: true, value: height })
    return { current: element }
  }
  // A desktop player, and a phone's 16:9 one in portrait
  const tallPlayer = playerOfHeight(432)
  const phonePlayer = playerOfHeight(211)

  it('sits at the top left, under the info rail while the rail is up on a player with room for it', () => {
    const { update } = renderCard(cinema, { containerRef: tallPlayer, isInfoRailVisible: false })
    const region = screen.getByRole('status')
    expect(region).toHaveClass(AT_TOP)
    expect(region).toHaveClass('left-[max(1rem,env(safe-area-inset-left))]')

    update(cinema, { containerRef: tallPlayer, isInfoRailVisible: true })
    expect(screen.getByRole('status')).toHaveClass(BELOW_RAIL)
    expect(screen.getByRole('status')).not.toHaveClass(AT_TOP)
    expect(welcome()).toBeInTheDocument()
  })

  it('fits under the rail from the minimum player height', () => {
    renderCard(cinema, { containerRef: playerOfHeight(UNDER_RAIL_MIN_PLAYER_HEIGHT), isInfoRailVisible: true })
    expect(welcome()).toBeInTheDocument()
  })

  it.each([
    ["a phone's", phonePlayer],
    ["a laptop's with the guide open", playerOfHeight(290)],
  ])('on a player too short for it under the rail (%s) stays over the rail, still usable', (_player, player) => {
    const { update } = renderCard(cinema, { containerRef: player, isInfoRailVisible: true })
    // Under the rail it would reach down over the control bar; hiding would
    // put it out of reach, since reaching for it raises the rail
    expect(screen.getByRole('status')).toHaveClass(AT_TOP)
    expect(screen.getByRole('status')).not.toHaveClass(BELOW_RAIL)
    expect(welcome()).toBeInTheDocument()

    update(cinema, { containerRef: player, isInfoRailVisible: false })
    expect(screen.getByRole('status')).toHaveClass(AT_TOP)
    expect(welcome()).toBeInTheDocument()

    update(cinema, { containerRef: player, isInfoRailVisible: true })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(welcome()).not.toBeInTheDocument()
    expect(useUIStore.getState().hasSeenWelcome).toBe(true)
  })

  it("waits while 'Sound is off' is up, which it would cover on a narrow player, then gets its full 12s", () => {
    const { update } = renderCard(cinema, { containerRef: tallPlayer, isAutoplayNoticeShown: true })
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(sessionStorage.getItem(ARRIVAL_SHOWN_KEY)).toBeNull()

    advance(ARRIVAL_DISMISS_MS * 2)
    update(cinema, { containerRef: tallPlayer, isAutoplayNoticeShown: false })
    expect(welcome()).toBeInTheDocument()

    advance(ARRIVAL_DISMISS_MS - 1)
    expect(welcome()).toBeInTheDocument()
    advance(1)
    expect(welcome()).not.toBeInTheDocument()
  })

  it('steps aside when the notice comes up over it, and comes back when it goes', () => {
    const { update } = renderCard(cinema, { containerRef: tallPlayer })
    expect(welcome()).toBeInTheDocument()

    update(cinema, { containerRef: tallPlayer, isAutoplayNoticeShown: true })
    expect(welcome()).not.toBeInTheDocument()

    update(cinema, { containerRef: tallPlayer, isAutoplayNoticeShown: false })
    expect(welcome()).toBeInTheDocument()
  })

  it('hides while the NHL ticker is open and comes back when it closes', () => {
    renderCard()
    expect(welcome()).toBeInTheDocument()

    act(() => useUIStore.setState({ isNHLOverlayVisible: true }))
    expect(welcome()).not.toBeInTheDocument()

    act(() => useUIStore.setState({ isNHLOverlayVisible: false }))
    expect(welcome()).toBeInTheDocument()
  })

  it('waits while the NHL ticker is open on arrival', () => {
    useUIStore.setState({ isNHLOverlayVisible: true })
    renderCard()
    expect(welcome()).not.toBeInTheDocument()
    expect(sessionStorage.getItem(ARRIVAL_SHOWN_KEY)).toBeNull()

    act(() => useUIStore.setState({ isNHLOverlayVisible: false }))
    expect(welcome()).toBeInTheDocument()
  })

  it('is never shown on the TV layout', () => {
    localStorage.setItem('tv-mode', 'true')
    renderCard()

    expect(welcome()).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
