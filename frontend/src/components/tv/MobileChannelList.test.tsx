import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@/test/utils'
import { MobileChannelList } from './MobileChannelList'
import { useChannelStore } from '@/stores/channelStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore, LIVE_CHANNEL_ID } from '@/stores/tvStore'
import { usePresenceStore } from '@/stores/presenceStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import type { PresenceEntry, UnifiedChannel } from '@/types'

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
    expect(logoBox).toHaveClass('size-10')
  })

  it('uses the shared LIVE pill and sets the time left at 12px', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'))
    useErsatztvStore.setState({ programmesByChannel: { etv1: [
      { id: 'p1', channelId: 'etv1', title: 'First', start: '2026-09-06T11:00:00Z', stop: '2026-09-06T12:30:00Z' },
    ] } })
    render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} />)

    const pill = screen.getByTestId('live-pill')
    expect(pill).toHaveTextContent(/^Live$/)
    expect(pill.closest('button')).toHaveTextContent('Club')
    expect(screen.getByText('30m left')).toHaveClass('text-xs')
  })

  describe('logos', () => {
    const logo = (name: string) =>
      (screen.getByText(name).closest('button') as HTMLElement).querySelector('[data-testid="channel-logo"]')!

    it("shows a channel's logo through our logo route, and a monogram for one without", () => {
      useErsatztvStore.setState({
        channels: [
          { id: 'etv1', name: 'Movies', streamUrl: '/etv1', logoUrl: '/api/ersatztv/logos/etv1', number: 1, group: 'Films' },
          { id: 'etv2', name: 'Cartoons', streamUrl: '/etv2', logoUrl: '', number: 2, group: 'Kids' },
        ],
      })
      render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} />)

      expect(logo('Movies').querySelector('img')).toHaveAttribute('src', '/api/ersatztv/logos/etv1')
      expect(logo('Cartoons').querySelector('img')).toBeNull()
      expect(logo('Cartoons').querySelector('[data-monogram]')).toHaveAttribute('data-monogram', 'C')
    })

    it("shows the live channel's logo on the live card, and the live icon when it has none", () => {
      useChannelStore.setState({
        currentChannel: { id: 'live', name: 'Club', streamUrl: 'http://x/live', guideId: 'g1', logoUrl: '/api/channels/logos/17' },
      })
      const { unmount } = render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} />)
      expect(logo('Club').querySelector('img')).toHaveAttribute('src', '/api/channels/logos/17')
      expect(logo('Club').querySelector('.lucide-radio')).toBeNull()
      unmount()

      useChannelStore.setState({
        currentChannel: { id: 'live', name: 'Club', streamUrl: 'http://x/live', guideId: 'g1' },
      })
      render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} />)
      expect(logo('Club').querySelector('img')).toBeNull()
      expect(logo('Club').querySelector('.lucide-radio')).toHaveClass('text-live')
    })
  })

  describe('live card colours', () => {
    // Plain background utilities only (hover:bg-* is a separate state)
    const backgrounds = (element: Element) =>
      Array.from(element.classList).filter((name) => name.startsWith('bg-'))
    const card = (name: string) => screen.getByText(name).closest('button')!.parentElement!.parentElement!

    it('tints the live card, its icon box and its icon with the live token rather than destructive', () => {
      render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} />)

      expect(backgrounds(card('Club'))).toEqual(['bg-live/5'])
      const icon = card('Club').querySelector('.lucide-radio')!
      expect(icon).toHaveClass('text-live')
      expect(icon.parentElement).toHaveClass('bg-live/20')
      expect(card('Club').innerHTML).not.toMatch(/destructive/)
    })

    it('gives a selected live card one background, the live tint, with the primary border', () => {
      useTVStore.setState({ selectedChannel: useTVStore.getState().getUnifiedChannels()[0] })
      render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} />)

      expect(backgrounds(card('Club'))).toEqual(['bg-live/5'])
      expect(card('Club')).toHaveClass('border-primary')
    })

    it('gives a selected channel card one background, the selection tint', () => {
      useTVStore.setState({ selectedChannel: useTVStore.getState().getUnifiedChannels()[1] })
      render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} />)

      expect(backgrounds(card('Movies'))).toEqual(['bg-primary/10'])
      expect(card('Movies')).toHaveClass('border-primary')
      expect(backgrounds(card('Cartoons'))).toEqual([])
    })
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

