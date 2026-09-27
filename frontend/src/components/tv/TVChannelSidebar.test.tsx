import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup, within, fireEvent } from '@/test/utils'
import { TVChannelSidebar } from './TVChannelSidebar'
import { useChannelStore } from '@/stores/channelStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore } from '@/stores/tvStore'
import { useChannelPrefsStore } from '@/stores/channelPrefsStore'
import { SEARCH_DEBOUNCE_MS } from '@/hooks/useFilteredChannels'
import { fetchErsatzTVCurrentProgramme } from '@/services/ersatztvApi'
import type { ErsatzTVProgramme } from '@/types'
import { focusOverrides } from '@/test/focus'

// Putting a channel on live TV starts a guide lookup; leave it unanswered so
// each test sets the live guide state itself
vi.mock('@/services/api', () => ({ fetchNowPlaying: vi.fn(() => new Promise(() => {})) }))

vi.mock('@/services/ersatztvApi', () => ({
  fetchErsatzTVCurrentProgramme: vi.fn().mockResolvedValue({ current: null, nextUp: null }),
  getErsatzTVLogoUrl: vi.fn((id: string) => `/api/ersatztv/logo/${id}`),
}))

// The live row or tile, whatever is on it (its full label is tested below)
const LIVE_SLOT = /^(0 Live: |Live slot, nothing on$)/

// The sidebar scrolls the selected channel into view. The scrolling tests
// below install their own spy and delete it afterwards, which also removes
// the no-op from test/setup, so put one back before every test
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

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
    await act(async () => {})

    const tile = screen.getByRole('button', { name: '1 Movies' })
    expect(tile).toHaveClass('bg-muted', 'hover:bg-foreground/10')
    expect(tile).not.toHaveClass('hover:bg-accent')
  })

  it('sets channel numbers in the display face with tabular figures', async () => {
    render(<TVChannelSidebar isCollapsed />)
    await act(async () => {})
    expect(screen.getByRole('button', { name: '1 Movies' })).toHaveClass(
      'font-display',
      'font-extrabold',
      'tabular-nums',
    )
    cleanup()

    render(<TVChannelSidebar />)
    await act(async () => {})
    const row = screen.getByRole('button', { name: '1 Movies' })
    expect(within(row).getByText('1')).toHaveClass('font-display', 'font-extrabold', 'tabular-nums')
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
    expect(indicator.closest('button')).toBe(screen.getByRole('button', { name: LIVE_SLOT }))
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
  // Every button on the rail but the expand button is a channel tile
  return screen.getAllByRole('button').filter((button) => button.getAttribute('aria-label') !== 'Expand channel sidebar')
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
      screen.getByRole('button', { name: LIVE_SLOT }).focus()
    })

    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('0 Club')
    expect(tooltip).toHaveTextContent('Now Hockey Night')
    expect(tooltip).toHaveTextContent('Next Post-game')
  })
})

