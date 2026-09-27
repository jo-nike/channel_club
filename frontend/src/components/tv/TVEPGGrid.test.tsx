import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, cleanup, fireEvent, within } from '@/test/utils'
import { TVEPGGrid } from './TVEPGGrid'
import { focusOverrides } from '@/test/focus'
import { useChannelStore } from '@/stores/channelStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore, LIVE_CHANNEL_ID, toLiveProgramme } from '@/stores/tvStore'
import type { EPGResponse, ErsatzTVProgramme } from '@/types'

// Putting a channel on live TV starts guide and schedule lookups; leave them
// unanswered so each test sets the live guide state itself
vi.mock('@/services/api', () => ({
  fetchNowPlaying: vi.fn(() => new Promise(() => {})),
  fetchLiveProgrammes: vi.fn(() => new Promise(() => {})),
}))

const hour = 60 * 60 * 1000
const start = new Date(Date.now() - hour / 2).toISOString()
const stop = new Date(Date.now() + hour / 2).toISOString()

const liveEPG: EPGResponse = {
  channelId: 'live',
  currentProgram: { title: 'Club Broadcast', startTime: start, endTime: stop },
}

const programmesByChannel: Record<string, ErsatzTVProgramme[]> = {
  etv1: [{ id: 'p1', channelId: 'etv1', title: 'Movie Night', start, stop }],
}

describe('TVEPGGrid colours', () => {
  beforeEach(() => {
    useChannelStore.setState({
      currentChannel: { id: 'live', name: 'Club', streamUrl: 'http://x/live', guideId: 'g1' },
    })
    useErsatztvStore.setState({
      channels: [
        { id: 'etv1', name: 'Movies', streamUrl: '', logoUrl: '', number: 1, group: 'Films' },
      ],
    })
  })

  afterEach(() => {
    // Unmount before resetting the stores so the reset doesn't re-render
    cleanup()
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels: [] })
  })

  it('paints the ErsatzTV programme on now on the guide-now token with a border, not the accent', () => {
    render(<TVEPGGrid programmesByChannel={programmesByChannel} liveEPG={liveEPG} />)

    const block = screen.getByText('Movie Night').closest('button')
    expect(block).toHaveClass('bg-guide-now', 'text-foreground', 'border', 'border-border')
    expect(block).not.toHaveClass('bg-accent')
  })

  it('tints the live row with the live token and keeps its text on the foreground colour', () => {
    render(<TVEPGGrid programmesByChannel={programmesByChannel} liveEPG={liveEPG} />)

    const block = screen.getByText('Club Broadcast').closest('button')
    expect(block).toHaveClass('bg-live/15', 'border-live/40', 'text-foreground')
    expect(block).not.toHaveClass('text-destructive-foreground')

    const [liveRow] = screen.getAllByTestId('channel-row')
    expect(liveRow).toHaveClass('bg-live/5')
    const label = liveRow.querySelector('button')
    expect(label).toHaveClass('bg-live-surface')
    expect(label?.className).not.toMatch(/rose/)
  })

  it('insets the keyboard outline on channel labels and programme blocks so the guide does not clip it', () => {
    render(<TVEPGGrid programmesByChannel={programmesByChannel} liveEPG={liveEPG} />)

    const block = screen.getByText('Movie Night').closest('button')!
    const label = screen.getAllByTestId('channel-row')[1].querySelector('button')!
    for (const el of [block, label]) {
      expect(el).toHaveClass('focus-visible:-outline-offset-2')
      expect(focusOverrides(el)).toEqual([])
    }
  })
})

describe('TVEPGGrid live row without a programme', () => {
  beforeEach(() => {
    useChannelStore.setState({
      currentChannel: { id: 'live', name: 'Club', streamUrl: 'http://x/live', guideId: 'g1' },
    })
    useErsatztvStore.setState({ channels: [] })
  })

  afterEach(() => {
    cleanup()
    useChannelStore.setState({ currentChannel: null })
    useTVStore.setState({ liveEPGStatus: 'idle' })
  })

  it.each([
    ['unavailable', 'Guide unavailable'],
    ['empty', 'No guide info'],
  ] as const)('says the guide is %s instead of leaving the row blank', (liveEPGStatus, copy) => {
    useTVStore.setState({ liveEPGStatus })
    render(<TVEPGGrid programmesByChannel={{}} liveEPG={null} />)

    const [liveRow] = screen.getAllByTestId('channel-row')
    expect(liveRow).toHaveTextContent(copy)
  })

  it('draws the programme rather than the guide copy when there is one', () => {
    useTVStore.setState({ liveEPGStatus: 'ok' })
    render(<TVEPGGrid programmesByChannel={{}} liveEPG={liveEPG} />)

    const [liveRow] = screen.getAllByTestId('channel-row')
    expect(liveRow).toHaveTextContent('Club Broadcast')
    expect(liveRow).not.toHaveTextContent('No guide info')
  })
})

