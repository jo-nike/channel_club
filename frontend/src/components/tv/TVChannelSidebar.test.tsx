import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup, within } from '@/test/utils'
import { TVChannelSidebar } from './TVChannelSidebar'
import { useChannelStore } from '@/stores/channelStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore } from '@/stores/tvStore'
import { fetchErsatzTVCurrentProgramme } from '@/services/ersatztvApi'
import type { ErsatzTVProgramme } from '@/types'

// Putting a channel on live TV starts a guide lookup; leave it unanswered so
// each test sets the live guide state itself
vi.mock('@/services/api', () => ({ fetchNowPlaying: vi.fn(() => new Promise(() => {})) }))

vi.mock('@/services/ersatztvApi', () => ({
  fetchErsatzTVCurrentProgramme: vi.fn().mockResolvedValue({ current: null, nextUp: null }),
  getErsatzTVLogoUrl: vi.fn((id: string) => `/api/ersatztv/logo/${id}`),
}))

describe('TVChannelSidebar colours', () => {
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

  it('hovers collapsed rail tiles with a foreground tint, which stays visible on bg-muted', async () => {
    render(<TVChannelSidebar isCollapsed />)
    // Let the current-programme fetch settle
    await act(async () => {})

    const tile = screen.getByRole('button', { name: '1 Movies' })
    expect(tile).toHaveClass('bg-muted', 'hover:bg-foreground/10')
    expect(tile).not.toHaveClass('hover:bg-accent')
  })

  it('shows the LIVE badge on the live token rather than destructive', async () => {
    render(<TVChannelSidebar />)
    await act(async () => {})

    const badge = screen.getByText('Live', { selector: 'span' })
    expect(badge).toHaveClass('bg-live', 'text-live-foreground')
    expect(badge).not.toHaveClass('bg-destructive')
  })
})

describe('TVChannelSidebar now-playing indicator', () => {
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
    cleanup()
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels: [] })
    useTVStore.setState({ selectedChannel: null })
  })

  function select(index: number) {
    useTVStore.setState({ selectedChannel: useTVStore.getState().getUnifiedChannels()[index] })
  }

  it('marks the selected row with a static primary AudioLines icon, not a pulsing dot', async () => {
    select(1)
    render(<TVChannelSidebar />)
    await act(async () => {})

    const indicator = screen.getByTestId('now-playing-indicator')
    expect(indicator.closest('button')).toHaveTextContent('Movies')
    expect(indicator).toHaveClass('lucide-audio-lines', 'h-4', 'w-4', 'text-primary')
    expect(indicator).toHaveAttribute('aria-hidden', 'true')
    expect(indicator).not.toHaveClass('animate-pulse')
    expect(document.querySelector('.animate-pulse')).toBeNull()
  })

  it('uses the live colour on the live slot', async () => {
    select(0)
    render(<TVChannelSidebar />)
    await act(async () => {})

    const indicator = screen.getByTestId('now-playing-indicator')
    expect(indicator.closest('button')).toBe(screen.getByRole('button', { name: 'Live Channel' }))
    expect(indicator).toHaveClass('text-live')
    expect(indicator).not.toHaveClass('text-primary')
  })

  it('shows no indicator when nothing is selected', async () => {
    render(<TVChannelSidebar />)
    await act(async () => {})

    expect(screen.queryByTestId('now-playing-indicator')).not.toBeInTheDocument()
  })
})

const RAIL_CHANNELS = Array.from({ length: 36 }, (_, i) => ({
  id: `etv${i + 1}`,
  name: `Channel ${i + 1}`,
  streamUrl: '',
  logoUrl: i % 2 === 0 ? `/logos/${i + 1}.png` : '',
  number: i + 1,
  group: 'All',
}))

function railTiles() {
  // Channel tiles carry aria-pressed; the expand button doesn't
  return screen.getAllByRole('button').filter((button) => button.hasAttribute('aria-pressed'))
}