describe('TVChannelSidebar collapsed live tile', () => {
  const liveTile = () => screen.getByRole('button', { name: LIVE_SLOT })
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
    // The expanded list scrolled its own row into view on mount
    scrollIntoView.mockClear()

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

describe('TVChannelSidebar expanded list scrolling', () => {
  const scrollIntoView = vi.fn()
  const channel = (id: string) => useTVStore.getState().getUnifiedChannels().find((c) => c.id === id) ?? null

  beforeEach(() => {
    Element.prototype.scrollIntoView = scrollIntoView
    useChannelStore.setState({
      currentChannel: { id: 'live', name: 'Club', streamUrl: 'http://x/live', guideId: 'g1' },
    })
    useErsatztvStore.setState({ channels: RAIL_CHANNELS })
    useTVStore.setState({ selectedChannel: channel('etv30') })
  })

  afterEach(() => {
    cleanup()
    scrollIntoView.mockReset()
    delete (Element.prototype as Partial<Element>).scrollIntoView
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels: [] })
    useTVStore.setState({ selectedChannel: null })
  })

  it('scrolls the restored channel into view when the list mounts', async () => {
    render(<TVChannelSidebar />)
    await act(async () => {})

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    const row = screen.getByRole('button', { name: '30 Channel 30' })
    expect(scrollIntoView.mock.contexts[0]).toBe(row)
    // 'nearest' scrolling up would tuck the row under the sticky Channels header and filter
    expect(row).toHaveClass('scroll-mt-41')
  })

  it('follows the selection to its row', async () => {
    render(<TVChannelSidebar />)
    await act(async () => {})
    scrollIntoView.mockClear()

    await act(async () => {
      useTVStore.setState({ selectedChannel: channel('etv5') })
    })

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole('button', { name: '5 Channel 5' }))
  })

  it('scrolls the row into view when the rail expands', async () => {
    const { rerender } = render(<TVChannelSidebar isCollapsed />)
    await act(async () => {})
    scrollIntoView.mockClear()

    rerender(<TVChannelSidebar />)
    await act(async () => {})

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole('button', { name: '30 Channel 30' }))
  })

  it('does not scroll again when the guide refreshes', async () => {
    render(<TVChannelSidebar />)
    await act(async () => {})
    scrollIntoView.mockClear()

    await act(async () => {
      useErsatztvStore.setState({ programmesByChannel: {} })
    })

    expect(scrollIntoView).not.toHaveBeenCalled()
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

  const liveRow = () => screen.getByRole('button', { name: LIVE_SLOT })

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
    const row = screen.getByRole('button', { name: LIVE_SLOT })
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
    expect(screen.getByRole('button', { name: LIVE_SLOT })).toHaveTextContent(
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

  function programme(id: string, title: string, startOffsetMin: number, stopOffsetMin: number): ErsatzTVProgramme {
    return {
      id,
      channelId: 'etv1',
      title,
      start: new Date(NOW + startOffsetMin * MINUTE).toISOString(),
      stop: new Date(NOW + stopOffsetMin * MINUTE).toISOString(),
    }
  }

  const row = () => screen.getByRole('button', { name: '1 Movies' })
  // The bar's fill sits in the track just before the time-left label
  const fillBefore = (label: HTMLElement) => label.previousElementSibling?.firstElementChild as HTMLElement

  beforeEach(() => {
    // The clock and its 30s interval, so the tick can be stepped
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(NOW)
    useErsatztvStore.setState({
      channels: [{ id: 'etv1', name: 'Movies', streamUrl: '', logoUrl: '', number: 1, group: 'Films' }],
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.mocked(fetchErsatzTVCurrentProgramme).mockClear()
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels: [], programmesByChannel: {} })
  })

  it("shows the title and time left from the guide's programmes and fills the bar by the share that's been on", async () => {
    // 30 of 95 minutes in, 65 to go
    useErsatztvStore.setState({ programmesByChannel: { etv1: [programme('p1', 'Evening News', -30, 65)] } })
    render(<TVChannelSidebar />)
    await act(async () => {})

    expect(row()).toHaveTextContent('Evening News')
    const label = screen.getByText('1h 5m left')
    expect(parseFloat(fillBefore(label).style.width)).toBeCloseTo((30 / 95) * 100, 5)
  })

  it('never asks the backend for current programmes, even as the clock ticks', async () => {
    useErsatztvStore.setState({ programmesByChannel: { etv1: [programme('p1', 'Evening News', -30, 65)] } })
    render(<TVChannelSidebar />)
    await act(async () => {})
    await act(() => vi.advanceTimersByTimeAsync(5 * MINUTE))

    expect(fetchErsatzTVCurrentProgramme).not.toHaveBeenCalled()
  })

  it('counts down on the 30s tick and moves to the next programme at its start', async () => {
    useErsatztvStore.setState({
      programmesByChannel: {
        etv1: [programme('p1', 'Evening News', -30, 1), programme('p2', 'Late Movie', 1, 91)],
      },
    })
    render(<TVChannelSidebar />)
    await act(async () => {})
    expect(row()).toHaveTextContent('Evening News')
    expect(row()).toHaveTextContent('1m left')

    // 30s later the news has 30s to go, which still rounds up to a minute
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(row()).toHaveTextContent('Evening News')
    expect(row()).toHaveTextContent('1m left')

    // The next tick lands on the stop instant, where the movie takes over
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(row()).toHaveTextContent('Late Movie')
    expect(row()).not.toHaveTextContent('Evening News')
    expect(row()).toHaveTextContent('1h 30m left')
  })

  it('shows no bar in a gap between programmes', async () => {
    useErsatztvStore.setState({
      programmesByChannel: {
        etv1: [programme('p1', 'Evening News', -60, -5), programme('p2', 'Late Movie', 10, 100)],
      },
    })
    render(<TVChannelSidebar />)
    await act(async () => {})

    expect(row()).not.toHaveTextContent('Evening News')
    expect(screen.queryByText(/ left$/)).toBeNull()
  })

  it('shows the next programme with its start time under the progress bar', async () => {
    useErsatztvStore.setState({
      programmesByChannel: {
        etv1: [programme('p1', 'Evening News', -30, 65), programme('p2', 'Late Movie', 65, 155)],
      },
    })
    render(<TVChannelSidebar />)
    await act(async () => {})

    const startsAt = new Date(NOW + 65 * MINUTE).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const nextLine = within(row()).getByText(`Next ${startsAt} · Late Movie`)
    // After the bar and its time-left label
    expect(nextLine.previousElementSibling).toHaveTextContent('1h 5m left')
  })

  it('shows what comes after a gap on the Next line', async () => {
    useErsatztvStore.setState({
      programmesByChannel: {
        etv1: [programme('p1', 'Evening News', -60, -5), programme('p2', 'Late Movie', 10, 100)],
      },
    })
    render(<TVChannelSidebar />)
    await act(async () => {})

    expect(row()).toHaveTextContent(/Next .* · Late Movie/)
  })

  it('keeps an empty Next line of the same height until the guide arrives, so rows do not jump', async () => {
    render(<TVChannelSidebar />)
    await act(async () => {})
    const emptyLine = row().querySelector('p.h-4')
    expect(emptyLine).not.toBeNull()
    expect(emptyLine).toBeEmptyDOMElement()

    await act(async () => {
      useErsatztvStore.setState({
        programmesByChannel: {
          etv1: [programme('p1', 'Evening News', -30, 65), programme('p2', 'Late Movie', 65, 155)],
        },
      })
    })

    const filledLine = row().querySelector('p.h-4')
    expect(filledLine).toHaveTextContent('Late Movie')
    expect(filledLine).toHaveClass('h-4', 'leading-4', 'truncate')
  })

  it('has no Next line on the live row', async () => {
    useChannelStore.setState({
      currentChannel: { id: 'live', name: 'Club', streamUrl: 'http://x/live', guideId: 'g1' },
    })
    render(<TVChannelSidebar />)
    await act(async () => {})

    expect(screen.getByRole('button', { name: LIVE_SLOT })).not.toHaveTextContent('Next')
  })

  it('follows a refresh of the guide programmes', async () => {
    useErsatztvStore.setState({ programmesByChannel: { etv1: [programme('p1', 'Evening News', -30, 65)] } })
    render(<TVChannelSidebar />)
    await act(async () => {})

    await act(async () => {
      useErsatztvStore.setState({ programmesByChannel: { etv1: [programme('p9', 'Breaking News', -5, 25)] } })
    })

    expect(row()).toHaveTextContent('Breaking News')
    expect(row()).toHaveTextContent('25m left')
  })
})

describe('TVChannelSidebar focus', () => {
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
  })

  it('leaves the collapse and expand buttons to the global outline', async () => {
    const { rerender } = render(<TVChannelSidebar />)
    await act(async () => {})
    expect(focusOverrides(screen.getByRole('button', { name: 'Collapse channel sidebar' }))).toEqual([])

    rerender(<TVChannelSidebar isCollapsed />)
    await act(async () => {})
    expect(focusOverrides(screen.getByRole('button', { name: 'Expand channel sidebar' }))).toEqual([])
  })

  it('insets the keyboard outline on channel rows and marks focus without a click-time accent fill', async () => {
    render(<TVChannelSidebar />)
    await act(async () => {})

    for (const name of [LIVE_SLOT, '1 Movies']) {
      const row = screen.getByRole('button', { name })
      expect(row).toHaveClass('focus-visible:-outline-offset-2')
      expect(row).not.toHaveClass('focus:bg-accent')
      expect(focusOverrides(row)).toEqual([])
    }
  })

  it('insets the keyboard outline on collapsed rail tiles', async () => {
    render(<TVChannelSidebar isCollapsed />)
    await act(async () => {})

    for (const tile of railTiles()) {
      expect(tile).toHaveClass('focus-visible:-outline-offset-2')
      expect(focusOverrides(tile)).toEqual([])
    }
  })
})