describe('TVEPGGrid live schedule', () => {
  // The grid starts at 19:30, 30 minutes before the half hour now falls in
  const NOW = new Date('2026-09-26T20:00:00Z').getTime()
  const MINUTE = 60_000
  const at = (minutes: number) => new Date(NOW + minutes * MINUTE).toISOString()
  const liveSchedule = [
    { title: 'Pre-game', startTime: at(-45), endTime: at(-10) },
    { title: 'Hockey Night', startTime: at(-10), endTime: at(170) },
    { title: 'After Hours', startTime: at(170), endTime: at(230) },
  ].map(toLiveProgramme)
  const liveRow = () => within(screen.getAllByTestId('channel-row')[0])
  const block = (title: string) => liveRow().getByText(title).closest('button')!

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(NOW)
    useChannelStore.setState({
      currentChannel: { id: 'live', name: 'Club', streamUrl: 'http://x/live', guideId: 'g1' },
    })
    useErsatztvStore.setState({ channels: [] })
    useTVStore.setState({ liveEPGStatus: 'ok' })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    useChannelStore.setState({ currentChannel: null })
    useTVStore.setState({ liveProgrammes: [], liveEPGStatus: 'idle' })
  })

  it('draws every programme of the live schedule in row 0, with its past, now and future states', () => {
    useTVStore.setState({ liveProgrammes: liveSchedule })
    // Now-playing knows only the current show; the schedule wins
    const onNow: EPGResponse = { channelId: 'g1', currentProgram: { title: 'Hockey Night', startTime: at(-10), endTime: at(170) } }
    render(<TVEPGGrid programmesByChannel={{}} liveEPG={onNow} />)

    expect(block('Pre-game')).toHaveAttribute('data-state', 'past')
    expect(block('Hockey Night')).toHaveAttribute('data-state', 'now')
    expect(block('After Hours')).toHaveAttribute('data-state', 'future')
    // Upcoming live blocks keep the live tint and show their times
    expect(block('After Hours')).toHaveClass('bg-live/15')
    expect(within(block('After Hours')).getByText(/ - /)).toBeInTheDocument()
    expect(liveRow().getAllByText('Hockey Night')).toHaveLength(1)
  })

  it("hands a clicked live block to onProgrammeClick as a live-slot programme keyed by its start", () => {
    useTVStore.setState({ liveProgrammes: liveSchedule })
    const onProgrammeClick = vi.fn()
    render(<TVEPGGrid programmesByChannel={{}} liveEPG={null} onProgrammeClick={onProgrammeClick} />)

    fireEvent.click(block('After Hours'))

    expect(onProgrammeClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: `live-${at(170)}`, channelId: LIVE_CHANNEL_ID, title: 'After Hours', start: at(170), stop: at(230) }),
      expect.objectContaining({ id: LIVE_CHANNEL_ID, type: 'live' })
    )
  })

  it("falls back to now-playing's current and next programmes while there is no schedule", () => {
    const nowPlaying: EPGResponse = {
      channelId: 'g1',
      currentProgram: { title: 'Hockey Night', startTime: at(-10), endTime: at(170) },
      nextProgram: { title: 'After Hours', startTime: at(170), endTime: at(230) },
    }
    render(<TVEPGGrid programmesByChannel={{}} liveEPG={nowPlaying} />)

    expect(block('Hockey Night')).toHaveAttribute('data-state', 'now')
    expect(block('After Hours')).toHaveAttribute('data-state', 'future')
  })
})