describe('MobileChannelList presence stacks', () => {
  const person = (overrides: Partial<PresenceEntry> & Pick<PresenceEntry, 'displayName'>): PresenceEntry => ({
    userId: `u_${overrides.displayName}`,
    channelId: null,
    channelName: null,
    programme: null,
    view: null,
    since: null,
    ...overrides,
  })
  const onCartoons = (displayName: string) =>
    person({ displayName, view: 'ersatztv', channelId: 'etv2', channelName: 'Cartoons' })
  // Live TV reports the Dispatcharr id, not the live slot's
  const maya = person({ displayName: 'maya', view: 'live', channelId: '42', channelName: 'TSN 5' })
  const me = person({ displayName: 'jonike', view: 'ersatztv', channelId: 'etv1', channelName: 'Movies' })

  const joinButtons = () => screen.queryAllByRole('button', { name: /^Join / })

  beforeEach(() => {
    useChannelStore.setState({ currentChannel: { id: '42', name: 'TSN 5', streamUrl: '/live/42', guideId: 'tsn5' } })
    useErsatztvStore.setState({
      channels: [
        { id: 'etv1', name: 'Movies', streamUrl: '/etv1', logoUrl: '', number: 1, group: 'Films' },
        { id: 'etv2', name: 'Cartoons', streamUrl: '/etv2', logoUrl: '', number: 2, group: 'Kids' },
      ],
      programmesByChannel: {},
    })
    useTVStore.setState({ selectedChannel: null, liveEPG: null, liveEPGStatus: 'idle', liveProgrammes: [] })
    usePresenceStore.setState({ entries: [maya, me, onCartoons('dev'), onCartoons('sam'), onCartoons('kim')] })
    useSettingsStore.setState({ presenceVisible: true })
    useUIStore.setState({ hideMyActivity: false })
    useChatStore.setState({ nickname: null, me: { username: 'jonike', userId: 'u_jonike' } })
  })

  afterEach(() => {
    cleanup()
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels: [], programmesByChannel: {} })
    useTVStore.setState({ selectedChannel: null })
    usePresenceStore.setState({ entries: [] })
    useSettingsStore.setState({ presenceVisible: false })
    useUIStore.setState({ hideMyActivity: false })
    useChatStore.setState({ nickname: null, me: null })
  })

  it("stacks the viewers' avatars on a card, beside its tune button", () => {
    render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} />)

    const join = screen.getByRole('button', { name: 'Join dev and 2 others on Cartoons' })
    const stack = join.querySelector('[data-slot="presence-stack"]')!
    expect(Array.from(stack.children).map((avatar) => avatar.textContent)).toEqual(['D', 'S', 'K'])
    const tune = screen.getByText('Cartoons').closest('button')!
    expect(tune.contains(join)).toBe(false)
    expect(join.parentElement).toBe(tune.parentElement)
    // A 44px touch target
    expect(join).toHaveClass('h-11')
  })

  it('tunes to the channel when the stack is tapped', () => {
    const onChannelSelect = vi.fn()
    render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={onChannelSelect} />)

    fireEvent.click(screen.getByRole('button', { name: 'Join dev and 2 others on Cartoons' }))

    expect(onChannelSelect).toHaveBeenCalledTimes(1)
    expect(onChannelSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'etv2', type: 'ersatztv' }))
  })

  it('joins people on live TV on the live card, and leaves this viewer out', () => {
    const onChannelSelect = vi.fn()
    render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={onChannelSelect} />)

    expect(joinButtons().map((button) => button.getAttribute('aria-label'))).toEqual([
      'Join maya on TSN 5',
      'Join dev and 2 others on Cartoons',
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Join maya on TSN 5' }))
    expect(onChannelSelect).toHaveBeenCalledWith(expect.objectContaining({ id: LIVE_CHANNEL_ID, backendId: '42' }))
  })

  it('only says who is with you on the channel you are watching', () => {
    useTVStore.setState({ selectedChannel: { id: 'etv2', name: 'Cartoons', number: 2, streamUrl: '/etv2', type: 'ersatztv' } })
    const onChannelSelect = vi.fn()
    render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={onChannelSelect} />)

    expect(screen.queryByRole('button', { name: /on Cartoons$/ })).toBeNull()
    const watching = screen.getByRole('button', { name: 'Watching with dev and 2 others' })
    expect(watching).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(watching)
    expect(onChannelSelect).not.toHaveBeenCalled()
  })

  it('keeps focus on the stack once Join tunes the channel', () => {
    const onChannelSelect = vi.fn((channel: UnifiedChannel) => useTVStore.setState({ selectedChannel: channel }))
    render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={onChannelSelect} />)

    const join = screen.getByRole('button', { name: 'Join dev and 2 others on Cartoons' })
    join.focus()
    act(() => join.click())

    // The same button, now naming who you're with, so focus doesn't drop to the page
    expect(onChannelSelect).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(join)
    expect(join).toHaveAccessibleName('Watching with dev and 2 others')
  })

  it('shows no stack on the empty live slot', () => {
    useChannelStore.setState({ currentChannel: null })
    render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /^Join maya/ })).toBeNull()
  })

  it('renders no stacks while the admin setting is off or the viewer hides what they watch', () => {
    useSettingsStore.setState({ presenceVisible: false })
    render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} />)
    expect(joinButtons()).toEqual([])
    expect(document.querySelector('[data-slot="presence-stack"]')).toBeNull()
    cleanup()

    useSettingsStore.setState({ presenceVisible: true })
    useUIStore.setState({ hideMyActivity: true })
    render(<MobileChannelList onProgrammeClick={vi.fn()} onChannelSelect={vi.fn()} />)
    expect(joinButtons()).toEqual([])
    expect(document.querySelector('[data-slot="presence-stack"]')).toBeNull()
  })
})