describe('TVChannelSidebar loading and error states', () => {
  const realLoadChannels = useErsatztvStore.getState().loadChannels

  beforeEach(() => {
    useChannelStore.setState({
      currentChannel: { id: 'live', name: 'Club', streamUrl: 'http://x/live', guideId: 'g1' },
    })
  })

  afterEach(() => {
    cleanup()
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels: [], channelsLoading: false, error: null, loadChannels: realLoadChannels })
  })

  it('shows skeleton rows under the live row while the channels load', async () => {
    useErsatztvStore.setState({ channels: [], channelsLoading: true, error: null })
    render(<TVChannelSidebar />)
    await act(async () => {})

    const loading = screen.getByRole('status')
    expect(loading).toHaveTextContent('Loading channels')
    expect(within(loading).getByText('Loading channels')).toHaveClass('sr-only')
    expect(loading.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(6)
    expect(screen.queryByText(/Loading additional channels/)).toBeNull()
    // The live row doesn't wait for ErsatzTV
    expect(screen.getByRole('button', { name: LIVE_SLOT })).toBeVisible()
  })

  it('shows no skeleton once channels are there, even during a reload', async () => {
    useErsatztvStore.setState({
      channels: [{ id: 'etv1', name: 'Movies', streamUrl: '', logoUrl: '', number: 1, group: 'Films' }],
      channelsLoading: true,
    })
    render(<TVChannelSidebar />)
    await act(async () => {})
    expect(screen.queryByTestId('sidebar-skeleton')).toBeNull()
  })

  it('shows an inline error card whose Retry reloads the channels', async () => {
    const loadChannels = vi.fn().mockResolvedValue(undefined)
    useErsatztvStore.setState({ channels: [], channelsLoading: false, error: 'HTTP 503', loadChannels })
    render(<TVChannelSidebar />)
    await act(async () => {})

    expect(screen.getByText("Couldn't load channels 1-36")).toHaveClass('text-destructive')
    expect(screen.queryByTestId('sidebar-skeleton')).toBeNull()
    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(retry).toHaveAttribute('data-variant', 'outline')
    act(() => retry.click())
    expect(loadChannels).toHaveBeenCalledTimes(1)
  })
})