describe('TVEPGGrid empty live slot', () => {
  beforeEach(() => {
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels: [] })
  })

  afterEach(() => {
    cleanup()
    useTVStore.setState({ selectedChannel: null })
  })

  it('turns the live row placeholder into Pick a channel for everyone, which opens the picker', () => {
    const onPickLive = vi.fn()
    const onChannelClick = vi.fn()
    render(<TVEPGGrid programmesByChannel={{}} onPickLive={onPickLive} onChannelClick={onChannelClick} />)

    fireEvent.click(screen.getByRole('button', { name: 'Pick a channel for everyone' }))

    expect(onPickLive).toHaveBeenCalledTimes(1)
    expect(onChannelClick).not.toHaveBeenCalled()
    expect(useTVStore.getState().selectedChannel).toBeNull()
  })

  it('shows the wait copy without the action', () => {
    render(<TVEPGGrid programmesByChannel={{}} />)

    expect(screen.queryByRole('button', { name: 'Pick a channel for everyone' })).not.toBeInTheDocument()
    const [liveRow] = screen.getAllByTestId('channel-row')
    expect(liveRow).toHaveTextContent('Waiting for someone to put something on')
  })

  it('offers no picker once something is on live TV', () => {
    useChannelStore.setState({
      currentChannel: { id: 'live', name: 'Club', streamUrl: 'http://x/live', guideId: 'g1' },
    })
    render(<TVEPGGrid programmesByChannel={{}} liveEPG={liveEPG} onPickLive={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Pick a channel for everyone' })).not.toBeInTheDocument()
  })
})

describe('TVEPGGrid channel column', () => {
  const NOW = new Date('2026-09-26T20:00:00Z').getTime()
  const MINUTE = 60_000
  const movies = { id: 'etv1', name: 'Movies', streamUrl: '/etv1', logoUrl: '', number: 1, group: 'Films' }
  const cartoons = { id: 'etv2', name: 'Cartoons', streamUrl: '/etv2', logoUrl: '', number: 2, group: 'Kids' }
  // 30 of 95 minutes in, 65 to go
  const onNow: Record<string, ErsatzTVProgramme[]> = {
    etv1: [{
      id: 'p1',
      channelId: 'etv1',
      title: 'Movie Night',
      start: new Date(NOW - 30 * MINUTE).toISOString(),
      stop: new Date(NOW + 65 * MINUTE).toISOString(),
    }],
  }
  const labelFor = (name: string) => screen.getByRole('button', { name: new RegExp(`^Switch to \\d+ ${name}$`) })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels: [movies, cartoons] })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels: [] })
    useTVStore.setState({ selectedChannel: null })
  })

  it('shows each channel by number and name, with the old tooltip text kept as the label', () => {
    render(<TVEPGGrid programmesByChannel={{}} />)

    const label = labelFor('Cartoons')
    expect(label).toHaveAccessibleName('Switch to 2 Cartoons')
    expect(label).toHaveTextContent('2')
    expect(label).toHaveTextContent('Cartoons')
    expect(label).toHaveStyle({ width: '208px' })
    fireEvent.focus(label)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it("shows the on-air programme's progress and time left", () => {
    render(<TVEPGGrid programmesByChannel={onNow} />)

    const label = labelFor('Movies')
    expect(label).toHaveTextContent('1h 5m left')
    const fill = label.querySelector('[data-testid="label-progress"]') as HTMLElement
    expect(parseFloat(fill.style.width)).toBeCloseTo((30 / 95) * 100, 5)
    // Nothing on air, nothing to show
    expect(labelFor('Cartoons').querySelector('[data-testid="label-progress"]')).toBeNull()
    expect(labelFor('Cartoons')).not.toHaveTextContent('left')
  })

  it('marks the channel being watched with aria-current and a primary bar', () => {
    useTVStore.setState({ selectedChannel: { ...cartoons, type: 'ersatztv' } })
    render(<TVEPGGrid programmesByChannel={onNow} />)

    const watched = labelFor('Cartoons')
    expect(watched).toHaveAttribute('aria-current', 'true')
    expect(watched.querySelector('[data-testid="watching-bar"]')).toHaveClass('bg-primary')
    const other = labelFor('Movies')
    expect(other).not.toHaveAttribute('aria-current')
    expect(other.querySelector('[data-testid="watching-bar"]')).toBeNull()
  })

  it("badges the live row LIVE, with its programme's time left, only while something is on", () => {
    const { unmount } = render(<TVEPGGrid programmesByChannel={{}} />)
    const [emptyLiveRow] = screen.getAllByTestId('channel-row')
    expect(within(emptyLiveRow.querySelector('button')!).queryByText('Live', { selector: '.bg-live' })).toBeNull()
    unmount()

    useChannelStore.setState({
      currentChannel: { id: 'live', name: 'Club', streamUrl: 'http://x/live', guideId: 'g1' },
    })
    const live: EPGResponse = {
      channelId: 'live',
      currentProgram: {
        title: 'Club Broadcast',
        startTime: new Date(NOW - 10 * MINUTE).toISOString(),
        endTime: new Date(NOW + 20 * MINUTE).toISOString(),
      },
    }
    render(<TVEPGGrid programmesByChannel={{}} liveEPG={live} />)

    const label = labelFor('Club')
    expect(within(label).getByText('Live')).toHaveClass('bg-live', 'text-live-foreground')
    expect(label).toHaveTextContent('20m left')
  })
})

