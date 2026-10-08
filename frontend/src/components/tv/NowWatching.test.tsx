import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@/test/utils'
import { NowWatching } from './NowWatching'
import { useChannelStore } from '@/stores/channelStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore } from '@/stores/tvStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import type { UnifiedChannel } from '@/types'

vi.mock('@/services/api', () => ({ fetchNowPlaying: vi.fn(() => new Promise(() => {})) }))

const cinema: UnifiedChannel = { id: 'e', name: 'Cinema', number: 4, streamUrl: '/e', type: 'ersatztv' }
const liveSlot: UnifiedChannel = { id: 'live-channel-0', name: 'CA-S: TSN 5', number: 0, streamUrl: '/a', type: 'live' }
const emptyLiveSlot: UnifiedChannel = { id: 'live-channel-0', name: 'Live', number: 0, streamUrl: '', type: 'live' }

function setLiveChannel(on: boolean) {
  useChannelStore.setState({ currentChannel: on ? { id: 'a', name: 'CA-S: TSN 5', streamUrl: '/a', guideId: 'g' } : null })
}

describe('NowWatching', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'))
    setLiveChannel(false)
    useErsatztvStore.setState({ programmesByChannel: { e: [
      { id: 'p1', channelId: 'e', title: 'The Lord of the Rings: The War of the Rohirrim', start: '2026-09-06T11:00:00Z', stop: '2026-09-06T12:32:00Z' },
    ] } })
    useTVStore.setState({ selectedChannel: null, liveEPG: null, liveEPGStatus: 'idle' })
    useUIStore.setState({ isChannelSidebarCollapsed: false })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    setLiveChannel(false)
    useErsatztvStore.setState({ programmesByChannel: {} })
    useTVStore.setState({ selectedChannel: null, liveEPG: null, liveEPGStatus: 'idle' })
  })

  it('shows the programme, then the channel number, name and time left', () => {
    useTVStore.setState({ selectedChannel: cinema })
    render(<NowWatching isMobile={false} />)

    expect(screen.getByText('The Lord of the Rings: The War of the Rohirrim')).toHaveClass('truncate', 'font-medium')
    expect(screen.getByText('CH 4 · Cinema · 32m left')).toHaveClass('truncate', 'text-xs', 'text-muted-foreground')
    expect(screen.queryByText('Live')).not.toBeInTheDocument()
  })

  it('lets both lines shrink and truncate instead of growing the header', () => {
    useTVStore.setState({ selectedChannel: cinema })
    render(<NowWatching isMobile={false} />)

    const block = screen.getByTestId('now-watching')
    expect(block).toHaveClass('min-w-0', 'flex-1')
    const lines = block.querySelectorAll('p')
    expect(lines).toHaveLength(2)
    lines.forEach((line) => expect(line).toHaveClass('truncate'))
  })

  it('falls back to the channel name when the schedule has nothing on', () => {
    useErsatztvStore.setState({ programmesByChannel: {} })
    useTVStore.setState({ selectedChannel: cinema })
    render(<NowWatching isMobile={false} />)

    expect(screen.getByText('Cinema')).toHaveClass('font-medium')
    expect(screen.getByText('CH 4')).toBeInTheDocument()
  })

  it('marks channel 0 LIVE as the club channel, with its programme', () => {
    setLiveChannel(true)
    useTVStore.setState({
      selectedChannel: liveSlot,
      liveEPGStatus: 'ok',
      liveEPG: { channelId: 'g', currentProgram: {
        title: 'CFL Football: Stampeders at Redblacks', startTime: '2026-09-06T11:00:00Z', endTime: '2026-09-06T13:05:00Z',
      } },
    })
    render(<NowWatching isMobile={false} />)

    expect(screen.getByText('CFL Football: Stampeders at Redblacks')).toBeInTheDocument()
    expect(screen.getByText('Live')).toHaveClass('bg-live', 'text-live-foreground')
    expect(screen.getByText('Live')).toBe(screen.getByTestId('live-pill'))
    expect(screen.getByText('Club channel · CA-S: TSN 5 · 1h 5m left')).toBeInTheDocument()
    expect(screen.queryByText(/CH 0/)).not.toBeInTheDocument()
  })

  it.each([
    ['unavailable', 'Guide unavailable'],
    ['empty', 'No guide info'],
    ['loading', 'Loading guide...'],
  ] as const)('names the live channel and says why there is no programme when the guide is %s', (status, copy) => {
    setLiveChannel(true)
    useTVStore.setState({ selectedChannel: liveSlot, liveEPG: null, liveEPGStatus: status })
    render(<NowWatching isMobile={false} />)

    expect(screen.getByText('CA-S: TSN 5')).toHaveClass('font-medium')
    expect(screen.getByText(`Club channel · ${copy}`)).toBeInTheDocument()
    expect(screen.getByText('Live')).toHaveClass('bg-live')
    expect(screen.queryByText(/Now broadcasting/)).not.toBeInTheDocument()
  })

  it('shows channel 0 without the LIVE pill while nothing is on live TV', () => {
    useTVStore.setState({ selectedChannel: emptyLiveSlot })
    render(<NowWatching isMobile={false} />)

    // Line 1 is the empty slot's name, as in the channel list
    expect(screen.getByText('Live')).toHaveClass('font-medium')
    expect(screen.getByText('CH 0 · Nothing on yet')).toBeInTheDocument()
    expect(screen.getByTestId('now-watching').querySelector('.bg-live')).toBeNull()
    expect(screen.queryByText(/Club channel/)).not.toBeInTheDocument()
  })

  it('says there are no channels yet, with no skeleton, while neither source is set up', () => {
    useTVStore.setState({ selectedChannel: null })
    useSettingsStore.setState({
      serverFeatures: { chat: false, gif: false, nhl: false, sources: { dispatcharr: false, ersatztv: false } },
    })
    try {
      render(<NowWatching isMobile={false} />)

      expect(screen.getByText('No channels yet')).toBeInTheDocument()
      expect(screen.queryByTestId('now-watching-skeleton')).not.toBeInTheDocument()
    } finally {
      useSettingsStore.setState({ serverFeatures: null })
    }
  })

  it("shows a 'Tuning in...' skeleton before a channel is picked", () => {
    render(<NowWatching isMobile={false} />)

    expect(screen.getByText('Tuning in...')).toBeInTheDocument()
    expect(screen.getByTestId('now-watching-skeleton')).toHaveClass('animate-pulse')
    expect(screen.getByTestId('now-watching')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('Select a channel')).not.toBeInTheDocument()
  })

  describe("'Live now · Join' chip", () => {
    const joinChip = () => screen.queryByRole('button', { name: /Live now: CA-S: TSN 5/ })

    it('on a phone, replaces line 2 while live TV is on and you are elsewhere', () => {
      setLiveChannel(true)
      useTVStore.setState({ selectedChannel: cinema })
      render(<NowWatching isMobile />)

      expect(joinChip()).toHaveTextContent('Live now: CA-S: TSN 5·Join')
      // A 44px touch area around the 24px chip, without growing the header
      expect(joinChip()).toHaveClass('min-h-6', 'relative', 'pointer-coarse:before:absolute', 'pointer-coarse:before:-inset-y-2.5')
      expect(screen.getByText('The Lord of the Rings: The War of the Rohirrim')).toBeInTheDocument()
      expect(screen.queryByText('CH 4 · Cinema · 32m left')).not.toBeInTheDocument()
    })

    it("on a phone, leaves the room to the channel name: 'Live now:' is for screen readers below md", () => {
      setLiveChannel(true)
      useTVStore.setState({ selectedChannel: cinema })
      render(<NowWatching isMobile />)

      expect(joinChip()).toHaveAccessibleName(/Live now: CA-S: TSN 5/)
      const prefix = screen.getByText('Live now:', { exact: false, selector: 'span.sr-only' })
      expect(prefix).toHaveClass('sr-only', 'md:not-sr-only', 'md:whitespace-nowrap')
      // Shown at md, it still never wraps after 'Live'
      // Only the name truncates; the prefix can't take its room
      expect(prefix.parentElement).toHaveClass('truncate')
      expect(prefix.parentElement).toHaveTextContent('Live now: CA-S: TSN 5')
    })

    it('on desktop, shows beside the block only while the channel sidebar is collapsed', () => {
      setLiveChannel(true)
      useTVStore.setState({ selectedChannel: cinema })
      render(<NowWatching isMobile={false} />)
      // Row 0 of the open sidebar is already one click away
      expect(joinChip()).not.toBeInTheDocument()
      cleanup()

      useUIStore.setState({ isChannelSidebarCollapsed: true })
      render(<NowWatching isMobile={false} />)
      expect(joinChip()).toBeInTheDocument()
      // Line 2 stays
      expect(screen.getByText('CH 4 · Cinema · 32m left')).toBeInTheDocument()
    })

    it('stays hidden with nothing on live TV, or when already on channel 0', () => {
      useTVStore.setState({ selectedChannel: cinema })
      render(<NowWatching isMobile />)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      expect(screen.getByText('CH 4 · Cinema · 32m left')).toBeInTheDocument()
      cleanup()

      setLiveChannel(true)
      useTVStore.setState({ selectedChannel: liveSlot, liveEPG: null, liveEPGStatus: 'empty' })
      render(<NowWatching isMobile />)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      cleanup()

      useTVStore.setState({ selectedChannel: null })
      render(<NowWatching isMobile />)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('tunes to channel 0 when tapped', () => {
      setLiveChannel(true)
      useTVStore.setState({ selectedChannel: cinema })
      render(<NowWatching isMobile />)

      fireEvent.click(joinChip() as HTMLElement)

      expect(useTVStore.getState().selectedChannel).toEqual(useTVStore.getState().getUnifiedChannels()[0])
      expect(useTVStore.getState().selectedChannel).toMatchObject({ type: 'live', number: 0, name: 'CA-S: TSN 5', streamUrl: '/a' })
      expect(joinChip()).not.toBeInTheDocument()
      expect(screen.getByText('Live')).toHaveClass('bg-live')
    })
  })
})