describe('TVChannelSidebar keyboard and screen reader', () => {
  const CHANNELS = [
    { id: 'etv1', name: 'Movies', streamUrl: '', logoUrl: '', number: 1, group: 'Films' },
    { id: 'etv2', name: 'Cartoons', streamUrl: '', logoUrl: '', number: 2, group: 'Kids' },
    { id: 'etv3', name: 'News', streamUrl: '', logoUrl: '', number: 3, group: 'News' },
  ]

  beforeEach(() => {
    useChannelStore.setState({
      currentChannel: { id: 'live', name: 'TSN 5', streamUrl: 'http://x/live', guideId: 'g1' },
    })
    useErsatztvStore.setState({ channels: CHANNELS })
  })

  afterEach(() => {
    cleanup()
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels: [] })
    useTVStore.setState({ selectedChannel: null, liveEPG: null, liveEPGStatus: 'idle' })
  })

  function select(index: number) {
    useTVStore.setState({ selectedChannel: useTVStore.getState().getUnifiedChannels()[index] })
  }

  // The channels' own buttons: not the search's, the stars, the collapse toggle or Pick a channel
  const channelButtons = () =>
    screen.getAllByRole('button').filter((button) =>
      !button.closest('[role="search"]') &&
      !/channel sidebar|Pick a channel|^Favourite /.test(button.getAttribute('aria-label') ?? button.textContent ?? ''))

  it.each([false, true])('names the live slot with its channel and programme (rail: %s)', async (isCollapsed) => {
    useTVStore.setState({ liveEPGStatus: 'ok' })
    render(<TVChannelSidebar isCollapsed={isCollapsed} liveEPGTitle="Hockey Night" />)
    await act(async () => {})

    expect(screen.getByRole('button', { name: '0 Live: TSN 5, Hockey Night' })).toBeInTheDocument()
  })

  it('says why there is no programme in the live label when the guide has none', async () => {
    useTVStore.setState({ liveEPGStatus: 'unavailable' })
    render(<TVChannelSidebar />)
    await act(async () => {})

    expect(screen.getByRole('button', { name: '0 Live: TSN 5, Guide unavailable' })).toBeInTheDocument()
  })

  it.each([false, true])('names the empty live slot as such (rail: %s)', async (isCollapsed) => {
    useChannelStore.setState({ currentChannel: null })
    render(<TVChannelSidebar isCollapsed={isCollapsed} onPickLive={vi.fn()} />)
    await act(async () => {})

    expect(screen.getByRole('button', { name: 'Live slot, nothing on' })).toBeInTheDocument()
  })

  it.each([false, true])('marks the watched channel with aria-current instead of aria-pressed (rail: %s)', async (isCollapsed) => {
    select(2)
    render(<TVChannelSidebar isCollapsed={isCollapsed} />)
    await act(async () => {})

    const current = channelButtons().filter((button) => button.hasAttribute('aria-current'))
    expect(current).toEqual([screen.getByRole('button', { name: '2 Cartoons' })])
    expect(current[0]).toHaveAttribute('aria-current', 'true')
    for (const button of channelButtons()) {
      expect(button).not.toHaveAttribute('aria-pressed')
    }
  })

  it.each([false, true])('gives the channels a single tab stop and moves focus with the arrow keys, Home and End (rail: %s)', async (isCollapsed) => {
    render(<TVChannelSidebar isCollapsed={isCollapsed} />)
    await act(async () => {})

    const buttons = channelButtons()
    expect(buttons).toHaveLength(4)
    const tabStops = () => buttons.filter((button) => button.tabIndex === 0)
    expect(tabStops()).toEqual([buttons[0]])

    await act(async () => {
      buttons[0].focus()
    })
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    })
    expect(document.activeElement).toBe(buttons[1])
    expect(tabStops()).toEqual([buttons[1]])

    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: 'End' })
    })
    expect(document.activeElement).toBe(buttons[3])

    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    })
    expect(document.activeElement).toBe(buttons[2])

    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    })
    expect(document.activeElement).toBe(buttons[0])
    expect(tabStops()).toEqual([buttons[0]])
  })

  it('moves the tab stop to a channel focused by other means, such as a click', async () => {
    render(<TVChannelSidebar />)
    await act(async () => {})

    const news = screen.getByRole('button', { name: '3 News' })
    await act(async () => {
      news.focus()
    })

    expect(news).toHaveAttribute('tabindex', '0')
    expect(channelButtons().filter((button) => button.tabIndex === 0)).toEqual([news])
  })

  it('keeps the tab stop on the same channel when the list around it changes', async () => {
    render(<TVChannelSidebar />)
    await act(async () => {})
    await act(async () => {
      screen.getByRole('button', { name: '2 Cartoons' }).focus()
    })

    // A channel is added before it, so it moves down a place
    act(() => useErsatztvStore.setState({
      channels: [{ id: 'etv4', name: 'Sports', streamUrl: '', logoUrl: '', number: 4, group: 'Sports' }, ...CHANNELS],
    }))
    await act(async () => {})

    expect(screen.getByRole('button', { name: '2 Cartoons' })).toHaveAttribute('tabindex', '0')
    expect(channelButtons().filter((button) => button.tabIndex === 0)).toHaveLength(1)
  })

  it('leaves Enter and Space to the focused row or Pick a channel button, which activate natively', async () => {
    useChannelStore.setState({ currentChannel: null })
    const onPickLive = vi.fn()
    render(<TVChannelSidebar onPickLive={onPickLive} />)
    await act(async () => {})

    const pick = screen.getByRole('button', { name: 'Pick a channel' })
    pick.focus()
    for (const key of ['Enter', ' ']) {
      // fireEvent returns false when a handler called preventDefault
      expect(fireEvent.keyDown(pick, { key })).toBe(true)
    }
    const row = screen.getByRole('button', { name: '1 Movies' })
    expect(fireEvent.keyDown(row, { key: 'Enter' })).toBe(true)
  })
})