describe('TVEPGGrid scrolling', () => {
  afterEach(() => cleanup())

  it('is the only scroller, both ways, with the time header sticking inside it', () => {
    render(<TVEPGGrid programmesByChannel={programmesByChannel} liveEPG={liveEPG} />)

    const grid = screen.getByTestId('tv-epg-grid')
    expect(grid).toHaveClass('h-full', 'overflow-auto')
    expect(grid).not.toHaveClass('overflow-y-hidden')
    const header = screen.getByRole('button', { name: 'Scroll to now' }).parentElement!.parentElement!
    expect(header).toHaveClass('sticky', 'top-0')
    expect(header.parentElement).toBe(grid)
  })

  it('layers the time header above the channel labels that scroll up under it', () => {
    render(<TVEPGGrid programmesByChannel={programmesByChannel} liveEPG={liveEPG} />)

    // jsdom doesn't paint, so compare the z-index classes. The header, the
    // labels and the now marker share one stacking context in the grid.
    const zIndex = (el: Element) => Number(/(?:^|\s)z-(\d+)(?:\s|$)/.exec(el.className)?.[1] ?? 0)
    const header = screen.getByRole('button', { name: 'Scroll to now' }).parentElement!.parentElement!
    const label = screen.getAllByTestId('channel-row')[0].firstElementChild!
    expect(label).toHaveClass('sticky', 'left-0')
    expect(zIndex(header)).toBeGreaterThan(zIndex(label))
  })
})

describe('TVEPGGrid scrolls to the watched channel', () => {
  // Ten ErsatzTV channels under the live row: 11 rows of 64px. jsdom has no
  // layout, so the grid gets a 300px viewport; the time header measures 0.
  const channels = Array.from({ length: 10 }, (_, i) => ({
    id: `etv${i + 1}`, name: `Channel ${i + 1}`, streamUrl: `/etv${i + 1}`, logoUrl: '', number: i + 1, group: '',
  }))
  const isGrid = (el: Element) => el instanceof HTMLElement && el.dataset.testid === 'tv-epg-grid'
  const watch = (n: number) => act(() => useTVStore.setState({ selectedChannel: { ...channels[n - 1], type: 'ersatztv' } }))

  beforeEach(() => {
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
      return isGrid(this) ? 300 : 0
    })
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) {
      return isGrid(this) ? 11 * 64 : 0
    })
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    useErsatztvStore.setState({ channels: [] })
    useTVStore.setState({ selectedChannel: null, liveEPGStatus: 'idle' })
  })

  it('centres the watched row when the guide opens with it off-screen', () => {
    useTVStore.setState({ selectedChannel: { ...channels[7], type: 'ersatztv' } })
    render(<TVEPGGrid programmesByChannel={{}} />)

    // Row 8 starts at 512px; its centre (544) sits mid-viewport at 544 - 150
    expect(screen.getByTestId('tv-epg-grid').scrollTop).toBe(394)
  })

  it('waits for the programmes to load, then scrolls', () => {
    useTVStore.setState({ selectedChannel: { ...channels[7], type: 'ersatztv' } })
    const { rerender } = render(<TVEPGGrid programmesByChannel={{}} loading />)
    expect(screen.queryByTestId('tv-epg-grid')).not.toBeInTheDocument()

    rerender(<TVEPGGrid programmesByChannel={{}} />)

    expect(screen.getByTestId('tv-epg-grid').scrollTop).toBe(394)
  })

  it('follows a channel change while open, leaving a row already in view where it is', () => {
    render(<TVEPGGrid programmesByChannel={{}} />)
    const grid = screen.getByTestId('tv-epg-grid')
    expect(grid.scrollTop).toBe(0)

    watch(8)
    expect(grid.scrollTop).toBe(394)

    // Row 7 (448-512px) is inside 394-694px: no jump
    watch(7)
    expect(grid.scrollTop).toBe(394)

    // Back near the top, clamped at 0
    watch(1)
    expect(grid.scrollTop).toBe(0)

    // The last row can't be centred: clamped to the end of the grid (704 - 300)
    watch(10)
    expect(grid.scrollTop).toBe(404)
  })

  it("doesn't pull the guide back after the viewer scrolls away, or when nothing is watched", () => {
    render(<TVEPGGrid programmesByChannel={{}} />)
    const grid = screen.getByTestId('tv-epg-grid')
    watch(8)
    expect(grid.scrollTop).toBe(394)

    grid.scrollTop = 0
    act(() => useTVStore.setState({ liveEPGStatus: 'empty' }))
    expect(grid.scrollTop).toBe(0)

    act(() => useTVStore.setState({ selectedChannel: null }))
    expect(grid.scrollTop).toBe(0)
  })
})

