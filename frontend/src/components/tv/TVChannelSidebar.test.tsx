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
})
