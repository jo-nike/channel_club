import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@/test/utils'
import { PlayerInfoOverlay } from './PlayerInfoOverlay'
import { PlayerShellContext, type PlayerShell } from './PlayerShellContext'
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

  it("says 'Live · no guide info' when the live channel has no guide data, never 'Now broadcasting'", () => {
    renderOverlay(liveSlot())

    expect(rail()).toHaveTextContent('Live · no guide info')
    expect(rail()).not.toHaveTextContent(/broadcasting/i)
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
    renderOverlay(cinema, { isTheaterMode: true })

    expect(queryRail()).not.toBeInTheDocument()
  })
})

describe('PlayerInfoOverlay: showing and hiding with the controls', () => {
  it('shows with the control bar and hides with it', () => {
    const { update } = renderOverlay(cinema, { controlsVisible: true })
    expect(rail()).toHaveClass('opacity-100')
    expect(nhlToggle()).toHaveAttribute('tabindex', '0')

    update(cinema, { controlsVisible: false })

    expect(rail()).toHaveClass('opacity-0')
    // Out of the tab order while it can't be seen
    expect(nhlToggle()).toHaveAttribute('tabindex', '-1')
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

  it('moves the ticker under the rail while the rail is up, and back to the top when it hides', () => {
    useUIStore.setState({ isNHLOverlayVisible: true })
    const { update } = renderOverlay(cinema, { controlsVisible: true })
    expect(ticker()).toHaveClass(TICKER_BELOW_RAIL)

    update(cinema, { controlsVisible: false })
    expect(ticker()).toHaveClass('top-0')

    act(() => useUIStore.getState().toggleNHLOverlay())
    expect(ticker()).not.toBeInTheDocument()
  })
})