describe('TVEPGGrid navigation scrolling', () => {
  // jsdom has no layout scrolling, so there's no scrollBy/scrollTo to spy on
  const scrollBy = vi.fn()
  const scrollTo = vi.fn()
  const originalMatchMedia = window.matchMedia

  function mockReducedMotion(reduce: boolean) {
    window.matchMedia = vi.fn((query: string) => ({
      matches: reduce && query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  }

  beforeEach(() => {
    Element.prototype.scrollBy = scrollBy
    Element.prototype.scrollTo = scrollTo
    useChannelStore.setState({
      currentChannel: { id: 'live', name: 'Club', streamUrl: 'http://x/live', guideId: 'g1' },
    })
    useErsatztvStore.setState({
      channels: [
        { id: 'etv1', name: 'Movies', streamUrl: '', logoUrl: '', number: 1, group: 'Films' },
      ],
    })
  })

  afterEach(() => {
    cleanup()
    scrollBy.mockReset()
    scrollTo.mockReset()
    delete (Element.prototype as Partial<Element>).scrollBy
    delete (Element.prototype as Partial<Element>).scrollTo
    window.matchMedia = originalMatchMedia
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels: [] })
  })

  function clickNav() {
    render(<TVEPGGrid programmesByChannel={programmesByChannel} liveEPG={liveEPG} />)
    fireEvent.click(screen.getByRole('button', { name: 'Scroll forward 2 hours' }))
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to now' }))
  }

  it('jumps instead of smooth-scrolling under reduced motion', () => {
    mockReducedMotion(true)
    clickNav()

    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }))
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }))
  })

  it('scrolls smoothly when motion is allowed', () => {
    mockReducedMotion(false)
    clickNav()

    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }))
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }))
  })
})