describe('TVChannelSidebar collapsed rail', () => {
  beforeEach(() => {
    useChannelStore.setState({
      currentChannel: { id: 'live', name: 'Club', streamUrl: 'http://x/live', guideId: 'g1' },
    })
    useErsatztvStore.setState({ channels: RAIL_CHANNELS })
  })

  afterEach(() => {
    cleanup()
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels: [], programmesByChannel: {} })
    useTVStore.setState({ liveEPG: null })
  })

  it('keeps all 37 tiles at 40px and lets the 64px rail scroll instead of shrinking them', async () => {
    const { container } = render(<TVChannelSidebar isCollapsed />)
    await act(async () => {})

    expect(container.querySelector('aside')).toHaveClass('w-16')
    const tiles = railTiles()
    expect(tiles).toHaveLength(37)
    const list = tiles[0].parentElement
    expect(list).toHaveClass('flex-1', 'overflow-y-auto', 'px-3', 'gap-1.5')
    // A classic scrollbar would widen the list past the rail and push tiles off-centre
    expect(list).toHaveClass('w-full', '[scrollbar-width:none]', '[&::-webkit-scrollbar]:hidden')

    for (const tile of tiles) {
      expect(tile).toHaveClass('h-10', 'shrink-0', 'rounded-lg')
    }
    // The live tile may widen for its content; the rest are square
    expect(tiles[0]).toHaveClass('min-w-10')
    for (const tile of tiles.slice(1)) {
      expect(tile).toHaveClass('w-10')
    }
  })
})

describe('TVChannelSidebar collapsed rail tiles', () => {
  const MINUTE = 60_000

  function programme(id: string, title: string, startOffsetMin: number, stopOffsetMin: number): ErsatzTVProgramme {
    const now = Date.now()
    return {
      id,
      channelId: 'etv3',
      title,
      start: new Date(now + startOffsetMin * MINUTE).toISOString(),
      stop: new Date(now + stopOffsetMin * MINUTE).toISOString(),
    }
  }

  beforeEach(() => {
    useChannelStore.setState({
      currentChannel: { id: 'live', name: 'Club', streamUrl: 'http://x/live', guideId: 'g1' },
    })
    useErsatztvStore.setState({ channels: RAIL_CHANNELS })
  })

  afterEach(() => {
    cleanup()
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels: [], programmesByChannel: {} })
    useTVStore.setState({ liveEPG: null })
  })

  it('badges logo tiles with the channel number; tiles without a logo show the number itself', async () => {
    render(<TVChannelSidebar isCollapsed />)
    await act(async () => {})

    // Channel 3 has a logo (odd numbers do in RAIL_CHANNELS)
    const logoTile = screen.getByRole('button', { name: '3 Channel 3' })
    expect(logoTile.querySelector('img')).not.toBeNull()
    const badge = within(logoTile).getByText('3')
    expect(badge).toHaveAttribute('aria-hidden', 'true')
    expect(badge).toHaveClass('absolute', 'bottom-0', 'right-0', 'h-4', 'min-w-4')
    expect(logoTile).toHaveClass('relative')

    const plainTile = screen.getByRole('button', { name: '4 Channel 4' })
    expect(plainTile.querySelector('img')).toBeNull()
    expect(plainTile).toHaveTextContent(/^4$/)
    expect(plainTile.querySelector('[aria-hidden="true"]')).toBeNull()
  })

  it("shows the tile's number, name and now/next titles from the guide in its tooltip on focus", async () => {
    useErsatztvStore.setState({
      programmesByChannel: {
        etv3: [
          programme('p1', 'Morning Show', -90, -30),
          programme('p2', 'Evening News', -30, 30),
          programme('p3', 'Late Movie', 30, 150),
          programme('p4', 'Overnight', 150, 300),
        ],
      },
    })
    render(<TVChannelSidebar isCollapsed />)
    await act(async () => {})
    // Nothing is mounted (or computed) until a tile's tooltip opens
    expect(screen.queryByRole('tooltip')).toBeNull()

    await act(async () => {
      screen.getByRole('button', { name: '3 Channel 3' }).focus()
    })

    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('3 Channel 3')
    expect(tooltip).toHaveTextContent('Now Evening News')
    expect(tooltip).toHaveTextContent('Next Late Movie')
    expect(tooltip).not.toHaveTextContent('Morning Show')
    expect(tooltip).not.toHaveTextContent('Overnight')
  })

  it("shows the live channel's now/next from the live guide in its tooltip", async () => {
    useTVStore.setState({
      liveEPG: {
        channelId: 'g1',
        currentProgram: { title: 'Hockey Night', startTime: '', endTime: '' },
        nextProgram: { title: 'Post-game', startTime: '', endTime: '' },
      },
    })
    render(<TVChannelSidebar isCollapsed />)
    await act(async () => {})

    await act(async () => {
      screen.getByRole('button', { name: 'Live Channel' }).focus()
    })

    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('0 Club')
    expect(tooltip).toHaveTextContent('Now Hockey Night')
    expect(tooltip).toHaveTextContent('Next Post-game')
  })
})