describe('TVChannelSidebar search and filter chips', () => {
  const MINUTE = 60_000
  const CHANNELS = [
    { id: 'etv1', name: 'Movies', streamUrl: '', logoUrl: '', number: 1, group: 'Films' },
    { id: 'etv2', name: 'Cartoons', streamUrl: '', logoUrl: '', number: 2, group: 'Kids' },
    { id: 'etv3', name: 'News', streamUrl: '', logoUrl: '', number: 3, group: 'News' },
    { id: 'etv4', name: 'Classics', streamUrl: '', logoUrl: '', number: 4, group: 'TV' },
  ]

  function programme(channelId: string, title: string, startOffsetMin: number, durationMin: number): ErsatzTVProgramme {
    const now = Date.now()
    return {
      id: `${channelId}-${startOffsetMin}`,
      channelId,
      title,
      start: new Date(now + startOffsetMin * MINUTE).toISOString(),
      stop: new Date(now + (startOffsetMin + durationMin) * MINUTE).toISOString(),
    }
  }

  // The rows' main buttons, in order (not the search, the stars or Pick a channel)
  const rowNames = () =>
    within(screen.getByRole('list'))
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('aria-label') && !/^Favourite /.test(button.getAttribute('aria-label')!))
      .map((button) => button.getAttribute('aria-label'))

  const search = () => screen.getByRole('textbox', { name: 'Search channels and shows' })

  async function type(text: string) {
    fireEvent.change(search(), { target: { value: text } })
    // The list follows once typing pauses
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 20))
    })
  }

  beforeEach(() => {
    useChannelStore.setState({
      currentChannel: { id: 'live', name: 'TSN 5', streamUrl: 'http://x/live', guideId: 'g1' },
    })
    useErsatztvStore.setState({
      channels: CHANNELS,
      programmesByChannel: {
        etv2: [programme('etv2', 'The Simpsons', -10, 30)],
        // Airs later tonight, within the 12 hours searched
        etv4: [programme('etv4', 'Classic Simpsons', 180, 30)],
        // Too far ahead to match
        etv3: [programme('etv3', 'Simpsons Retrospective', 13 * 60, 60)],
      },
    })
    useTVStore.setState({ liveEPGStatus: 'ok' })
  })

  afterEach(() => {
    cleanup()
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels: [], programmesByChannel: {} })
    useTVStore.setState({ selectedChannel: null, liveEPGStatus: 'idle' })
    useChannelPrefsStore.setState({ favouriteChannelIds: [], recentChannelIds: [], filter: { query: '', mode: 'all' } })
  })

  it("typing 'simpsons' leaves row 0 and the channels airing it in the next 12 hours", async () => {
    render(<TVChannelSidebar liveEPGTitle="Hockey Night" />)
    await act(async () => {})

    await type('simpsons')

    expect(rowNames()).toEqual(['0 Live: TSN 5, Hockey Night', '2 Cartoons', '4 Classics'])
  })

  it('waits for typing to pause before filtering', async () => {
    render(<TVChannelSidebar />)
    await act(async () => {})

    fireEvent.change(search(), { target: { value: 'news' } })
    // The box shows the keystroke straight away; the list hasn't moved yet
    expect(search()).toHaveValue('news')
    expect(rowNames()).toHaveLength(5)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 20))
    })
    expect(rowNames()).toHaveLength(2)
  })

  it('matches channel names and numbers too', async () => {
    render(<TVChannelSidebar />)
    await act(async () => {})

    await type('cart')
    expect(rowNames()).toEqual([expect.stringMatching(/^0 /), '2 Cartoons'])

    await type('3')
    expect(rowNames()).toEqual([expect.stringMatching(/^0 /), '3 News'])
  })

  it('clears the query from the box, and returns focus to it', async () => {
    render(<TVChannelSidebar />)
    await act(async () => {})
    await type('news')

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    await type('')

    expect(search()).toHaveValue('')
    expect(document.activeElement).toBe(search())
    expect(rowNames()).toHaveLength(5)
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
  })

  it("says when nothing matches, and Clear brings every channel back", async () => {
    useChannelPrefsStore.setState({ favouriteChannelIds: ['etv1'] })
    render(<TVChannelSidebar />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Favourites' }))
    await type('zzz')

    expect(screen.getByText('No channels match')).toBeInTheDocument()
    expect(rowNames()).toEqual([expect.stringMatching(/^0 /)])

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await type('')

    expect(screen.queryByText('No channels match')).toBeNull()
    expect(rowNames()).toHaveLength(5)
    expect(useChannelPrefsStore.getState().filter).toEqual({ query: '', mode: 'all' })
  })

  it('shows only the favourites, row 0 first, with the Favourites chip pressed', async () => {
    useChannelPrefsStore.setState({ favouriteChannelIds: ['etv3', 'etv1'] })
    render(<TVChannelSidebar />)
    await act(async () => {})

    const all = screen.getByRole('button', { name: 'All' })
    const favourites = screen.getByRole('button', { name: 'Favourites' })
    expect(all).toHaveAttribute('aria-pressed', 'true')
    expect(favourites).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(favourites)

    expect(favourites).toHaveAttribute('aria-pressed', 'true')
    expect(all).toHaveAttribute('aria-pressed', 'false')
    expect(rowNames()).toEqual([expect.stringMatching(/^0 /), '1 Movies', '3 News'])

    // Pressing it again goes back to every channel
    fireEvent.click(favourites)
    expect(all).toHaveAttribute('aria-pressed', 'true')
    expect(rowNames()).toHaveLength(5)
  })

  it('lists recent channels most recent first', async () => {
    render(<TVChannelSidebar />)
    await act(async () => {})

    // Picked in the list: News, then Movies, then Classics
    for (const name of ['3 News', '1 Movies', '4 Classics']) {
      fireEvent.click(screen.getByRole('button', { name }))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Recent' }))

    expect(rowNames()).toEqual([expect.stringMatching(/^0 /), '4 Classics', '1 Movies', '3 News'])
  })

  it('keeps the filter in the store, so it is still there when the list comes back', async () => {
    const { unmount } = render(<TVChannelSidebar />)
    await act(async () => {})
    await type('news')
    unmount()

    render(<TVChannelSidebar />)
    await act(async () => {})

    expect(search()).toHaveValue('news')
    expect(rowNames()).toEqual([expect.stringMatching(/^0 /), '3 News'])
  })

  it('lists every channel on the collapsed rail, which has no search box', async () => {
    useChannelPrefsStore.setState({ filter: { query: 'news', mode: 'all' } })
    render(<TVChannelSidebar isCollapsed />)
    await act(async () => {})

    expect(screen.queryByRole('search')).toBeNull()
    expect(railTiles()).toHaveLength(5)
  })
})

