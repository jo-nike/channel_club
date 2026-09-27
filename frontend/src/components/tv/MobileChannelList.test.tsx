import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@/test/utils'
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
    useTVStore.setState({ selectedChannel: null, liveEPG: null, liveEPGStatus: 'idle', liveProgrammes: [] })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels: [], programmesByChannel: {} })
  })

  it('calls onChannelSelect with the tapped row', () => {
    const onChannelSelect = vi.fn()
    render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={onChannelSelect} />)

    fireEvent.click(screen.getByText('Cartoons').closest('button') as HTMLElement)

    expect(onChannelSelect).toHaveBeenCalledTimes(1)
    expect(onChannelSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'etv2', type: 'ersatztv' }))
  })

  it('calls onChannelSelect with the live slot when its card is tapped', () => {
    const onChannelSelect = vi.fn()
    render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={onChannelSelect} liveEPGTitle="Big Game" />)

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
    render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} />)

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
    render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} />)

    const number = (name: string) => (screen.getByText(name).closest('button') as HTMLElement).firstElementChild
    expect(number('Cartoons')).toHaveClass('text-primary')
    expect(number('Movies')).toHaveClass('text-muted-foreground')
  })

  it('uses denser rows: p-2 padding and a 40px logo box', () => {
    render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} />)

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
    render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} />)

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
    render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} />)

    expect(screen.getByText('First')).toBeVisible()
    expect(screen.getByText('1m left')).toBeVisible()
    // Cartoons has no schedule, so it shows its group
    expect(screen.getByText('Kids')).toBeVisible()

    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(screen.getByText('Second')).toBeVisible()
    expect(screen.getByText('1h left')).toBeVisible()
    expect(screen.queryByText('First')).not.toBeInTheDocument()
  })

  describe('Next line', () => {
    const NOW = new Date('2026-09-06T12:00:00Z').getTime()
    const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()
    const clock = (minutes: number) =>
      new Date(NOW + minutes * 60_000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const row = (name: string) => screen.getByText(name).closest('button') as HTMLElement

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(NOW)
    })

    it('shows the next programme and its start time on each ErsatzTV row', () => {
      useErsatztvStore.setState({ programmesByChannel: {
        etv1: [
          { id: 'p1', channelId: 'etv1', title: 'Evening News', start: at(-30), stop: at(65) },
          { id: 'p2', channelId: 'etv1', title: 'Late Movie', start: at(65), stop: at(155) },
          { id: 'p3', channelId: 'etv1', title: 'Night Film', start: at(155), stop: at(250) },
        ],
        // After a gap: nothing on now, the next one still shows
        etv2: [{ id: 'c1', channelId: 'etv2', title: 'Toons', start: at(10), stop: at(40) }],
      } })
      render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} />)

      expect(row('Movies')).toHaveTextContent(`Next ${clock(65)} · Late Movie`)
      expect(row('Movies')).not.toHaveTextContent('Night Film')
      expect(row('Cartoons')).toHaveTextContent(`Next ${clock(10)} · Toons`)
    })

    it('keeps an empty Next line until the schedule arrives, so rows do not jump', () => {
      render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} />)
      const emptyLine = row('Movies').querySelector('p.h-4')
      expect(emptyLine).toBeEmptyDOMElement()

      act(() => {
        useErsatztvStore.setState({ programmesByChannel: { etv1: [
          { id: 'p1', channelId: 'etv1', title: 'Evening News', start: at(-30), stop: at(65) },
          { id: 'p2', channelId: 'etv1', title: 'Late Movie', start: at(65), stop: at(155) },
        ] } })
      })

      expect(row('Movies').querySelector('p.h-4')).toHaveTextContent('Late Movie')
    })

    it("shows what's next on live TV from the live schedule", () => {
      useTVStore.setState({ liveProgrammes: [
        { id: 'l1', channelId: 'live-channel-0', title: 'Big Game', start: at(-60), stop: at(30) },
        { id: 'l2', channelId: 'live-channel-0', title: 'Post-game', start: at(30), stop: at(60) },
      ] })
      render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} liveEPGTitle="Big Game" />)

      expect(row('Club')).toHaveTextContent(`Next ${clock(30)} · Post-game`)
    })

    it('has no Next line on the empty live slot', () => {
      useChannelStore.setState({ currentChannel: null })
      render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} />)

      const liveRow = row('Live')
      expect(liveRow.querySelector('p.h-4')).toBeNull()
      expect(liveRow).not.toHaveTextContent('Next')
    })
  })

  describe('expanded schedule', () => {
    const NOW = new Date('2026-09-06T12:00:00Z').getTime()
    const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()
    const clock = (minutes: number) =>
      new Date(NOW + minutes * 60_000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const chevron = (name: string) => screen.getByRole('button', { name: `Show schedule for ${name}` })
    const moviesSchedule = [
      { id: 'p0', channelId: 'etv1', title: 'Breakfast Show', start: at(-120), stop: at(-30) },
      { id: 'p1', channelId: 'etv1', title: 'Evening News', start: at(-30), stop: at(15) },
      { id: 'p2', channelId: 'etv1', title: 'Late Movie', start: at(15), stop: at(120) },
      { id: 'p3', channelId: 'etv1', title: 'Night Film', start: at(120), stop: at(200) },
      { id: 'p4', channelId: 'etv1', title: 'Small Hours', start: at(200), stop: at(260) },
      { id: 'p5', channelId: 'etv1', title: 'Test Card', start: at(260), stop: at(300) },
    ]

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(NOW)
      useErsatztvStore.setState({ programmesByChannel: { etv1: moviesSchedule } })
    })

    it('gives every row a 44px chevron beside the tune button, collapsed at first', () => {
      render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} />)

      const toggle = chevron('Movies')
      expect(toggle).toHaveClass('h-11', 'w-11')
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      // A sibling of the tune button, not inside it
      const tune = screen.getByText('Movies').closest('button') as HTMLElement
      expect(tune).not.toContainElement(toggle)
      expect(toggle.parentElement).toBe(tune.parentElement)
      expect(chevron('Cartoons')).toBeInTheDocument()
      expect(chevron('Club')).toBeInTheDocument()
    })

    it("expands to the next programmes that haven't ended, without tuning", () => {
      const onChannelSelect = vi.fn()
      render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={onChannelSelect} />)

      fireEvent.click(chevron('Movies'))

      const toggle = chevron('Movies')
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      const schedule = document.getElementById(toggle.getAttribute('aria-controls') as string) as HTMLElement
      expect(schedule).toHaveAccessibleName('Schedule for Movies')
      const items = within(schedule).getAllByRole('button')
      // The one on now, then the next three; the ended one and the fifth are left out
      expect(items.map((item) => item.textContent)).toEqual([
        `${clock(-30)}Evening News`,
        `${clock(15)}Late Movie`,
        `${clock(120)}Night Film`,
        `${clock(200)}Small Hours`,
      ])
      expect(schedule).not.toHaveTextContent('Breakfast Show')
      expect(onChannelSelect).not.toHaveBeenCalled()
    })

    it('shows one schedule at a time, and the chevron collapses it again', () => {
      useErsatztvStore.setState({ programmesByChannel: {
        etv1: moviesSchedule,
        etv2: [{ id: 'c1', channelId: 'etv2', title: 'Toons', start: at(-10), stop: at(20) }],
      } })
      render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} />)

      fireEvent.click(chevron('Movies'))
      fireEvent.click(chevron('Cartoons'))
      expect(chevron('Movies')).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('list', { name: 'Schedule for Movies' })).not.toBeInTheDocument()
      expect(screen.getByRole('list', { name: 'Schedule for Cartoons' })).toHaveTextContent('Toons')

      fireEvent.click(chevron('Cartoons'))
      expect(chevron('Cartoons')).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('list', { name: 'Schedule for Cartoons' })).not.toBeInTheDocument()
    })

    it('calls onProgrammeClick with the tapped programme and its channel', () => {
      const onProgrammeClick = vi.fn()
      const onChannelSelect = vi.fn()
      render(<MobileChannelList onProgrammeClick={onProgrammeClick} onChannelSelect={onChannelSelect} />)

      fireEvent.click(chevron('Movies'))
      fireEvent.click(screen.getByRole('button', { name: `${clock(15)} Late Movie` }))

      expect(onProgrammeClick).toHaveBeenCalledTimes(1)
      expect(onProgrammeClick).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'p2', title: 'Late Movie' }),
        expect.objectContaining({ id: 'etv1', type: 'ersatztv' })
      )
      expect(onChannelSelect).not.toHaveBeenCalled()
    })

    it('still tunes from the row body of an expanded row', () => {
      const onChannelSelect = vi.fn()
      render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={onChannelSelect} />)

      fireEvent.click(chevron('Movies'))
      fireEvent.click(screen.getByText('Movies').closest('button') as HTMLElement)

      expect(onChannelSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'etv1' }))
    })

    it('expands the live row to the live schedule', () => {
      const onProgrammeClick = vi.fn()
      useTVStore.setState({ liveProgrammes: [
        { id: 'l0', channelId: 'live-channel-0', title: 'Pre-game', start: at(-120), stop: at(-60) },
        { id: 'l1', channelId: 'live-channel-0', title: 'Big Game', start: at(-60), stop: at(30) },
        { id: 'l2', channelId: 'live-channel-0', title: 'Post-game', start: at(30), stop: at(60) },
      ] })
      render(<MobileChannelList onProgrammeClick={onProgrammeClick} onChannelSelect={vi.fn()} liveEPGTitle="Big Game" />)

      fireEvent.click(chevron('Club'))
      const schedule = screen.getByRole('list', { name: 'Schedule for Club' })
      expect(within(schedule).getAllByRole('button').map((item) => item.textContent)).toEqual([
        `${clock(-60)}Big Game`,
        `${clock(30)}Post-game`,
      ])

      fireEvent.click(within(schedule).getByRole('button', { name: `${clock(30)} Post-game` }))
      expect(onProgrammeClick).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'l2' }),
        expect.objectContaining({ type: 'live' })
      )
    })

    it('says so when an expanded row has nothing scheduled', () => {
      render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} />)

      fireEvent.click(chevron('Cartoons'))

      const toggle = chevron('Cartoons')
      expect(document.getElementById(toggle.getAttribute('aria-controls') as string)).toHaveTextContent(
        'No schedule to show'
      )
    })

    it('has no chevron on the empty live slot', () => {
      useChannelStore.setState({ currentChannel: null })
      render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} onPickLive={vi.fn()} />)

      expect(screen.queryByRole('button', { name: 'Show schedule for Live' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Pick a channel' })).toBeInTheDocument()
    })
  })

  it('reserves room under the last row for the install banner', () => {
    const { container } = render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} />)
    // --install-prompt-h is set on <html> only while the banner shows; 0px otherwise
    expect(container.firstElementChild).toHaveClass('pb-[calc(1rem+var(--install-prompt-h,0px))]')
  })
})
