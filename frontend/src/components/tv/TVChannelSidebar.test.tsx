import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup } from '@/test/utils'
import { TVChannelSidebar } from './TVChannelSidebar'
import { useChannelStore } from '@/stores/channelStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'

vi.mock('@/services/ersatztvApi', () => ({
  fetchErsatzTVCurrentProgramme: vi.fn().mockResolvedValue({ current: null, nextUp: null }),
  getErsatzTVLogoUrl: vi.fn(() => ''),
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
    useErsatztvStore.setState({ channels: [] })
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