describe('TVEPGGrid programme states', () => {
  // The grid starts at 19:30, 30 minutes before the half hour now falls in
  const NOW = new Date('2026-09-26T20:00:00Z').getTime()
  const MINUTE = 60_000
  const at = (minutes: number) => new Date(NOW + minutes * MINUTE).toISOString()
  const movies = { id: 'etv1', name: 'Movies', streamUrl: '/etv1', logoUrl: '', number: 1, group: 'Films' }
  const cartoons = { id: 'etv2', name: 'Cartoons', streamUrl: '/etv2', logoUrl: '', number: 2, group: 'Kids' }
  const schedule: Record<string, ErsatzTVProgramme[]> = {
    etv1: [
      { id: 'past', channelId: 'etv1', title: 'Earlier Film', start: at(-60), stop: at(-15) },
      // 15 of 45 minutes in, 30 to go
      { id: 'now', channelId: 'etv1', title: 'Current Film', start: at(-15), stop: at(30) },
      { id: 'next', channelId: 'etv1', title: 'Later Film', start: at(30), stop: at(120) },
    ],
    etv2: [
      // Started 90 minutes ago, an hour before the grid does
      { id: 'long', channelId: 'etv2', title: 'Long Cartoon', start: at(-90), stop: at(30) },
    ],
  }
  const block = (title: string) => screen.getByText(title).closest('button')!
  const [title, meta] = [0, 1].map((i) => (el: HTMLElement) => el.querySelectorAll('p')[i])

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(NOW)
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels: [movies, cartoons] })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    useErsatztvStore.setState({ channels: [] })
    useTVStore.setState({ selectedChannel: null })
  })

  it('marks blocks before, around and after now as past, now and future', () => {
    render(<TVEPGGrid programmesByChannel={schedule} />)

    expect(block('Earlier Film')).toHaveAttribute('data-state', 'past')
    expect(block('Current Film')).toHaveAttribute('data-state', 'now')
    expect(block('Later Film')).toHaveAttribute('data-state', 'future')
  })

  it('lets past blocks recede: no fill, a border and muted regular-weight text', () => {
    render(<TVEPGGrid programmesByChannel={schedule} />)

    const past = block('Earlier Film')
    expect(past).toHaveClass('bg-transparent', 'border', 'border-border', 'text-muted-foreground')
    expect(past).not.toHaveClass('bg-guide-future')
    expect(title(past)).toHaveClass('font-normal')
    expect(past.querySelector('[data-testid="programme-elapsed"]')).toBeNull()
  })

  it("puts the block on now on guide-now with a primary start bar, a semibold title and the time left", () => {
    render(<TVEPGGrid programmesByChannel={schedule} />)

    const now = block('Current Film')
    expect(now).toHaveClass('bg-guide-now', 'shadow-[inset_3px_0_0_var(--primary)]', 'text-foreground')
    expect(title(now)).toHaveClass('font-semibold')
    expect(meta(now)).toHaveTextContent('30m left')
    // The meta stays on the foreground: muted text on guide-now is too faint
    expect(meta(now)).toHaveClass('text-foreground')
    expect(meta(now)).not.toHaveClass('text-muted-foreground')
  })

  it('draws a primary elapsed line across the block on now, ending at the now marker', () => {
    render(<TVEPGGrid programmesByChannel={schedule} />)

    const elapsed = block('Current Film').querySelector('[data-testid="programme-elapsed"]') as HTMLElement
    expect(elapsed).toHaveClass('h-0.5', 'bg-primary')
    expect(parseFloat(elapsed.style.width)).toBeCloseTo((15 / 45) * 100, 5)
    // Drawn from the grid's start at 19:30: 30 of the 60 visible minutes
    const clipped = block('Long Cartoon').querySelector('[data-testid="programme-elapsed"]') as HTMLElement
    expect(parseFloat(clipped.style.width)).toBeCloseTo(50, 5)
  })

  it('keeps future blocks quiet: guide-future, medium weight, the time range muted', () => {
    render(<TVEPGGrid programmesByChannel={schedule} />)

    const next = block('Later Film')
    expect(next).toHaveClass('bg-guide-future', 'border-border', 'text-foreground')
    expect(title(next)).toHaveClass('font-medium')
    expect(meta(next)).toHaveClass('text-muted-foreground')
    expect(meta(next)).not.toHaveTextContent('left')
  })

  it('marks the block on now on the watched channel, and only that one', () => {
    useTVStore.setState({ selectedChannel: { ...movies, type: 'ersatztv' } })
    render(<TVEPGGrid programmesByChannel={schedule} />)

    expect(block('Current Film')).toHaveAttribute('data-watching', 'true')
    expect(block('Current Film')).toHaveClass('border-primary')
    for (const other of ['Earlier Film', 'Later Film', 'Long Cartoon']) {
      expect(block(other)).not.toHaveAttribute('data-watching')
      expect(block(other)).not.toHaveClass('border-primary')
    }
  })

  it('moves a block from future to now when the clock reaches its start', () => {
    const soon = { etv1: [{ id: 'soon', channelId: 'etv1', title: 'Soon Film', start: at(1), stop: at(31) }] }
    render(<TVEPGGrid programmesByChannel={soon} />)
    expect(block('Soon Film')).toHaveAttribute('data-state', 'future')

    act(() => vi.advanceTimersByTime(MINUTE))

    expect(block('Soon Film')).toHaveAttribute('data-state', 'now')
    expect(meta(block('Soon Film'))).toHaveTextContent('30m left')
  })

  it('keeps each title sticky just right of the channel column, clipping rather than scrolling the block', () => {
    render(<TVEPGGrid programmesByChannel={schedule} />)

    for (const title of ['Earlier Film', 'Current Film', 'Later Film', 'Long Cartoon']) {
      const el = block(title)
      // overflow: hidden would make the block the sticky title's scroll container
      expect(el).toHaveClass('overflow-clip', 'text-left')
      expect(el).not.toHaveClass('overflow-hidden')
      expect(el).not.toHaveClass('text-right')
      const text = el.querySelector('[data-testid="programme-text"]') as HTMLElement
      // The 208px channel column plus 8px
      expect(text).toHaveClass('sticky', 'w-fit')
      expect(text).toHaveStyle({ left: '216px' })
      expect(text.querySelectorAll('p')).toHaveLength(2)
      text.querySelectorAll('p').forEach((p) => expect(p).toHaveClass('truncate'))
    }
  })

  it('narrows each title to the part of its block right of the channel column, so it truncates at the column edge', () => {
    render(<TVEPGGrid programmesByChannel={schedule} />)
    const grid = screen.getByTestId('tv-epg-grid')
    const width = (title: string) =>
      (block(title).querySelector('[data-testid="programme-text"]') as HTMLElement).style.maxWidth

    // The block less what has scrolled past its left edge, from the block's
    // own offset into the programmes: 0px from 19:30, 300px from 20:30
    expect(width('Long Cartoon')).toBe('calc(100% - max(0px, var(--guide-scroll-x, 0px) - 0px))')
    expect(width('Later Film')).toBe('calc(100% - max(0px, var(--guide-scroll-x, 0px) - 300px))')

    // Opening scrolls now 100px right of the column: 20:00 is 150px in
    expect(grid.style.getPropertyValue('--guide-scroll-x')).toBe('50px')
    grid.scrollLeft = 120
    fireEvent.scroll(grid)
    expect(grid.style.getPropertyValue('--guide-scroll-x')).toBe('120px')
  })

  it('draws a block that started before the grid from the grid start, left-aligned', () => {
    render(<TVEPGGrid programmesByChannel={schedule} />)

    // 19:30 to 20:30 at 150px per half hour, less the 3px gap
    const long = block('Long Cartoon')
    expect(long).toHaveStyle({ left: '0px', width: '297px' })
    expect(long).not.toHaveClass('text-right')
  })

  it('draws short programmes at their true width, with a tooltip and an accessible name instead of text', () => {
    const shorts = {
      etv1: [
        { id: 'short', channelId: 'etv1', title: 'Station Ident', start: at(30), stop: at(35) },
        { id: 'after', channelId: 'etv1', title: 'Later Film', start: at(35), stop: at(120) },
      ],
    }
    render(<TVEPGGrid programmesByChannel={shorts} />)

    const short = screen.getByRole('button', { name: /^Station Ident, / })
    // Five minutes: 25px less the gap, no 60px minimum spilling over the next block
    expect(short).toHaveStyle({ width: '22px' })
    const next = block('Later Film')
    expect(parseFloat(short.style.left) + parseFloat(short.style.width)).toBeLessThanOrEqual(parseFloat(next.style.left))
    expect(short).toHaveAttribute('data-state', 'future')
    expect(short).toHaveTextContent('')
    expect(short.querySelector('[data-testid="programme-text"]')).toBeNull()

    fireEvent.focus(short)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Station Ident')
  })

  it('names a narrow block on now by its title and time left', () => {
    const ending = { etv1: [{ id: 'ending', channelId: 'etv1', title: 'Promo', start: at(-5), stop: at(4) }] }
    render(<TVEPGGrid programmesByChannel={ending} />)

    expect(screen.getByRole('button', { name: 'Promo, 4m left' })).toHaveAttribute('data-state', 'now')
  })

  it('keeps the live tint on the live row while its programme is on', () => {
    useChannelStore.setState({
      currentChannel: { id: 'live', name: 'Club', streamUrl: 'http://x/live', guideId: 'g1' },
    })
    const live: EPGResponse = {
      channelId: 'live',
      currentProgram: { title: 'Club Broadcast', startTime: at(-10), endTime: at(20) },
    }
    render(<TVEPGGrid programmesByChannel={{}} liveEPG={live} />)

    const onAir = block('Club Broadcast')
    expect(onAir).toHaveAttribute('data-state', 'now')
    expect(onAir).toHaveClass('bg-live/15', 'shadow-[inset_3px_0_0_var(--live)]')
    expect(onAir.querySelector('[data-testid="programme-elapsed"]')).toHaveClass('bg-live')
  })
})