describe('TVChannelSidebar collapsed live tile', () => {
  const liveTile = () => screen.getByRole('button', { name: 'Live Channel' })
  // Plain background utilities only (hover:bg-* is a separate state)
  const backgrounds = (element: HTMLElement) =>
    Array.from(element.classList).filter((name) => name.startsWith('bg-'))

  async function openLiveTooltip() {
    await act(async () => {
      liveTile().focus()
    })
    return screen.findByRole('tooltip')
  }

  beforeEach(() => {
    // The rail scrolls the selected tile into view; jsdom has no scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()
    useErsatztvStore.setState({
      channels: [{ id: 'etv1', name: 'Movies', streamUrl: '', logoUrl: '', number: 1, group: 'Films' }],
    })
  })

  afterEach(() => {
    cleanup()
    delete (Element.prototype as Partial<Element>).scrollIntoView
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels: [] })
    useTVStore.setState({ selectedChannel: null, liveEPG: null, liveEPGStatus: 'idle' })
  })

  it("tells people who can pick a channel that nothing's on yet", async () => {
    useChannelStore.setState({ currentChannel: null })
    render(<TVChannelSidebar isCollapsed onPickLive={vi.fn()} />)
    await act(async () => {})

    const tooltip = await openLiveTooltip()
    expect(tooltip).toHaveTextContent('Nothing on yet')
    expect(tooltip).not.toHaveTextContent('Awaiting broadcast')
  })

  it("tells everyone else they're waiting for someone to put something on", async () => {
    useChannelStore.setState({ currentChannel: null })
    render(<TVChannelSidebar isCollapsed />)
    await act(async () => {})

    const tooltip = await openLiveTooltip()
    expect(tooltip).toHaveTextContent('Waiting for someone to put something on')
    expect(tooltip).not.toHaveTextContent('Awaiting broadcast')
  })

  it.each([
    ['unavailable', 'Guide unavailable'],
    ['empty', 'No guide info'],
  ] as const)("says why there's no title when live TV is on and the guide is %s", async (liveEPGStatus, copy) => {
    useChannelStore.setState({
      currentChannel: { id: 'live', name: 'Club', streamUrl: 'http://x/live', guideId: 'g1' },
    })
    useTVStore.setState({ liveEPG: null, liveEPGStatus })
    render(<TVChannelSidebar isCollapsed />)
    await act(async () => {})

    const tooltip = await openLiveTooltip()
    expect(tooltip).toHaveTextContent('0 Club')
    expect(tooltip).toHaveTextContent(copy)
    expect(tooltip).not.toHaveTextContent('Now')
  })

  it('tints the live tile and its icon with the live token rather than destructive', async () => {
    useChannelStore.setState({
      currentChannel: { id: 'live', name: 'Club', streamUrl: 'http://x/live', guideId: 'g1' },
    })
    render(<TVChannelSidebar isCollapsed />)
    await act(async () => {})

    expect(liveTile()).toHaveClass('bg-live/20', 'text-live')
    expect(liveTile().className).not.toMatch(/destructive/)
    const icon = liveTile().querySelector('svg')
    expect(icon).toHaveClass('lucide-radio', 'text-live')
    expect(icon).not.toHaveClass('text-destructive')
  })

  it('gives a selected live tile one background, the live tint, with the selection ring', async () => {
    useChannelStore.setState({
      currentChannel: { id: 'live', name: 'Club', streamUrl: 'http://x/live', guideId: 'g1' },
    })
    useTVStore.setState({ selectedChannel: useTVStore.getState().getUnifiedChannels()[0] })
    render(<TVChannelSidebar isCollapsed />)
    await act(async () => {})

    expect(backgrounds(liveTile())).toEqual(['bg-live/20'])
    expect(liveTile()).toHaveClass('ring-2', 'ring-primary')
  })

  it('gives a selected channel tile one background, the selection tint', async () => {
    useTVStore.setState({ selectedChannel: useTVStore.getState().getUnifiedChannels()[1] })
    render(<TVChannelSidebar isCollapsed />)
    await act(async () => {})

    const tile = screen.getByRole('button', { name: '1 Movies' })
    expect(backgrounds(tile)).toEqual(['bg-primary/10'])
    expect(tile).toHaveClass('ring-2', 'ring-primary')
    // Unselected tiles stay muted
    expect(backgrounds(liveTile())).toEqual(['bg-muted'])
  })
})