describe('TVChannelSidebar favourites', () => {
  const CHANNELS = [
    { id: 'etv1', name: 'Movies', streamUrl: '', logoUrl: '', number: 1, group: 'Films' },
    { id: 'etv2', name: 'Cartoons', streamUrl: '', logoUrl: '', number: 2, group: 'Kids' },
    { id: 'etv3', name: 'News', streamUrl: '', logoUrl: '', number: 3, group: 'News' },
  ]

  beforeEach(() => {
    useChannelStore.setState({
      currentChannel: { id: 'live', name: 'TSN 5', streamUrl: 'http://x/live', guideId: 'g1' },
    })
    useErsatztvStore.setState({ channels: CHANNELS })
  })

  afterEach(() => {
    cleanup()
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels: [] })
    useTVStore.setState({ selectedChannel: null })
    useChannelPrefsStore.setState({ favouriteChannelIds: [], recentChannelIds: [], filter: { query: '', mode: 'all' } })
  })

  it('stars a channel with a toggle beside its row, without tuning to it', async () => {
    const selectChannel = vi.spyOn(useTVStore.getState(), 'selectChannel')
    render(<TVChannelSidebar />)
    await act(async () => {})

    const star = screen.getByRole('button', { name: 'Favourite Cartoons' })
    expect(star).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(star)

    expect(star).toHaveAttribute('aria-pressed', 'true')
    expect(useChannelPrefsStore.getState().favouriteChannelIds).toEqual(['etv2'])
    expect(selectChannel).not.toHaveBeenCalled()
    expect(useTVStore.getState().selectedChannel).toBeNull()

    fireEvent.click(star)
    expect(star).toHaveAttribute('aria-pressed', 'false')
    expect(useChannelPrefsStore.getState().favouriteChannelIds).toEqual([])
    selectChannel.mockRestore()
  })

  it("puts the star beside the row's button, not inside it, and none on the live row", async () => {
    render(<TVChannelSidebar />)
    await act(async () => {})

    const row = screen.getByRole('button', { name: '2 Cartoons' })
    const star = screen.getByRole('button', { name: 'Favourite Cartoons' })
    expect(row.contains(star)).toBe(false)
    expect(star.parentElement).toBe(row.parentElement)
    expect(row.parentElement?.tagName).toBe('LI')
    expect(screen.getAllByRole('button', { name: /^Favourite / })).toHaveLength(3)
  })

  it("shares the row's tab stop, so the list stays one Tab stop long", async () => {
    render(<TVChannelSidebar />)
    await act(async () => {})

    await act(async () => {
      screen.getByRole('button', { name: '2 Cartoons' }).focus()
    })

    const stars = screen.getAllByRole('button', { name: /^Favourite / })
    expect(stars.filter((star) => star.tabIndex === 0)).toEqual([screen.getByRole('button', { name: 'Favourite Cartoons' })])
  })

  it('puts the favourites first on the collapsed rail, after the live slot, and marks them', async () => {
    useChannelPrefsStore.setState({ favouriteChannelIds: ['etv3', 'etv2'] })
    render(<TVChannelSidebar isCollapsed />)
    await act(async () => {})

    expect(railTiles().map((tile) => tile.getAttribute('aria-label'))).toEqual([
      expect.stringMatching(/^0 Live: /),
      '2 Cartoons, favourite',
      '3 News, favourite',
      '1 Movies',
    ])
    expect(screen.getAllByTestId('favourite-mark')).toHaveLength(2)
  })

  it('keeps the expanded list in channel order', async () => {
    useChannelPrefsStore.setState({ favouriteChannelIds: ['etv3'] })
    render(<TVChannelSidebar />)
    await act(async () => {})

    const rows = within(screen.getByRole('list'))
      .getAllByRole('button')
      .filter((button) => !/^Favourite /.test(button.getAttribute('aria-label') ?? ''))
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      expect.stringMatching(/^0 Live: /),
      '1 Movies',
      '2 Cartoons',
      '3 News',
    ])
  })
})
