import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@/test/utils'
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
    vi.useRealTimers()
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

  it('numbers every row, including channels with a logo and the live slot', () => {
    useErsatztvStore.setState({
      channels: [
        { id: 'etv1', name: 'Movies', streamUrl: '/etv1', logoUrl: '/logo/etv1', number: 1, group: 'Films' },
        { id: 'etv2', name: 'Cartoons', streamUrl: '/etv2', logoUrl: '', number: 2, group: 'Kids' },
      ],
    })
    render(<MobileChannelList onChannelSelect={vi.fn()} />)

    const row = (name: string) => screen.getByText(name).closest('button') as HTMLElement
    // The number sits in its own column, in the display face, before the logo
    const number = (name: string) => row(name).firstElementChild as HTMLElement
    expect(number('Movies')).toHaveTextContent(/^1$/)
    expect(row('Movies').querySelector('img')).not.toBeNull()
    expect(number('Cartoons')).toHaveTextContent(/^2$/)
    expect(number('Club')).toHaveTextContent(/^0$/)
    expect(number('Movies')).toHaveClass('font-display', 'tabular-nums')
  })

  it('marks the selected row by its number in the primary colour', () => {
    useTVStore.setState({ selectedChannel: { id: 'etv2', name: 'Cartoons', number: 2, streamUrl: '/etv2', type: 'ersatztv' } })
    render(<MobileChannelList onChannelSelect={vi.fn()} />)

    const number = (name: string) => (screen.getByText(name).closest('button') as HTMLElement).firstElementChild
    expect(number('Cartoons')).toHaveClass('text-primary')
    expect(number('Movies')).toHaveClass('text-muted-foreground')
  })

  it('uses denser rows: p-2 padding and a 40px logo box', () => {
    render(<MobileChannelList onChannelSelect={vi.fn()} />)

    const row = screen.getByText('Movies').closest('button') as HTMLElement
    expect(row).toHaveClass('p-2')
    expect(row).not.toHaveClass('p-3')
    const logoBox = row.children[1]
    expect(logoBox).toHaveClass('h-10', 'w-10')
  })

  it('sets the LIVE badge and the time left at 12px', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'))
    useErsatztvStore.setState({ programmesByChannel: { etv1: [
      { id: 'p1', channelId: 'etv1', title: 'First', start: '2026-09-06T11:00:00Z', stop: '2026-09-06T12:30:00Z' },
    ] } })
    render(<MobileChannelList onChannelSelect={vi.fn()} />)

    expect(screen.getByText('Live', { selector: 'span' })).toHaveClass('text-xs')
    expect(screen.getByText('30m left')).toHaveClass('text-xs')
  })

  it("shows each channel's programme and time left, moving on with the programme clock", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'))
    useErsatztvStore.setState({ programmesByChannel: { etv1: [
      { id: 'p1', channelId: 'etv1', title: 'First', start: '2026-09-06T11:00:00Z', stop: '2026-09-06T12:00:10Z' },
      { id: 'p2', channelId: 'etv1', title: 'Second', start: '2026-09-06T12:00:10Z', stop: '2026-09-06T13:00:00Z' },
    ] } })
    render(<MobileChannelList onChannelSelect={vi.fn()} />)

    expect(screen.getByText('First')).toBeVisible()
    expect(screen.getByText('1m left')).toBeVisible()
    // Cartoons has no schedule, so it shows its group
    expect(screen.getByText('Kids')).toBeVisible()

    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(screen.getByText('Second')).toBeVisible()
    expect(screen.getByText('1h left')).toBeVisible()
    expect(screen.queryByText('First')).not.toBeInTheDocument()
  })

  it('reserves room under the last row for the install banner', () => {
    const { container } = render(<MobileChannelList onChannelSelect={vi.fn()} />)
    // --install-prompt-h is set on <html> only while the banner shows; 0px otherwise
    expect(container.firstElementChild).toHaveClass('pb-[calc(1rem+var(--install-prompt-h,0px))]')
  })
})