describe('TVEPGGrid time header', () => {
  // 8 PM local on Saturday 26 September: the 48-hour grid starts at 7:30 PM
  // and crosses midnight into Sunday 27 and Monday 28
  const NOW = new Date(2026, 8, 26, 20, 0).getTime()
  const dayFormat = new Intl.DateTimeFormat([], { weekday: 'short', day: 'numeric' })
  const timeFormat = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' })
  const slotOffset = (date: Date) => ((date.getTime() - new Date(2026, 8, 26, 19, 30).getTime()) / (30 * 60_000)) * 150
  const timeLabels = () => {
    const header = screen.getByRole('button', { name: 'Scroll to now' }).parentElement!.parentElement!
    return Array.from(header.lastElementChild!.children).filter((el) => el.tagName === 'DIV') as HTMLElement[]
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels: [] })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('keeps each time label sticky just right of the channel column, so the first clears the nav cell', () => {
    render(<TVEPGGrid hours={48} programmesByChannel={{}} />)

    const [first] = timeLabels()
    expect(first).toHaveClass('overflow-clip')
    expect(first).not.toHaveClass('overflow-hidden')
    const label = first.firstElementChild as HTMLElement
    expect(label).toHaveClass('sticky')
    expect(label).toHaveStyle({ left: '216px' })
    expect(label).toHaveTextContent(timeFormat.format(new Date(2026, 8, 26, 19, 30)))
  })

  it('hides a time label once the part of its slot in view is narrower than the label, rather than cutting it', () => {
    render(<TVEPGGrid hours={48} programmesByChannel={{}} />)

    const labels = timeLabels().map((slot) => slot.firstElementChild as HTMLElement)
    // Each label is no wider than its slot less what has scrolled under the
    // channel column, from the slot's own offset: 150px per slot
    expect(labels[0].style.maxWidth).toBe('calc(100% - max(0px, var(--guide-scroll-x, 0px) - 0px))')
    expect(labels[2].style.maxWidth).toBe('calc(100% - max(0px, var(--guide-scroll-x, 0px) - 300px))')
    // One line tall: a label that doesn't fit wraps after the zero-width
    // space onto a clipped second line
    expect(labels[0]).toHaveClass('h-[1lh]', 'overflow-clip')
    expect(labels[0].firstChild?.textContent).toBe('\u200B')
    expect(labels[0].lastElementChild).toHaveClass('inline-block', 'whitespace-nowrap')
  })

  it('marks each midnight slot with its weekday and date', () => {
    render(<TVEPGGrid hours={48} programmesByChannel={{}} />)

    const markers = screen.getAllByTestId('day-marker')
    expect(markers.map((m) => m.textContent)).toEqual([
      dayFormat.format(new Date(2026, 8, 27)),
      dayFormat.format(new Date(2026, 8, 28)),
    ])
    const sunday = markers[0].closest('div')!
    expect(sunday).toHaveTextContent(timeFormat.format(new Date(2026, 8, 27, 0, 0)))
    expect(timeLabels().indexOf(sunday)).toBe(9)
  })

  it('names the day in view next to the Now button, following the scroll across midnight', () => {
    render(<TVEPGGrid hours={48} programmesByChannel={{}} />)
    const grid = screen.getByTestId('tv-epg-grid')
    const day = screen.getByTestId('guide-day')
    expect(day).toHaveTextContent('Today')

    grid.scrollLeft = slotOffset(new Date(2026, 8, 27, 1, 0))
    fireEvent.scroll(grid)
    expect(day).toHaveTextContent('Tomorrow')

    grid.scrollLeft = slotOffset(new Date(2026, 8, 28, 9, 0))
    fireEvent.scroll(grid)
    expect(day).toHaveTextContent(dayFormat.format(new Date(2026, 8, 28)))

    grid.scrollLeft = 0
    fireEvent.scroll(grid)
    expect(day).toHaveTextContent('Today')
  })

  it('shows the current time in a pill on the now marker', () => {
    render(<TVEPGGrid hours={48} programmesByChannel={{}} />)

    const pill = screen.getByTestId('now-pill')
    expect(pill).toHaveTextContent(timeFormat.format(new Date(NOW)))
    // Half an hour into the grid: one slot
    expect(pill).toHaveStyle({ left: '150px' })
  })
})
