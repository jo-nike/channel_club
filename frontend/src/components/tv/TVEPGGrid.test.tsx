import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@/test/utils'
import { TVEPGGrid } from './TVEPGGrid'
import { focusOverrides } from '@/test/focus'
import { useChannelStore } from '@/stores/channelStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore } from '@/stores/tvStore'
import type { EPGResponse, ErsatzTVProgramme } from '@/types'

// Putting a channel on live TV starts a guide lookup; leave it unanswered so
// each test sets the live guide state itself
vi.mock('@/services/api', () => ({ fetchNowPlaying: vi.fn(() => new Promise(() => {})) }))

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

  it('paints ErsatzTV programmes on the guide-future token with a border, not the accent', () => {
    render(<TVEPGGrid programmesByChannel={programmesByChannel} liveEPG={liveEPG} />)

    const block = screen.getByText('Movie Night').closest('button')
    expect(block).toHaveClass('bg-guide-future', 'text-foreground', 'border', 'border-border')
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