describe('TVChannelSidebar collapsed rail scrolling', () => {
  // jsdom has no layout scrolling, so there's no scrollIntoView to spy on
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    Element.prototype.scrollIntoView = scrollIntoView
    useChannelStore.setState({
      currentChannel: { id: 'live', name: 'Club', streamUrl: 'http://x/live', guideId: 'g1' },
    })
    useErsatztvStore.setState({ channels: RAIL_CHANNELS })
    const selected = useTVStore.getState().getUnifiedChannels().find((c) => c.id === 'etv30')
    useTVStore.setState({ selectedChannel: selected ?? null })
  })

  afterEach(() => {
    cleanup()
    scrollIntoView.mockReset()
    delete (Element.prototype as Partial<Element>).scrollIntoView
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels: [] })
    useTVStore.setState({ selectedChannel: null })
  })

  it('scrolls the selected tile into view when the rail collapses', async () => {
    const { rerender } = render(<TVChannelSidebar />)
    await act(async () => {})
    expect(scrollIntoView).not.toHaveBeenCalled()

    rerender(<TVChannelSidebar isCollapsed />)
    await act(async () => {})

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    const tile = screen.getByRole('button', { name: '30 Channel 30' })
    expect(scrollIntoView.mock.contexts[0]).toBe(tile)
    // 'nearest' aligns the tile's border box with the list edge; the scroll
    // margin leaves room for its 2px selection ring
    expect(tile).toHaveClass('scroll-my-1')
  })

  it('follows the selection to its tile while collapsed', async () => {
    render(<TVChannelSidebar isCollapsed />)
    await act(async () => {})
    scrollIntoView.mockClear()

    const next = useTVStore.getState().getUnifiedChannels().find((c) => c.id === 'etv5')
    await act(async () => {
      useTVStore.setState({ selectedChannel: next ?? null })
    })

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toBe(
      screen.getByRole('button', { name: '5 Channel 5' })
    )
  })
})

describe('TVChannelSidebar live row guide copy', () => {
  beforeEach(() => {
    useChannelStore.setState({
      currentChannel: { id: 'live', name: 'Club', streamUrl: 'http://x/live', guideId: 'g1' },
    })
    useErsatztvStore.setState({ channels: [] })
  })

  afterEach(() => {
    cleanup()
    useChannelStore.setState({ currentChannel: null })
    useTVStore.setState({ liveEPG: null, liveEPGStatus: 'idle' })
  })

  const liveRow = () => screen.getByRole('button', { name: 'Live Channel' })

  it.each([
    ['unavailable', 'Guide unavailable'],
    ['empty', 'No guide info'],
    ['loading', 'Loading guide...'],
  ] as const)("says why there's no title when the guide is %s", async (liveEPGStatus, copy) => {
    useTVStore.setState({ liveEPG: null, liveEPGStatus })
    render(<TVChannelSidebar />)
    await act(async () => {})

    expect(liveRow()).toHaveTextContent(copy)
    expect(liveRow()).not.toHaveTextContent('Now broadcasting')
  })

  it('shows the programme title when the guide has one', async () => {
    useTVStore.setState({ liveEPGStatus: 'ok' })
    render(<TVChannelSidebar liveEPGTitle="Hockey Night" />)
    await act(async () => {})

    expect(liveRow()).toHaveTextContent('Hockey Night')
    expect(liveRow()).not.toHaveTextContent('No guide info')
  })
})

