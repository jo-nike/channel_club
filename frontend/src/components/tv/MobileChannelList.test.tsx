import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@/test/utils'
import { MobileChannelList } from './MobileChannelList'
import { useChannelStore } from '@/stores/channelStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore } from '@/stores/tvStore'

vi.mock('@/services/api', () => ({ fetchNowPlaying: vi.fn(() => new Promise(() => {})) }))
vi.mock('@/services/ersatztvApi', () => ({
  getErsatzTVLogoUrl: vi.fn((id: string) => `/api/ersatztv/logo/${id}`),
}))

describe('MobileChannelList', () => {
  beforeEach(() => {
    useChannelStore.setState({
      currentChannel: { id: 'live', name: 'Club', streamUrl: 'http://x/live', guideId: 'g1' },
    })
    useErsatztvStore.setState({
      channels: [
        { id: 'etv1', name: 'Movies', streamUrl: '/etv1', logoUrl: '', number: 1, group: 'Films' },
        { id: 'etv2', name: 'Cartoons', streamUrl: '/etv2', logoUrl: '', number: 2, group: 'Kids' },
      ],
      programmesByChannel: {},
    })
    useTVStore.setState({ selectedChannel: null, liveEPG: null, liveEPGStatus: 'idle' })
  })

  afterEach(() => {
    cleanup()
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels: [], programmesByChannel: {} })
  })

  it('calls onChannelSelect with the tapped row', () => {
    const onChannelSelect = vi.fn()
    render(<MobileChannelList onChannelSelect={onChannelSelect} />)

    fireEvent.click(screen.getByText('Cartoons').closest('button') as HTMLElement)

    expect(onChannelSelect).toHaveBeenCalledTimes(1)
    expect(onChannelSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'etv2', type: 'ersatztv' }))
  })

  it('calls onChannelSelect with the live slot when its card is tapped', () => {
    const onChannelSelect = vi.fn()
    render(<MobileChannelList onChannelSelect={onChannelSelect} liveEPGTitle="Big Game" />)

    fireEvent.click(screen.getByText('Big Game').closest('button') as HTMLElement)

    expect(onChannelSelect).toHaveBeenCalledWith(expect.objectContaining({ type: 'live', name: 'Club' }))
  })
})
