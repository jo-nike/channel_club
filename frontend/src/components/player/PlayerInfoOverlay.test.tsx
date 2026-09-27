import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@/test/utils'
import { PlayerInfoOverlay } from './PlayerInfoOverlay'
import { PlayerShellContext, type PlayerShell } from './PlayerShellContext'
import { useAuthStore } from '@/stores/authStore'
import { useChannelStore } from '@/stores/channelStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore } from '@/stores/tvStore'
import { useUIStore } from '@/stores/uiStore'
import type { UnifiedChannel } from '@/types'

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
const nhlToggle = () => screen.getByRole('button', { name: /NHL Scores/ })
const ticker = () => screen.queryByRole('dialog', { name: 'NHL' })
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
  useUIStore.setState({ isNHLOverlayVisible: false })
  useAuthStore.setState({ username: 'maya' })
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

    expect(status()).toHaveTextContent('Live changed to Sportsnet One by jon')
    // The whole rail comes up with it, showing the new channel
    expect(rail()).toHaveClass('opacity-100')
    expect(rail()).toHaveTextContent('Sportsnet One')

    advance(4999)
    expect(status()).toHaveTextContent('Live changed to Sportsnet One by jon')

    advance(1)
    expect(status()).toBeEmptyDOMElement()
    expect(rail()).toHaveClass('opacity-0')
    // The programme line is back
    expect(rail()).toHaveTextContent('No guide info')
  })

  it('names nobody for a system change', () => {
    renderOverlay(liveSlot(), hidden)

    liveChangedTo('TSN 3', null)

    expect(status()).toHaveTextContent(/^Live changed to TSN 3$/)
  })

  it('a second change restarts the 5s', () => {
    renderOverlay(liveSlot(), hidden)
    liveChangedTo('TSN 3', 'jon')
    advance(3000)

    liveChangedTo('TSN 4', 'dev')
    expect(status()).toHaveTextContent('Live changed to TSN 4 by dev')

    advance(4999)
    expect(status()).toHaveTextContent('Live changed to TSN 4 by dev')
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
    expect(rail()).not.toHaveTextContent(/Live changed/)
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
    expect(screen.getByRole('button', { name: 'Hide NHL Scores' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(nhlToggle())
    expect(useUIStore.getState().isNHLOverlayVisible).toBe(false)
    expect(ticker()).not.toBeInTheDocument()
  })

  it('the NHL button names its key, N, in its tooltip and to assistive technology', () => {
    renderOverlay(cinema)

    fireEvent.focus(nhlToggle())

    expect(screen.getByRole('tooltip')).toHaveTextContent('NHL Scores (N)')
    expect(nhlToggle()).toHaveAttribute('aria-keyshortcuts', 'N')
    // The key is a hint, not part of the button's name
    expect(nhlToggle()).toHaveAccessibleName('NHL Scores')
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