describe('TVChannelSidebar empty live slot', () => {
  beforeEach(() => {
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({
      channels: [{ id: 'etv1', name: 'Movies', streamUrl: '', logoUrl: '', number: 1, group: 'Films' }],
    })
    useTVStore.setState({ selectedChannel: null })
  })

  afterEach(() => {
    cleanup()
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels: [] })
    useTVStore.setState({ selectedChannel: null })
  })

  it('offers Pick a channel beside the live row, which opens the picker instead of tuning', async () => {
    const onPickLive = vi.fn()
    render(<TVChannelSidebar onPickLive={onPickLive} />)
    await act(async () => {})

    const pick = screen.getByRole('button', { name: 'Pick a channel' })
    const row = screen.getByRole('button', { name: 'Live Channel' })
    // Siblings in the same list item, never a button inside a button
    expect(row).not.toContainElement(pick)
    expect(pick.parentElement).toBe(row.parentElement)

    await act(async () => {
      pick.click()
    })

    expect(onPickLive).toHaveBeenCalledTimes(1)
    expect(useTVStore.getState().selectedChannel).toBeNull()
  })

  it("tells people who can't change live TV that they're waiting, with no action", async () => {
    render(<TVChannelSidebar />)
    await act(async () => {})

    expect(screen.queryByRole('button', { name: 'Pick a channel' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Live Channel' })).toHaveTextContent(
      'Waiting for someone to put something on'
    )
  })

  it('offers no picker once something is on live TV', async () => {
    useChannelStore.setState({
      currentChannel: { id: 'live', name: 'Club', streamUrl: 'http://x/live', guideId: 'g1' },
    })
    render(<TVChannelSidebar onPickLive={vi.fn()} />)
    await act(async () => {})

    expect(screen.queryByRole('button', { name: 'Pick a channel' })).not.toBeInTheDocument()
  })
})

describe('TVChannelSidebar programme progress', () => {
  const NOW = new Date('2026-09-26T20:00:00Z').getTime()
  const MINUTE = 60_000

  function onNow(startOffsetMin: number, stopOffsetMin: number): ErsatzTVProgramme {
    return {
      id: 'p1',
      channelId: 'etv1',
      title: 'Evening News',
      start: new Date(NOW + startOffsetMin * MINUTE).toISOString(),
      stop: new Date(NOW + stopOffsetMin * MINUTE).toISOString(),
    }
  }

  // The bar's fill sits in the track just before the time-left label
  const fillBefore = (label: HTMLElement) => label.previousElementSibling?.firstElementChild as HTMLElement

  beforeEach(() => {
    // Only the clock: the programme fetch still resolves on real timers
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    useErsatztvStore.setState({
      channels: [{ id: 'etv1', name: 'Movies', streamUrl: '', logoUrl: '', number: 1, group: 'Films' }],
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.mocked(fetchErsatzTVCurrentProgramme).mockResolvedValue({ current: null, nextUp: null })
    useErsatztvStore.setState({ channels: [] })
  })

  it("shows the time left and fills the bar by the share that's been on", async () => {
    // 30 of 95 minutes in, 65 to go
    vi.mocked(fetchErsatzTVCurrentProgramme).mockResolvedValue({ current: onNow(-30, 65), nextUp: null })
    render(<TVChannelSidebar />)

    const label = await screen.findByText('1h 5m left')
    expect(parseFloat(fillBefore(label).style.width)).toBeCloseTo((30 / 95) * 100, 5)
  })

  it("says 'Ending...' with a full bar once the stop time has passed", async () => {
    vi.mocked(fetchErsatzTVCurrentProgramme).mockResolvedValue({ current: onNow(-60, -1), nextUp: null })
    render(<TVChannelSidebar />)

    const label = await screen.findByText('Ending...')
    expect(fillBefore(label).style.width).toBe('100%')
  })
})
