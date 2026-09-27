import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@/test/utils'
import { PlayerInfoOverlay } from './PlayerInfoOverlay'
import { PlayerShellContext, type PlayerShell } from './PlayerShellContext'
import { useAuthStore } from '@/stores/authStore'
import { useChannelStore } from '@/stores/channelStore'
import { useChatStore } from '@/stores/chatStore'
import { usePresenceStore } from '@/stores/presenceStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore } from '@/stores/tvStore'
import { useUIStore } from '@/stores/uiStore'
import type { PresenceEntry, UnifiedChannel } from '@/types'

// The ticker's scores: a day with no games, so nothing is fetched
vi.mock('@/hooks/useNHLScores', () => ({
  useNHLScores: () => ({
    data: { games: [], date: '2026-09-27', liveGameCount: 0 },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

const NOW = new Date('2026-09-27T20:00:00Z')

const cinema: UnifiedChannel = {
  id: 'e7',
  name: 'Cinema',
  number: 7,
  streamUrl: '',
  type: 'ersatztv',
  logoUrl: '/api/ersatztv/logos/e7',
}
const liveSlot = (name = 'TSN 5', streamUrl = 'https://fixture/tsn5'): UnifiedChannel => ({
  id: 'live-channel-0',
  name,
  number: 0,
  streamUrl,
  type: 'live',
})

const makeShell = (overrides: Partial<PlayerShell> = {}): PlayerShell => ({
  containerRef: { current: null },
  isFullscreen: false,
  toggleFullscreen: vi.fn(),
  isTheaterMode: false,
  toggleTheaterMode: vi.fn(),
  controlsVisible: true,
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

const renderOverlay = (channel: UnifiedChannel | null, shell: Partial<PlayerShell> = {}) => {
  const view = render(
    <PlayerShellContext value={makeShell(shell)}>
      <PlayerInfoOverlay channel={channel} />
    </PlayerShellContext>
  )
  return {
    ...view,
    update: (next: UnifiedChannel | null, nextShell: Partial<PlayerShell> = shell) =>
      view.rerender(
        <PlayerShellContext value={makeShell(nextShell)}>
          <PlayerInfoOverlay channel={next} />
        </PlayerShellContext>
      ),
  }
}

const rail = () => screen.getByTestId('player-info-rail')
const queryRail = () => screen.queryByTestId('player-info-rail')
const nhlToggle = () => screen.getByRole('button', { name: 'NHL scores' })
const ticker = () => screen.queryByRole('region', { name: 'NHL scores' })
const TICKER_BELOW_RAIL = 'top-[calc(3.75rem+var(--player-inset-top,0px))]'
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })
// Every tune shows the rail for 4s, including the first
const waitOutTuneBanner = () => advance(4000)

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  useErsatztvStore.setState({
    programmesByChannel: {
      e7: [
        {
          id: 'p1',
          channelId: 'e7',
          title: 'The Two Towers',
          start: '2026-09-27T19:00:00Z',
          stop: '2026-09-27T20:32:00Z',
        },
      ],
    },
  })
  useTVStore.setState({ liveEPG: null, liveEPGStatus: 'empty' })
  useChannelStore.setState({
    currentChannel: { id: '55', name: 'TSN 5', streamUrl: 'https://fixture/tsn5', guideId: 'tsn5.ca' },
    lastChange: null,
  })
  useUIStore.setState({ isNHLOverlayVisible: false, hideMyActivity: false })
  useAuthStore.setState({ username: 'maya' })
  useSettingsStore.setState({ presenceVisible: false })
  usePresenceStore.setState({ entries: [] })
  useChatStore.setState({ nickname: null, me: null })
})

// Stores are reset before each test, not after: the overlay is still mounted
// when afterEach runs, and would re-render outside act()
afterEach(() => {
  vi.useRealTimers()
})

describe('PlayerInfoOverlay: what the rail says', () => {
  it("shows an ErsatzTV channel's number, logo, name, programme and time left, with no LIVE pill", () => {
    renderOverlay(cinema)

    expect(rail()).toHaveTextContent('7')
    expect(rail()).toHaveTextContent('Cinema')
    expect(rail()).toHaveTextContent('The Two Towers · 32m left')
    expect(rail().querySelector('[data-testid="channel-logo"] img')).toHaveAttribute(
      'src',
      '/api/ersatztv/logos/e7'
    )
    expect(screen.queryByText('Live')).not.toBeInTheDocument()
  })

  it("marks the club's live channel with a LIVE pill and shows its guide programme", () => {
    useTVStore.setState({
      liveEPG: {
        channelId: '55',
        currentProgram: {
          title: 'CFL Football',
          startTime: '2026-09-27T19:00:00Z',
          endTime: '2026-09-27T21:05:00Z',
        },
      },
      liveEPGStatus: 'ok',
    })
    renderOverlay(liveSlot())

    expect(rail()).toHaveTextContent('0')
    expect(rail()).toHaveTextContent('TSN 5')
    expect(screen.getByText('Live')).toHaveClass('bg-live')
    expect(screen.getByText('Live')).toBe(screen.getByTestId('live-pill'))
    expect(rail()).toHaveTextContent('CFL Football · 1h 5m left')
  })

  it("takes the live slot's logo from the live channel", () => {
    useChannelStore.setState({
      currentChannel: {
        id: '55',
        name: 'TSN 5',
        streamUrl: 'https://fixture/tsn5',
        guideId: 'tsn5.ca',
        logoUrl: '/api/channels/logos/9',
      },
    })
    renderOverlay(liveSlot())

    expect(rail().querySelector('[data-testid="channel-logo"] img')).toHaveAttribute(
      'src',
      '/api/channels/logos/9'
    )
  })

  it.each([
    ['empty', 'No guide info'],
    ['unavailable', 'Guide unavailable'],
    ['loading', 'Loading guide...'],
    ['idle', 'Loading guide...'],
  ] as const)(
    "says why the live channel has no programme when the guide is %s, as the header does, never 'Now broadcasting'",
    (liveEPGStatus, text) => {
      useTVStore.setState({ liveEPG: null, liveEPGStatus })
      renderOverlay(liveSlot())

      expect(rail()).toHaveTextContent(text)
      expect(rail()).not.toHaveTextContent(/broadcasting/i)
    }
  )

  it('follows the guide from loading to unavailable', () => {
    useTVStore.setState({ liveEPG: null, liveEPGStatus: 'loading' })
    renderOverlay(liveSlot())
    expect(rail()).toHaveTextContent('Loading guide...')

    act(() => useTVStore.setState({ liveEPGStatus: 'unavailable' }))

    expect(rail()).toHaveTextContent('Guide unavailable')
    expect(rail()).not.toHaveTextContent('Loading guide...')
  })

  it('says there is no guide info for an ErsatzTV channel with a gap in its schedule', () => {
    useErsatztvStore.setState({ programmesByChannel: {} })
    renderOverlay(cinema)

    expect(rail()).toHaveTextContent('No guide info')
    expect(screen.queryByText('Live')).not.toBeInTheDocument()
  })

  it('shows no LIVE pill on the live slot while nothing is on', () => {
    useChannelStore.setState({ currentChannel: null })
    renderOverlay(liveSlot('Live', ''))

    expect(rail()).toHaveTextContent('Nothing on yet')
    expect(screen.queryByText('Live', { selector: 'span.bg-live' })).not.toBeInTheDocument()
  })

  it('has no rail before a channel is selected, but keeps the NHL ticker', () => {
    useUIStore.setState({ isNHLOverlayVisible: true })
    renderOverlay(null)

    expect(queryRail()).not.toBeInTheDocument()
    expect(ticker()).toHaveClass('top-0')
  })

  it('leaves TV theater to its own channel banner', () => {
    localStorage.setItem('tv-mode', 'true')
    const setInfoRailVisible = vi.fn()
    renderOverlay(cinema, { isTheaterMode: true, setInfoRailVisible })

    expect(queryRail()).not.toBeInTheDocument()
    // Nothing up there for the sound-off pill to move under
    expect(setInfoRailVisible).toHaveBeenLastCalledWith(false)
  })
})

describe('PlayerInfoOverlay: showing and hiding with the controls', () => {
  it('shows with the control bar and hides with it', () => {
    const { update } = renderOverlay(cinema, { controlsVisible: true })
    waitOutTuneBanner()
    expect(rail()).toHaveClass('opacity-100')
    expect(nhlToggle()).toHaveAttribute('tabindex', '0')

    update(cinema, { controlsVisible: false })

    expect(rail()).toHaveClass('opacity-0')
    // Out of the tab order while it can't be seen
    expect(nhlToggle()).toHaveAttribute('tabindex', '-1')
  })

  it('tells the shell whether it is up, so the sound-off pill can move under it', () => {
    const setInfoRailVisible = vi.fn()
    const { update } = renderOverlay(cinema, { controlsVisible: false, setInfoRailVisible })
    // The tune banner
    expect(setInfoRailVisible).toHaveBeenLastCalledWith(true)

    waitOutTuneBanner()
    expect(setInfoRailVisible).toHaveBeenLastCalledWith(false)

    update(cinema, { controlsVisible: true, setInfoRailVisible })
    expect(setInfoRailVisible).toHaveBeenLastCalledWith(true)
  })

  it('keeps the controls up while the pointer is over its buttons', () => {
    const setHoveringControls = vi.fn()
    renderOverlay(cinema, { setHoveringControls })

    fireEvent.mouseEnter(nhlToggle().parentElement as HTMLElement)
    expect(setHoveringControls).toHaveBeenLastCalledWith(true)

    fireEvent.mouseLeave(nhlToggle().parentElement as HTMLElement)
    expect(setHoveringControls).toHaveBeenLastCalledWith(false)
  })

  // The 96px strip above the phone's composer has room for the control bar only
  it('leaves the rail out while the player is a strip, and brings it back after', () => {
    const setInfoRailVisible = vi.fn()
    const { update } = renderOverlay(cinema, { controlsVisible: true, isStrip: true, setInfoRailVisible })

    expect(queryRail()).not.toBeInTheDocument()
    expect(screen.queryByText('Cinema')).not.toBeInTheDocument()
    expect(screen.queryByText(/The Two Towers/)).not.toBeInTheDocument()
    // So the sound-off pill keeps its usual place
    expect(setInfoRailVisible).toHaveBeenLastCalledWith(false)

    update(cinema, { controlsVisible: true, isStrip: false, setInfoRailVisible })

    expect(rail()).toHaveClass('opacity-100')
    expect(setInfoRailVisible).toHaveBeenLastCalledWith(true)
  })
})

describe('PlayerInfoOverlay: channel banner on every tune', () => {
  const hidden = { controlsVisible: false }
  const channel2: UnifiedChannel = { ...cinema, id: 'e2', name: 'Cartoons', number: 2, logoUrl: undefined }

  it('shows the rail for 4s after the first tune, with the controls hidden', () => {
    renderOverlay(cinema, hidden)
    expect(rail()).toHaveClass('opacity-100')
    expect(nhlToggle()).toHaveAttribute('tabindex', '0')

    advance(3999)
    expect(rail()).toHaveClass('opacity-100')

    advance(1)
    expect(rail()).toHaveClass('opacity-0')
    expect(nhlToggle()).toHaveAttribute('tabindex', '-1')
  })

  it('shows it again for 4s when the channel changes', () => {
    const { update } = renderOverlay(cinema, hidden)
    waitOutTuneBanner()
    expect(rail()).toHaveClass('opacity-0')

    update(channel2, hidden)
    expect(rail()).toHaveClass('opacity-100')
    expect(rail()).toHaveTextContent('Cartoons')

    waitOutTuneBanner()
    expect(rail()).toHaveClass('opacity-0')

    // Back to the first channel is a tune too
    update(cinema, hidden)
    expect(rail()).toHaveClass('opacity-100')
  })

  it('a tune during the banner gets its own full 4s', () => {
    const { update } = renderOverlay(cinema, hidden)
    advance(3000)

    update(channel2, hidden)
    advance(3999)
    expect(rail()).toHaveClass('opacity-100')

    advance(1)
    expect(rail()).toHaveClass('opacity-0')
  })

  it('a reload or stream retry on the same channel is not a tune', () => {
    const { update } = renderOverlay(cinema, { ...hidden, reloadKey: 0 })
    waitOutTuneBanner()

    update(cinema, { ...hidden, reloadKey: 1 })
    // The page hands over a fresh channel object on a refresh; the id is the same
    update({ ...cinema }, { ...hidden, reloadKey: 2 })

    expect(rail()).toHaveClass('opacity-0')
  })

  it('moves the NHL ticker under the rail while the banner is up', () => {
    useUIStore.setState({ isNHLOverlayVisible: true })
    renderOverlay(cinema, hidden)
    expect(ticker()).toHaveClass(TICKER_BELOW_RAIL)

    waitOutTuneBanner()
    expect(ticker()).toHaveClass('top-0')
  })
})

describe('PlayerInfoOverlay: shared live-channel changes', () => {
  const hidden = { controlsVisible: false }
  const status = () => screen.getByRole('status')
  // What useWebSocket does with a channel_update
  const liveChangedTo = (channelName: string | null, by: string | null) =>
    act(() => {
      useChannelStore.setState({
        currentChannel: channelName
          ? { id: channelName, name: channelName, streamUrl: `https://fixture/${channelName}`, guideId: '' }
          : null,
      })
      useChannelStore.getState().setLastChange({ by, at: Date.now(), channelName })
    })

  it('says the live channel changed and who changed it, for 5s, as a status', () => {
    const { update } = renderOverlay(liveSlot('TSN 5'), hidden)
    waitOutTuneBanner()
    expect(status()).toBeEmptyDOMElement()
    // Empty but still rendered: a display:none region isn't announced
    expect(status()).not.toHaveClass('hidden')
    expect(status()).not.toHaveClass('empty:hidden')
    expect(rail()).toHaveClass('opacity-0')

    liveChangedTo('Sportsnet One', 'jon')
    update(liveSlot('Sportsnet One', 'https://fixture/sn1'), hidden)

    expect(status()).toHaveTextContent('jon put on Sportsnet One')
    // The whole rail comes up with it, showing the new channel
    expect(rail()).toHaveClass('opacity-100')
    expect(rail()).toHaveTextContent('Sportsnet One')

    advance(4999)
    expect(status()).toHaveTextContent('jon put on Sportsnet One')

    advance(1)
    expect(status()).toBeEmptyDOMElement()
    expect(rail()).toHaveClass('opacity-0')
    // The programme line is back
    expect(rail()).toHaveTextContent('No guide info')
  })

  it('names nobody for a system change', () => {
    renderOverlay(liveSlot(), hidden)

    liveChangedTo('TSN 3', null)

    expect(status()).toHaveTextContent(/^Live channel set to TSN 3$/)
  })

  it('a second change restarts the 5s', () => {
    renderOverlay(liveSlot(), hidden)
    liveChangedTo('TSN 3', 'jon')
    advance(3000)

    liveChangedTo('TSN 4', 'dev')
    expect(status()).toHaveTextContent('dev put on TSN 4')

    advance(4999)
    expect(status()).toHaveTextContent('dev put on TSN 4')
    advance(1)
    expect(status()).toBeEmptyDOMElement()
  })

  it("doesn't announce your own change", () => {
    renderOverlay(liveSlot(), hidden)

    liveChangedTo('TSN 3', 'maya')

    expect(status()).toBeEmptyDOMElement()
  })

  it('stopping live TV ends the announcement; the player says who stopped it', () => {
    renderOverlay(liveSlot(), hidden)
    liveChangedTo('TSN 3', 'jon')

    liveChangedTo(null, 'jon')

    expect(status()).toBeEmptyDOMElement()
  })

  it('is absent on channels 1-36, which get the toast instead', () => {
    renderOverlay(cinema, hidden)

    liveChangedTo('TSN 3', 'jon')

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(rail()).not.toHaveTextContent(/put on/)
  })

  it('does not announce a change made before tuning to channel 0', () => {
    const { update } = renderOverlay(cinema, hidden)
    liveChangedTo('TSN 3', 'jon')

    update(liveSlot('TSN 3'), hidden)

    expect(status()).toBeEmptyDOMElement()
  })

  it('leaving channel 0 drops the announcement', () => {
    const { update } = renderOverlay(liveSlot(), hidden)
    liveChangedTo('TSN 3', 'jon')

    update(cinema, hidden)
    update(liveSlot('TSN 3'), hidden)

    expect(status()).toBeEmptyDOMElement()
  })
})

describe('PlayerInfoOverlay: NHL ticker', () => {
  it('the NHL button opens and closes the ticker, so it is reachable without the header', () => {
    renderOverlay(cinema)
    expect(nhlToggle()).toHaveAttribute('aria-pressed', 'false')
    expect(ticker()).not.toBeInTheDocument()

    fireEvent.click(nhlToggle())
    expect(useUIStore.getState().isNHLOverlayVisible).toBe(true)
    expect(ticker()).toBeInTheDocument()
    // Same name on and off; only the pressed state flips
    expect(nhlToggle()).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(nhlToggle())
    expect(useUIStore.getState().isNHLOverlayVisible).toBe(false)
    expect(ticker()).not.toBeInTheDocument()
  })

  it('the NHL button names its key, N, in its tooltip and to assistive technology', () => {
    renderOverlay(cinema)

    fireEvent.focus(nhlToggle())

    expect(screen.getByRole('tooltip')).toHaveTextContent('NHL scores (N)')
    expect(nhlToggle()).toHaveAttribute('aria-keyshortcuts', 'N')
    // The key is a hint, not part of the button's name
    expect(nhlToggle()).toHaveAccessibleName('NHL scores')
  })

  it('moves the ticker under the rail while the rail is up, and back to the top when it hides', () => {
    useUIStore.setState({ isNHLOverlayVisible: true })
    const { update } = renderOverlay(cinema, { controlsVisible: true })
    waitOutTuneBanner()
    expect(ticker()).toHaveClass(TICKER_BELOW_RAIL)

    update(cinema, { controlsVisible: false })
    expect(ticker()).toHaveClass('top-0')

    act(() => useUIStore.getState().toggleNHLOverlay())
    expect(ticker()).not.toBeInTheDocument()
  })
})

describe('PlayerInfoOverlay: channel keys preview', () => {
  const hidden = { controlsVisible: false }
  const channel2: UnifiedChannel = { ...cinema, id: 'e2', name: 'Cartoons', number: 2, logoUrl: undefined }

  const renderWithPending = (channel: UnifiedChannel | null, pending: UnifiedChannel | null) => {
    const view = render(
      <PlayerShellContext value={makeShell(hidden)}>
        <PlayerInfoOverlay channel={channel} pending={pending} />
      </PlayerShellContext>
    )
    return {
      ...view,
      update: (nextChannel: UnifiedChannel | null, nextPending: UnifiedChannel | null) =>
        view.rerender(
          <PlayerShellContext value={makeShell(hidden)}>
            <PlayerInfoOverlay channel={nextChannel} pending={nextPending} />
          </PlayerShellContext>
        ),
    }
  }

  it('shows the channel being stepped to at once, with the controls hidden, before it is tuned', () => {
    const { update } = renderWithPending(cinema, null)
    waitOutTuneBanner()
    expect(rail()).toHaveClass('opacity-0')

    update(cinema, channel2)

    expect(rail()).toHaveClass('opacity-100')
    expect(rail()).toHaveTextContent('2')
    expect(rail()).toHaveTextContent('Cartoons')
    expect(rail()).not.toHaveTextContent('Cinema')
  })

  it("shows what is on the previewed channel, not the playing one's programme", () => {
    renderWithPending(liveSlot('TSN 5'), cinema)

    expect(rail()).toHaveTextContent('Cinema')
    expect(rail()).toHaveTextContent('The Two Towers · 32m left')
  })

  it('stays up for the whole preview, then hands over to the tune banner', () => {
    const { update } = renderWithPending(cinema, null)
    waitOutTuneBanner()

    update(cinema, channel2)
    advance(10_000)
    expect(rail()).toHaveClass('opacity-100')

    // The tune lands as the preview ends: the new channel gets its 4s
    update(channel2, null)
    expect(rail()).toHaveTextContent('Cartoons')
    advance(3999)
    expect(rail()).toHaveClass('opacity-100')
    advance(1)
    expect(rail()).toHaveClass('opacity-0')
  })

  it('stepping back to the playing channel ends the preview without a tune banner', () => {
    const { update } = renderWithPending(cinema, null)
    waitOutTuneBanner()

    update(cinema, channel2)
    update(cinema, null)

    expect(rail()).toHaveTextContent('Cinema')
    expect(rail()).toHaveClass('opacity-0')
  })

  it('shows a preview before the player has a channel', () => {
    renderWithPending(null, channel2)

    expect(rail()).toHaveTextContent('Cartoons')
  })
})

describe('PlayerInfoOverlay: typing a channel number', () => {
  const hidden = { controlsVisible: false }
  const renderEntry = (props: { pending?: UnifiedChannel | null; entry?: string | null; missing?: string | null }) =>
    render(
      <PlayerShellContext value={makeShell(hidden)}>
        <PlayerInfoOverlay channel={cinema} {...props} />
      </PlayerShellContext>
    )

  it('shows the channel the digits match so far', () => {
    renderEntry({ entry: '2', pending: { ...cinema, id: 'e2', name: 'Cartoons', number: 2 } })

    expect(rail()).toHaveClass('opacity-100')
    expect(rail()).toHaveTextContent('Cartoons')
  })

  it('shows just the digits while they match no channel', () => {
    renderEntry({ entry: '99' })

    expect(rail()).toHaveClass('opacity-100')
    expect(rail()).toHaveTextContent('99')
    expect(rail()).not.toHaveTextContent('Cinema')
    expect(rail()).not.toHaveTextContent('No channel')
  })

  it("says 'No channel 99' once an unknown number is entered, over hidden controls", () => {
    renderEntry({ missing: '99' })

    expect(rail()).toHaveClass('opacity-100')
    expect(screen.getByRole('status')).toHaveTextContent('No channel 99')
  })

  it('leaves TV theater to its own channel banner', () => {
    localStorage.setItem('tv-mode', 'true')
    render(
      <PlayerShellContext value={makeShell({ isTheaterMode: true })}>
        <PlayerInfoOverlay channel={cinema} missing="99" />
      </PlayerShellContext>
    )

    expect(queryRail()).not.toBeInTheDocument()
  })
})

describe('PlayerInfoOverlay: behind live', () => {
  const behind = () => ({ jumpToLive: vi.fn() })
  const jumpButton = () => screen.queryByRole('button', { name: 'Behind live Jump to live' })

  it("puts 'Behind live · Jump to live' in the LIVE pill's place on the club channel", () => {
    renderOverlay(liveSlot(), { behindLive: behind() })

    expect(jumpButton()).toBeInTheDocument()
    expect(rail()).toHaveTextContent('Behind live · Jump to live')
    expect(screen.queryByTestId('live-pill')).not.toBeInTheDocument()
  })

  it('never claims to be in sync with the group', () => {
    renderOverlay(liveSlot(), { behindLive: behind() })

    expect(rail()).not.toHaveTextContent(/group|friends|everyone|sync/i)
  })

  it('shows the LIVE pill again once back at the edge', () => {
    const { update } = renderOverlay(liveSlot(), { behindLive: behind() })

    update(liveSlot(), { behindLive: null })

    expect(jumpButton()).not.toBeInTheDocument()
    expect(screen.getByTestId('live-pill')).toBeInTheDocument()
  })

  it('shows on an ErsatzTV channel too, which has no LIVE pill', () => {
    renderOverlay(cinema, { behindLive: behind() })

    expect(jumpButton()).toBeInTheDocument()
  })

  it("jumps with the engine's own jump", () => {
    const behindLive = behind()
    renderOverlay(liveSlot(), { behindLive })

    const button = jumpButton()
    if (!button) throw new Error('no Jump to live button')
    fireEvent.click(button)

    expect(behindLive.jumpToLive).toHaveBeenCalledTimes(1)
  })

  it('can be clicked and tabbed to only while the rail shows, and keeps the controls up while hovered', () => {
    const setHoveringControls = vi.fn()
    const { update } = renderOverlay(liveSlot(), { behindLive: behind(), setHoveringControls })
    const button = () => {
      const element = jumpButton()
      if (!element) throw new Error('no Jump to live button')
      return element
    }
    expect(button()).toHaveAttribute('tabindex', '0')
    expect(button()).toHaveClass('pointer-events-auto', 'video-controls')

    fireEvent.mouseEnter(button())
    expect(setHoveringControls).toHaveBeenLastCalledWith(true)
    fireEvent.mouseLeave(button())
    expect(setHoveringControls).toHaveBeenLastCalledWith(false)

    waitOutTuneBanner()
    update(liveSlot(), { behindLive: behind(), setHoveringControls, controlsVisible: false })

    expect(rail()).toHaveClass('opacity-0')
    expect(button()).toHaveAttribute('tabindex', '-1')
    expect(button()).not.toHaveClass('pointer-events-auto')
  })

  it('is about the channel playing, not one being previewed with the channel keys', () => {
    render(
      <PlayerShellContext value={makeShell({ behindLive: behind() })}>
        <PlayerInfoOverlay channel={liveSlot()} pending={cinema} />
      </PlayerShellContext>
    )

    expect(rail()).toHaveTextContent('Cinema')
    expect(jumpButton()).not.toBeInTheDocument()
  })
})

describe('PlayerInfoOverlay: pausing the shared live channel', () => {
  const HINT = "You'll fall behind the group"
  const liveStatus = () => screen.getByRole('status')

  it('hints that pausing puts the viewer behind the group, in the live status line', () => {
    renderOverlay(liveSlot(), { isLivePaused: true })

    expect(liveStatus()).toHaveTextContent(HINT)
  })

  it('shows the hint once: gone on play, and not for the next pause', () => {
    const { update } = renderOverlay(liveSlot(), { isLivePaused: false })
    expect(rail()).not.toHaveTextContent(HINT)

    update(liveSlot(), { isLivePaused: true })
    expect(liveStatus()).toHaveTextContent(HINT)

    update(liveSlot(), { isLivePaused: false })
    expect(rail()).not.toHaveTextContent(HINT)

    update(liveSlot(), { isLivePaused: true })
    expect(rail()).not.toHaveTextContent(HINT)
  })

  it('gives way to a live-channel change announcement', () => {
    renderOverlay(liveSlot(), { isLivePaused: true })
    expect(liveStatus()).toHaveTextContent(HINT)

    act(() => useChannelStore.getState().setLastChange({ by: 'jon', at: Date.now(), channelName: 'TSN 5' }))

    expect(liveStatus()).toHaveTextContent('jon put on TSN 5')
    expect(liveStatus()).not.toHaveTextContent(HINT)
  })

  it('is only about the shared live channel', () => {
    renderOverlay(cinema, { isLivePaused: true })

    expect(rail()).not.toHaveTextContent(HINT)
  })

  it('waits while a channel is previewed with the channel keys', () => {
    const view = render(
      <PlayerShellContext value={makeShell({ isLivePaused: true })}>
        <PlayerInfoOverlay channel={liveSlot()} pending={cinema} />
      </PlayerShellContext>
    )
    expect(rail()).not.toHaveTextContent(HINT)

    view.rerender(
      <PlayerShellContext value={makeShell({ isLivePaused: true })}>
        <PlayerInfoOverlay channel={liveSlot()} />
      </PlayerShellContext>
    )

    expect(liveStatus()).toHaveTextContent(HINT)
  })
})

describe("PlayerInfoOverlay: who's on this channel", () => {
  const person = (displayName: string, overrides: Partial<PresenceEntry> = {}): PresenceEntry => ({
    userId: `u_${displayName}`,
    displayName,
    channelId: 'e7',
    channelName: 'Cinema',
    programme: 'The Two Towers',
    view: 'ersatztv',
    since: null,
    ...overrides,
  })
  const onLive = (displayName: string) => person(displayName, { channelId: '55', channelName: 'TSN 5', view: 'live' })
  const watchingWith = () => screen.queryByRole('img', { name: /^Watching with/ })

  beforeEach(() => {
    useChatStore.setState({ me: { username: 'maya', userId: 'u_maya' } })
    useSettingsStore.setState({ presenceVisible: true })
  })

  it('shows the faces of the others on this channel, named for screen readers', () => {
    usePresenceStore.setState({ entries: [person('maya'), person('dev'), person('sam'), onLive('lee')] })
    renderOverlay(cinema)

    const stack = watchingWith()
    expect(stack).toHaveAccessibleName('Watching with dev and sam')
    expect(rail()).toContainElement(stack)
    // You, and someone on another channel, are not in it
    expect(stack?.querySelectorAll('[data-slot="presence-stack"] > *')).toHaveLength(2)
  })

  it("follows the live slot's viewers on channel 0", () => {
    usePresenceStore.setState({ entries: [onLive('lee'), person('dev')] })
    renderOverlay(liveSlot())

    expect(watchingWith()).toHaveAccessibleName('Watching with lee')
  })

  it('shows nobody while the admin keeps what everyone watches private', () => {
    useSettingsStore.setState({ presenceVisible: false })
    usePresenceStore.setState({ entries: [person('dev')] })
    renderOverlay(cinema)

    expect(rail()).toBeInTheDocument()
    expect(watchingWith()).not.toBeInTheDocument()
  })

  it('shows nobody to a viewer hiding their own', () => {
    useUIStore.setState({ hideMyActivity: true })
    usePresenceStore.setState({ entries: [person('dev')] })
    renderOverlay(cinema)

    expect(watchingWith()).not.toBeInTheDocument()
  })

  it('never shows someone who hides what they watch', () => {
    // Hidden people come without a channel
    usePresenceStore.setState({
      entries: [person('dev'), person('sam', { channelId: null, channelName: null, programme: null, view: null })],
    })
    renderOverlay(cinema)

    expect(watchingWith()).toHaveAccessibleName('Watching with dev')
  })

  it('is left out when nobody else is on the channel', () => {
    usePresenceStore.setState({ entries: [person('maya'), onLive('lee')] })
    renderOverlay(cinema)

    expect(watchingWith()).not.toBeInTheDocument()
  })
})
