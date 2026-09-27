import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup, within } from '@/test/utils'
import { TVChannelSidebar } from './TVChannelSidebar'
import { useChannelStore } from '@/stores/channelStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore } from '@/stores/tvStore'
import type { ErsatzTVProgramme } from '@/types'

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
