import { act, fireEvent, render, screen, waitFor, within } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { TVView } from './TVView'
import { useChannelStore } from '@/stores/channelStore'
import { useTVStore, LIVE_CHANNEL_ID } from '@/stores/tvStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import * as api from '@/services/ersatztvApi'
import { fetchLiveProgrammes, fetchNowPlaying } from '@/services/api'
import { toast } from 'sonner'
import { mockViewport } from '@/test/viewport'
const presence = vi.hoisted(() => vi.fn())
const crash = vi.hoisted(() => ({ player: false, chat: false }))
const socket = vi.hoisted(() => ({ status: 'connected', reconnect: () => {} }))
const chatProps = vi.hoisted(() => ({ last: null as null | { status?: string; onReconnect?: () => void; variant?: string } }))
const auth = vi.hoisted(() => ({ isAdmin: false }))
const appSettings = vi.hoisted(() => ({ userChannelSelection: false }))
const playerProps = vi.hoisted(() => ({ onPickLive: undefined as undefined | (() => void), renders: 0, reloadKey: undefined as undefined | number, mounts: 0 }))
const guide = vi.hoisted(() => ({ onProgrammeClick: undefined as undefined | ((programme: ErsatzTVProgramme, channel: UnifiedChannel) => void) }))
const modal = vi.hoisted(() => ({ last: null as null | { programme: ErsatzTVProgramme | null; channel: { id: string; name: string } | null; open: boolean; onWatch: (channel: { id: string; name: string }) => void } }))
vi.mock('@/services/api', () => ({ fetchNowPlaying: vi.fn(), fetchLiveProgrammes: vi.fn(async () => ({ channelId: '', programmes: [] })) }))
import type { ErsatzTVProgramme, UnifiedChannel } from '@/types'

vi.mock('@/services/ersatztvApi', () => ({ fetchErsatzTVChannels: vi.fn(), fetchErsatzTVCurrentProgramme: vi.fn(), getErsatzTVLogoUrl: vi.fn() }))
vi.mock('@/hooks/useWebSocket', () => ({ useWebSocket: () => ({ status: socket.status, reconnect: socket.reconnect, sendChannelUpdate: presence, sendChatMessage: vi.fn(), sendSetNickname: vi.fn() }) }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: auth.isAdmin, logout: vi.fn() }) }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => ({ userChannelSelection: appSettings.userChannelSelection }) }))
vi.mock('@/components/LiveChannelPickerDialog', () => ({ LiveChannelPickerDialog: ({ open }: { open: boolean }) => (
  <div data-testid="live-picker" data-open={String(open)} />
) }))
vi.mock('@/components/tv/DualModeVideoPlayer', async () => {
  const { useEffect } = await import('react')
  return { DualModeVideoPlayer: ({ channel, onPickLive, reloadKey }: { channel: UnifiedChannel | null; onPickLive?: () => void; reloadKey?: number }) => {
    playerProps.onPickLive = onPickLive
    playerProps.reloadKey = reloadKey
    playerProps.renders += 1
    useEffect(() => { playerProps.mounts += 1 }, [])
    if (crash.player) throw new Error('player exploded')
    return <div data-testid="player">{channel?.streamUrl || 'No live broadcast'}</div>
  } }
})
vi.mock('@/components/tv/TVEPGGrid', () => ({ TVEPGGrid: ({ onProgrammeClick }: { onProgrammeClick?: (programme: ErsatzTVProgramme, channel: UnifiedChannel) => void }) => {
  guide.onProgrammeClick = onProgrammeClick
  return <div data-testid="tv-epg-grid" />
} }))
vi.mock('@/components/ChatPanel', async () => {
  const { useChatStore } = await import('@/stores/chatStore')
  // Like the real panel, renders nothing (and so can't throw) while closed
  return { ChatPanel: (props: { status?: string; onReconnect?: () => void; variant?: string }) => {
    chatProps.last = props
    const isOpen = useChatStore((s) => s.isOpen)
    if (crash.chat && isOpen) throw new Error('chat exploded')
    return isOpen ? <div data-testid="chat" data-variant={props.variant} /> : null
  } }
})
vi.mock('@/components/ersatztv/ProgrammeDetailsModal', () => ({ ProgrammeDetailsModal: (props: NonNullable<typeof modal.last>) => {
  modal.last = props
  return null
} }))
vi.mock('@/components/AccountMenu', () => ({ AccountMenu: () => null }))
vi.mock('@/components/AdminModal', () => ({ AdminModal: () => null }))

beforeEach(() => {
  socket.status = 'connected'
  auth.isAdmin = false
  appSettings.userChannelSelection = false
  playerProps.onPickLive = undefined
  chatProps.last = null
  crash.player = false
  crash.chat = false
  useChatStore.setState({ isOpen: false })
  useTVStore.setState({ selectedChannel: null, liveEPG: null, liveEPGStatus: 'idle' })
  useErsatztvStore.setState({ channels: [], channelsLoading: false, error: null })
  useUIStore.setState({ lastTVChannelId: null, isTheaterMode: false, isChannelSidebarCollapsed: false })
  useChannelStore.getState().setCurrentChannel({ id: 'a', name: 'A', streamUrl: 'https://fixture/a' })
})
describe('FE-05 routed live-only view', () => {
  it('preserves the first ErsatzTV default after an asynchronous populated catalogue load', async () => {
    let finish!: (channels: Awaited<ReturnType<typeof api.fetchErsatzTVChannels>>) => void
    vi.mocked(api.fetchErsatzTVChannels).mockReturnValue(new Promise((resolve) => { finish = resolve }))
    useErsatztvStore.setState({ loadAllProgrammes: vi.fn().mockResolvedValue(undefined) })
    vi.mocked(api.fetchErsatzTVCurrentProgramme).mockResolvedValue({ current: null, next: null })
    render(<MemoryRouter><TVView /></MemoryRouter>)
    expect(useUIStore.getState().lastTVChannelId).toBeNull()
    await act(async () => finish([{ id: 'default-e', name: 'Default cinema', number: 1, streamUrl: '/default-e', group: '' }]))
    expect(screen.getByTestId('player')).toHaveTextContent('/default-e')
    expect(useTVStore.getState().selectedChannel?.type).toBe('ersatztv')
  })

  it.each(['empty', '503'])('follows A → B → cleared while optional catalog is %s', async (source) => {
    if (source === 'empty') vi.mocked(api.fetchErsatzTVChannels).mockResolvedValue([])
    else vi.mocked(api.fetchErsatzTVChannels).mockRejectedValue(new Error('503 optional service unavailable'))
    render(<MemoryRouter><TVView /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('player')).toHaveTextContent('https://fixture/a'))
    expect(screen.getByRole('heading', { name: 'Channels' })).toBeVisible()
    act(() => useChannelStore.getState().setCurrentChannel({ id: 'b', name: 'B', streamUrl: 'https://fixture/b' }))
    expect(screen.getByTestId('player')).toHaveTextContent('https://fixture/b')
    act(() => useChannelStore.getState().setCurrentChannel(null))
    expect(screen.getByTestId('player')).toHaveTextContent('No live broadcast')
  })
})

afterEach(() => vi.useRealTimers())
describe('FE-12 programme boundary clock', () => {
  it('updates the routed header and presence within thirty seconds without other events', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'))
    const channel = { id: 'e', name: 'Cinema', number: 1, streamUrl: '/fixture', group: '' }
    useErsatztvStore.setState({ channels: [channel], programmesByChannel: { e: [
      { channelId: 'e', title: 'First', start: '2026-09-06T11:00:00Z', stop: '2026-09-06T12:00:10Z' },
      { channelId: 'e', title: 'Second', start: '2026-09-06T12:00:10Z', stop: '2026-09-06T13:00:00Z' },
    ] }, loadAllProgrammes: vi.fn().mockResolvedValue(undefined) })
    useUIStore.setState({ lastTVChannelId: 'e' })
    vi.mocked(api.fetchErsatzTVCurrentProgramme).mockResolvedValue({ current: null, next: null })
    render(<MemoryRouter><TVView /></MemoryRouter>)
    const header = within(screen.getByTestId('now-watching'))
    expect(header.getByText('First')).toBeVisible()
    await act(() => vi.advanceTimersByTimeAsync(30000))
    expect(header.getByText('Second')).toBeVisible()
    expect(header.getByText('CH 1 · Cinema · 1h left')).toBeVisible()
    expect(presence).toHaveBeenLastCalledWith('Cinema', 'Second', 'ersatztv', 'e')
  })
  it('refreshes live EPG at programme end with no optional catalogue', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'))
    vi.mocked(api.fetchErsatzTVChannels).mockResolvedValue([])
    const first = { title: 'First live', startTime: '2026-09-06T11:00:00Z', endTime: '2026-09-06T12:00:10Z' }
    const next = { title: 'Next live', startTime: '2026-09-06T12:00:10Z', endTime: '2026-09-06T13:00:00Z' }
    vi.mocked(fetchNowPlaying).mockImplementation(async () => ({ channelId: 'a', currentProgram: Date.now() < new Date(first.endTime).getTime() ? first : next }))
    useChannelStore.getState().setCurrentChannel({ id: 'a', name: 'A', streamUrl: '/a', guideId: 'guide-a' })
    render(<MemoryRouter><TVView /></MemoryRouter>)
    await act(() => vi.advanceTimersByTimeAsync(1))
    const header = within(screen.getByTestId('now-watching'))
    expect(header.getByText('First live')).toBeVisible()
    await act(() => vi.advanceTimersByTimeAsync(10000))
    expect(header.getByText('Next live')).toBeVisible()
    expect(presence).toHaveBeenLastCalledWith('A', 'Next live', 'live', 'a')
  })
})

describe('B-01 live channel schedule', () => {
  it('loads the live schedule when the view opens and again every 30 minutes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'))
    vi.mocked(api.fetchErsatzTVChannels).mockResolvedValue([])
    vi.mocked(fetchNowPlaying).mockResolvedValue({ channelId: 'guide-a', currentProgram: null })
    // Same channel, so the store's own reload on a live switch doesn't run
    useChannelStore.getState().setCurrentChannel({ id: 'a', name: 'A', streamUrl: '/a', guideId: 'guide-a' })
    vi.mocked(fetchLiveProgrammes).mockClear()
    vi.mocked(fetchLiveProgrammes).mockResolvedValue({
      channelId: 'guide-a',
      programmes: [{ title: 'Matinee', startTime: '2026-09-06T11:00:00Z', endTime: '2026-09-06T13:00:00Z' }],
    })

    render(<MemoryRouter><TVView /></MemoryRouter>)
    await act(() => vi.advanceTimersByTimeAsync(1))

    expect(fetchLiveProgrammes).toHaveBeenCalledTimes(1)
    expect(fetchLiveProgrammes).toHaveBeenCalledWith('guide-a', 'A')
    expect(useTVStore.getState().liveProgrammes.map((p) => p.title)).toEqual(['Matinee'])

    await act(() => vi.advanceTimersByTimeAsync(29 * 60 * 1000))
    expect(fetchLiveProgrammes).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(60 * 1000))
    expect(fetchLiveProgrammes).toHaveBeenCalledTimes(2)
  })
})

describe('B-01 live row programme clicks', () => {
  const minute = 60_000
  const live = (title: string, fromMinutes: number, toMinutes: number): ErsatzTVProgramme => ({
    id: `live-${title}`,
    channelId: LIVE_CHANNEL_ID,
    title,
    start: new Date(Date.now() + fromMinutes * minute).toISOString(),
    stop: new Date(Date.now() + toMinutes * minute).toISOString(),
  })
  const liveSlot = () => useTVStore.getState().getUnifiedChannels()[0]

  beforeEach(async () => {
    modal.last = null
    guide.onProgrammeClick = undefined
    vi.mocked(api.fetchErsatzTVChannels).mockResolvedValue([{ id: 'e', name: 'Cinema', number: 1, streamUrl: '/e', group: '' }])
    useErsatztvStore.setState({ loadAllProgrammes: vi.fn().mockResolvedValue(undefined) })
    useUIStore.setState({ isEPGVisible: true })
    render(<MemoryRouter><TVView /></MemoryRouter>)
    // Opens on the ErsatzTV channel, not the live slot
    await waitFor(() => expect(useTVStore.getState().selectedChannel?.id).toBe('e'))
  })
  afterEach(() => useUIStore.setState({ isEPGVisible: false }))

  it('opens the details of an upcoming live programme, on the live slot, without tuning', () => {
    const upcoming = live('After Hours', 60, 120)

    act(() => guide.onProgrammeClick?.(upcoming, liveSlot()))

    expect(modal.last).toMatchObject({ open: true, programme: upcoming, channel: { id: LIVE_CHANNEL_ID, name: 'A' } })
    expect(useTVStore.getState().selectedChannel?.id).toBe('e')

    // Its Watch action tunes to the live slot
    act(() => modal.last?.onWatch({ id: LIVE_CHANNEL_ID, name: 'A' }))
    expect(useTVStore.getState().selectedChannel).toMatchObject({ id: LIVE_CHANNEL_ID, type: 'live' })
  })

  it('tunes to the live slot for the live programme on now, without opening details', () => {
    act(() => guide.onProgrammeClick?.(live('Hockey Night', -10, 50), liveSlot()))

    expect(useTVStore.getState().selectedChannel).toMatchObject({ id: LIVE_CHANNEL_ID, type: 'live' })
    expect(modal.last?.open).toBe(false)
  })
})

describe('A-V1 contained player and chat crashes', () => {
  beforeEach(() => {
    vi.mocked(api.fetchErsatzTVChannels).mockResolvedValue([])
    // React reports caught render errors to console.error; keep the output quiet.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('keeps the header and channel list when the player throws, and Reload player remounts it', async () => {
    crash.player = true
    render(<MemoryRouter><TVView /></MemoryRouter>)

    // The boundary resets (and the player throws again) as the channel resolves
    await waitFor(() => expect(useTVStore.getState().selectedChannel?.streamUrl).toBe('https://fixture/a'))
    expect(screen.getByText('The player hit an error')).toBeVisible()
    expect(screen.getByRole('banner')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Channels' })).toBeVisible()
    expect(screen.queryByTestId('player')).not.toBeInTheDocument()

    crash.player = false
    fireEvent.click(screen.getByRole('button', { name: 'Reload player' }))

    expect(screen.getByTestId('player')).toHaveTextContent('https://fixture/a')
    expect(screen.queryByText('The player hit an error')).not.toBeInTheDocument()
  })

  it('retries the player when the live channel changes', async () => {
    crash.player = true
    render(<MemoryRouter><TVView /></MemoryRouter>)
    // The boundary resets (and the player throws again) as the channel resolves
    await waitFor(() => expect(useTVStore.getState().selectedChannel?.streamUrl).toBe('https://fixture/a'))
    expect(screen.getByText('The player hit an error')).toBeVisible()

    crash.player = false
    act(() => useChannelStore.getState().setCurrentChannel({ id: 'b', name: 'B', streamUrl: 'https://fixture/b' }))

    expect(screen.getByTestId('player')).toHaveTextContent('https://fixture/b')
  })

  it('shows a small card when chat throws, and Close closes chat and clears it', async () => {
    crash.chat = true
    useChatStore.setState({ isOpen: true })
    render(<MemoryRouter><TVView /></MemoryRouter>)

    expect(await screen.findByText('Chat hit an error')).toBeVisible()
    expect(screen.getByRole('banner')).toBeVisible()
    expect(screen.getByTestId('player')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(useChatStore.getState().isOpen).toBe(false)
    expect(screen.queryByText('Chat hit an error')).not.toBeInTheDocument()
  })
})

describe('C-V3 Refresh keeps the player shell', () => {
  it('hands the player a new reloadKey instead of remounting it', async () => {
    vi.mocked(api.fetchErsatzTVChannels).mockResolvedValue([])
    render(<MemoryRouter><TVView /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('player')).toHaveTextContent('https://fixture/a'))
    const player = screen.getByTestId('player')
    const mounts = playerProps.mounts
    const before = playerProps.reloadKey

    fireEvent.click(screen.getByRole('button', { name: 'Refresh video' }))

    expect(playerProps.reloadKey).not.toBe(before)
    expect(playerProps.mounts).toBe(mounts)
    expect(screen.getByTestId('player')).toBe(player)
  })
})

describe('E-V1 chat connection state', () => {
  it('hands the socket status and reconnect to the chat panel', () => {
    vi.mocked(api.fetchErsatzTVChannels).mockResolvedValue([])
    socket.status = 'disconnected'
    render(<MemoryRouter><TVView /></MemoryRouter>)
    expect(chatProps.last?.status).toBe('disconnected')
    expect(chatProps.last?.onReconnect).toBe(socket.reconnect)
  })
})

const originalMatchMedia = window.matchMedia
function matchOnly(match: string) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query === match,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

describe('G-03 phone portrait layout', () => {
  beforeEach(() => vi.mocked(api.fetchErsatzTVChannels).mockResolvedValue([]))
  afterEach(() => { window.matchMedia = originalMatchMedia })

  it('gives the player a fixed full-width 16:9 box and the channel list the rest of the height', async () => {
    matchOnly('(max-width: 768px)')
    render(<MemoryRouter><TVView /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('player')).toHaveTextContent('https://fixture/a'))

    const video = screen.getByTestId('player').closest('.bg-black') as HTMLElement
    expect(video).toHaveClass('aspect-video', 'w-full', 'flex-none')
    expect(video).not.toHaveClass('rounded-lg')
    expect(video.style.flex).toBe('')

    const list = screen.getByRole('heading', { name: 'Channels' }).closest('.epg-scroll') as HTMLElement
    expect(list).toHaveClass('min-h-0', 'overflow-y-auto')
    expect(list).toHaveStyle({ flex: '1 1 0%' })
  })

  it('keeps the desktop player growing into the full height', async () => {
    useUIStore.setState({ isEPGVisible: false })
    render(<MemoryRouter><TVView /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('player')).toHaveTextContent('https://fixture/a'))

    const video = screen.getByTestId('player').closest('.bg-black') as HTMLElement
    expect(video).not.toHaveClass('aspect-video')
    expect(video).toHaveClass('rounded-lg')
    expect(video).toHaveStyle({ flex: '1 1 100%' })
  })
})

describe('H-07 now-playing indicator on the phone list', () => {
  const movies = { id: 'e1', name: 'Movies', number: 1, streamUrl: '/e1', logoUrl: '', group: '' }

  beforeEach(() => {
    matchOnly('(max-width: 768px)')
    vi.mocked(api.fetchErsatzTVChannels).mockResolvedValue([movies])
    useErsatztvStore.setState({ loadAllProgrammes: vi.fn().mockResolvedValue(undefined) })
  })
  afterEach(() => { window.matchMedia = originalMatchMedia })

  it('marks the selected row with a static AudioLines icon and nothing pulsing', async () => {
    render(<MemoryRouter><TVView /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('player')).toHaveTextContent('/e1'))

    const indicator = screen.getByTestId('now-playing-indicator')
    expect(indicator.closest('button')).toHaveTextContent('Movies')
    expect(indicator).toHaveClass('lucide-audio-lines', 'h-4', 'w-4', 'text-primary')
    expect(indicator).toHaveAttribute('aria-hidden', 'true')
    const list = screen.getByRole('heading', { name: 'Channels' }).closest('.epg-scroll') as HTMLElement
    expect(list.querySelector('.animate-pulse')).toBeNull()
  })

  it('uses the live colour when the live slot is selected', async () => {
    render(<MemoryRouter><TVView /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('player')).toHaveTextContent('/e1'))

    // The live slot is carrying channel A, so its card has the LIVE badge
    const liveCard = screen.getByText('Live', { selector: 'span' }).closest('button') as HTMLElement
    fireEvent.click(liveCard)
    const indicator = screen.getByTestId('now-playing-indicator')
    expect(liveCard).toContainElement(indicator)
    expect(indicator).toHaveClass('text-live')
    expect(indicator).not.toHaveClass('text-primary')
  })
})

describe('G-08 viewport height and header title', () => {
  beforeEach(() => vi.mocked(api.fetchErsatzTVChannels).mockResolvedValue([]))

  it('sizes the app to the dynamic viewport, keeping 100vh where dvh is unsupported', () => {
    render(<MemoryRouter><TVView /></MemoryRouter>)
    const root = screen.getByRole('banner').parentElement!
    expect(root).toHaveClass('h-screen', 'supports-[height:100dvh]:h-dvh')
    expect(root).not.toHaveClass('h-dvh')
  })

  it('keeps a long programme title on one truncated line', async () => {
    const title = 'The Lord of the Rings: The War of the Rohirrim'
    vi.mocked(fetchNowPlaying).mockResolvedValue({ channelId: 'a', currentProgram: { title, startTime: '2026-09-06T11:00:00Z', endTime: '2099-01-01T00:00:00Z' } })
    useChannelStore.getState().setCurrentChannel({ id: 'a', name: 'PopCorn Movies', streamUrl: '/a', guideId: 'guide-a' })
    render(<MemoryRouter><TVView /></MemoryRouter>)
    const block = screen.getByTestId('now-watching')
    const titleEl = await within(block).findByText(title)
    expect(titleEl).toHaveClass('truncate')
    expect(within(block).getByText(/^Club channel · PopCorn Movies · .* left$/)).toHaveClass('truncate')
    expect(block).toHaveClass('min-w-0', 'flex-1')
    expect(block.parentElement).toHaveClass('min-w-0', 'flex-1')
  })
})

describe('A-V2 iOS safe area', () => {
  it('pads the header below the status bar', () => {
    vi.mocked(api.fetchErsatzTVChannels).mockResolvedValue([])
    render(<MemoryRouter><TVView /></MemoryRouter>)
    const header = screen.getByRole('banner')
    expect(header).toHaveClass('pt-header-safe', 'pb-2')
    expect(header).not.toHaveClass('py-2')
  })
})

describe('B-V1 live guide copy on the phone card', () => {
  beforeEach(() => {
    vi.mocked(api.fetchErsatzTVChannels).mockResolvedValue([])
    matchOnly('(max-width: 768px)')
  })
  afterEach(() => { window.matchMedia = originalMatchMedia })

  it("says 'Guide unavailable' when the guide lookup fails", async () => {
    vi.mocked(fetchNowPlaying).mockRejectedValue(new Error('Failed to fetch EPG'))
    useChannelStore.getState().setCurrentChannel({ id: 'a', name: 'Sports', streamUrl: '/a', guideId: 'guide-a' })
    render(<MemoryRouter><TVView /></MemoryRouter>)

    expect(await screen.findByText('Guide unavailable')).toBeVisible()
    expect(screen.queryByText('Broadcasting...')).not.toBeInTheDocument()
  })

  it("says 'No guide info' when the guide has nothing on now", async () => {
    vi.mocked(fetchNowPlaying).mockResolvedValue({ channelId: 'guide-a', currentProgram: null })
    useChannelStore.getState().setCurrentChannel({ id: 'a', name: 'Sports', streamUrl: '/a', guideId: 'guide-a' })
    render(<MemoryRouter><TVView /></MemoryRouter>)

    expect(await screen.findByText('No guide info')).toBeVisible()
  })
})

describe('B-V2 picking a channel from the empty live slot', () => {
  beforeEach(() => {
    vi.mocked(api.fetchErsatzTVChannels).mockResolvedValue([])
    useChannelStore.getState().setCurrentChannel(null)
  })
  afterEach(() => { window.matchMedia = originalMatchMedia })

  const picker = () => screen.queryByTestId('live-picker')

  it('gives an admin the picker from the sidebar and the player', async () => {
    auth.isAdmin = true
    render(<MemoryRouter><TVView /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('player')).toHaveTextContent('No live broadcast'))

    expect(picker()).toHaveAttribute('data-open', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Pick a channel' }))
    expect(picker()).toHaveAttribute('data-open', 'true')
    expect(playerProps.onPickLive).toBeTypeOf('function')
  })

  it('gives a viewer the admin allowed to change live TV the picker', async () => {
    appSettings.userChannelSelection = true
    render(<MemoryRouter><TVView /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('player')).toHaveTextContent('No live broadcast'))

    act(() => playerProps.onPickLive?.())
    expect(picker()).toHaveAttribute('data-open', 'true')
  })

  it("shows a viewer without permission the wait copy and no picker", async () => {
    render(<MemoryRouter><TVView /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('player')).toHaveTextContent('No live broadcast'))

    expect(picker()).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pick a channel' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Live slot, nothing on' })).toHaveTextContent('Waiting for someone to put something on')
    expect(playerProps.onPickLive).toBeUndefined()
  })

  describe('on a phone', () => {
    const movies = { id: 'e1', name: 'Movies', number: 1, streamUrl: '/e1', logoUrl: '', group: '' }
    const liveCard = () => screen.getByText('Live', { selector: 'p' }).closest('button') as HTMLElement

    beforeEach(() => {
      matchOnly('(max-width: 768px)')
      auth.isAdmin = true
      vi.mocked(api.fetchErsatzTVChannels).mockResolvedValue([movies])
      useErsatztvStore.setState({ loadAllProgrammes: vi.fn().mockResolvedValue(undefined) })
    })

    it('puts Pick a channel beside the live card, opening the picker without tuning', async () => {
      render(<MemoryRouter><TVView /></MemoryRouter>)
      await waitFor(() => expect(screen.getByTestId('player')).toHaveTextContent('/e1'))

      const pick = screen.getByRole('button', { name: 'Pick a channel' })
      expect(liveCard()).not.toContainElement(pick)
      expect(pick.parentElement).toBe(liveCard().parentElement)

      fireEvent.click(pick)
      expect(picker()).toHaveAttribute('data-open', 'true')
      expect(useTVStore.getState().selectedChannel?.id).toBe('e1')
    })

    it('still tunes to the live slot from the card itself', async () => {
      render(<MemoryRouter><TVView /></MemoryRouter>)
      await waitFor(() => expect(screen.getByTestId('player')).toHaveTextContent('/e1'))

      fireEvent.click(liveCard())
      expect(useTVStore.getState().selectedChannel?.type).toBe('live')
      expect(picker()).toHaveAttribute('data-open', 'false')
    })
  })
})

describe('programme progress on the phone list', () => {
  const NOW = new Date('2026-09-26T20:00:00Z').getTime()
  const MINUTE = 60_000
  const movies = { id: 'e1', name: 'Movies', number: 1, streamUrl: '/e1', logoUrl: '', group: '' }
  const onNow = (startOffsetMin: number, stopOffsetMin: number) => ({
    id: 'p1',
    channelId: 'e1',
    title: 'Evening News',
    start: new Date(NOW + startOffsetMin * MINUTE).toISOString(),
    stop: new Date(NOW + stopOffsetMin * MINUTE).toISOString(),
  })
  // The bar's fill sits in the track just before the time-left label
  const fillBefore = (label: HTMLElement) => label.previousElementSibling?.firstElementChild as HTMLElement

  beforeEach(() => {
    // Only the clock: the channel fetch and waitFor still run on real timers
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    matchOnly('(max-width: 768px)')
    vi.mocked(api.fetchErsatzTVChannels).mockResolvedValue([movies])
    useErsatztvStore.setState({ loadAllProgrammes: vi.fn().mockResolvedValue(undefined) })
  })
  afterEach(() => {
    vi.useRealTimers()
    window.matchMedia = originalMatchMedia
    useErsatztvStore.setState({ programmesByChannel: {} })
  })

  it("shows the time left and fills the bar by the share that's been on", async () => {
    // 30 of 95 minutes in, 65 to go
    useErsatztvStore.setState({ programmesByChannel: { e1: [onNow(-30, 65)] } })
    render(<MemoryRouter><TVView /></MemoryRouter>)

    const label = await screen.findByText('1h 5m left')
    expect(label.closest('button')).toHaveTextContent('Evening News')
    expect(parseFloat(fillBefore(label).style.width)).toBeCloseTo((30 / 95) * 100, 5)
  })

  it('shows whole hours without minutes', async () => {
    useErsatztvStore.setState({ programmesByChannel: { e1: [onNow(-60, 120)] } })
    render(<MemoryRouter><TVView /></MemoryRouter>)

    const label = await screen.findByText('2h left')
    expect(parseFloat(fillBefore(label).style.width)).toBeCloseTo((60 / 180) * 100, 5)
  })
})

describe('B-06 guide mode', () => {
  beforeEach(() => vi.mocked(api.fetchErsatzTVChannels).mockResolvedValue([]))
  afterEach(() => {
    useUIStore.setState({ isEPGVisible: false, epgHeightPercent: 50 })
    vi.restoreAllMocks()
  })

  it('leaves the scrolling to the guide grid on desktop, so its time header can stick', async () => {
    useUIStore.setState({ isEPGVisible: true })
    render(<MemoryRouter><TVView /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('player')).toHaveTextContent('https://fixture/a'))

    const wrapper = screen.getByTestId('tv-epg-grid').parentElement as HTMLElement
    expect(wrapper).toHaveClass('min-h-0', 'overflow-hidden')
    expect(wrapper).not.toHaveClass('overflow-y-auto')
    expect(wrapper).toHaveStyle({ flex: `0 0 ${useUIStore.getState().epgHeightPercent}%` })
  })

  it.each([false, true])('hides the channel sidebar while the guide is open and brings it back as it was (collapsed: %s)', async (collapsed) => {
    useUIStore.setState({ isChannelSidebarCollapsed: collapsed })
    render(<MemoryRouter><TVView /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('player')).toHaveTextContent('https://fixture/a'))
    const sidebarToggle = () => screen.queryByRole('button', { name: collapsed ? 'Expand channel sidebar' : 'Collapse channel sidebar' })
    expect(sidebarToggle()).toBeInTheDocument()

    act(() => useUIStore.setState({ isEPGVisible: true }))
    expect(screen.queryByRole('heading', { name: 'Channels' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /channel sidebar/ })).not.toBeInTheDocument()
    expect(screen.getByTestId('tv-epg-grid')).toBeInTheDocument()
    expect(useUIStore.getState().isChannelSidebarCollapsed).toBe(collapsed)

    act(() => useUIStore.setState({ isEPGVisible: false }))
    expect(sidebarToggle()).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Channels' }) !== null).toBe(!collapsed)
  })

  it('lets the guide be dragged between 30% and 75% of the height', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(1000)
    useUIStore.setState({ isEPGVisible: true, epgHeightPercent: 50 })
    render(<MemoryRouter><TVView /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('player')).toHaveTextContent('https://fixture/a'))
    const handle = screen.getByRole('separator', { name: 'Resize EPG section' })

    // Pointer events, so touch and pen drag it as well as a mouse
    expect(handle).toHaveClass('touch-none')

    // Up 400px of 1000: 50% + 40% stops at 75%
    fireEvent.pointerDown(handle, { clientY: 500, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientY: 100, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientY: 100, pointerId: 1 })
    expect(useUIStore.getState().epgHeightPercent).toBe(75)
    expect(screen.getByTestId('tv-epg-grid').parentElement).toHaveStyle({ flex: '0 0 75%' })
    expect(handle).toHaveAttribute('aria-valuenow', '75')

    // Down 600px: 75% - 60% stops at 30%
    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 2 })
    fireEvent.pointerMove(handle, { clientY: 700, pointerId: 2 })
    fireEvent.pointerUp(handle, { clientY: 700, pointerId: 2 })
    expect(useUIStore.getState().epgHeightPercent).toBe(30)
  })

  it('lets the guide be resized from the keyboard on a focusable separator', async () => {
    useUIStore.setState({ isEPGVisible: true, epgHeightPercent: 50 })
    render(<MemoryRouter><TVView /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('player')).toHaveTextContent('https://fixture/a'))
    const handle = screen.getByRole('separator', { name: 'Resize EPG section' })

    expect(handle).toHaveAttribute('tabindex', '0')
    expect(handle).toHaveAttribute('aria-valuenow', '50')
    expect(handle).toHaveAttribute('aria-valuemin', '30')
    expect(handle).toHaveAttribute('aria-valuemax', '75')

    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(useUIStore.getState().epgHeightPercent).toBe(55)
    expect(handle).toHaveAttribute('aria-valuenow', '55')
    expect(screen.getByTestId('tv-epg-grid').parentElement).toHaveStyle({ flex: '0 0 55%' })

    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(useUIStore.getState().epgHeightPercent).toBe(45)

    fireEvent.keyDown(handle, { key: 'End' })
    expect(useUIStore.getState().epgHeightPercent).toBe(75)
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(useUIStore.getState().epgHeightPercent).toBe(30)
  })
})

describe('B-08 store subscriptions', () => {
  it("doesn't re-render the view for store fields it doesn't use", async () => {
    vi.mocked(api.fetchErsatzTVChannels).mockResolvedValue([])
    render(<MemoryRouter><TVView /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('player')).toHaveTextContent('https://fixture/a'))

    // The player is a child of the view, so it renders whenever the view does
    const before = playerProps.renders
    act(() => useTVStore.setState({ liveEPGLoading: true, epgRequestId: 99 }))
    act(() => useErsatztvStore.setState({ loading: true, currentProgramme: null, programmes: [] }))
    expect(playerProps.renders).toBe(before)

    // A field it does use still re-renders it
    act(() => useErsatztvStore.setState({ error: 'Guide failed' }))
    expect(playerProps.renders).toBeGreaterThan(before)
  })
})

describe('A-06 ErsatzTV errors', () => {
  it('shows one toast with a fixed id and Retry instead of a fixed error box, and dismisses it when the error clears', async () => {
    const toastError = vi.spyOn(toast, 'error')
    const toastDismiss = vi.spyOn(toast, 'dismiss')
    vi.mocked(api.fetchErsatzTVChannels).mockRejectedValue(new Error('ErsatzTV unreachable'))
    const loadAllProgrammes = vi.fn().mockResolvedValue(undefined)
    useErsatztvStore.setState({ loadAllProgrammes })

    render(<MemoryRouter><TVView /></MemoryRouter>)
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(toastError).toHaveBeenCalledWith('ErsatzTV unreachable', expect.objectContaining({
      id: 'ersatz-error',
      action: expect.objectContaining({ label: 'Retry' }),
    }))
    // The old fixed bottom-right box is gone; the sidebar keeps an inline Retry
    expect(document.querySelector('.fixed.bottom-4.right-4')).toBeNull()
    expect(screen.getByText("Couldn't load channels 1-36")).toBeVisible()
    // Unrelated re-renders don't raise it again
    act(() => useUIStore.setState({ isTheaterMode: false, isChannelSidebarCollapsed: false, lastTVChannelId: 'x' }))
    expect(toastError).toHaveBeenCalledTimes(1)

    // Retry reloads the channels and the guide
    vi.mocked(api.fetchErsatzTVChannels).mockResolvedValue([{ id: 'e', name: 'Cinema', number: 1, streamUrl: '/e', group: '' }])
    const options = toastError.mock.calls[0][1] as { action: { onClick: () => void } }
    toastDismiss.mockClear()
    vi.mocked(api.fetchErsatzTVChannels).mockClear()
    await act(async () => { options.action.onClick() })
    expect(api.fetchErsatzTVChannels).toHaveBeenCalledTimes(1)
    expect(loadAllProgrammes).toHaveBeenCalledWith(48)
    // The error cleared, so the toast goes
    expect(useErsatztvStore.getState().error).toBeNull()
    expect(toastDismiss).toHaveBeenCalledWith('ersatz-error')

    toastError.mockRestore()
    toastDismiss.mockRestore()
  })
})

describe('E-01 chat placement', () => {
  beforeEach(() => vi.mocked(api.fetchErsatzTVChannels).mockResolvedValue([]))
  afterEach(() => {
    window.matchMedia = originalMatchMedia
    useChatStore.setState({ isOpen: false })
  })

  const openChat = async () => {
    render(<MemoryRouter><TVView /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('player')).toHaveTextContent('https://fixture/a'))
    act(() => useChatStore.setState({ isOpen: true }))
    return screen.getByTestId('chat')
  }

  it.each([390, 768])('takes over the screen on a %ipx phone, agreeing with the phone layout at the edge', async (width) => {
    mockViewport({ width, height: 900, pointer: 'coarse' })
    const chat = await openChat()
    expect(chat).toHaveAttribute('data-variant', 'takeover')
    // The same width lays the view out as a phone: the stacked channel list
    expect(screen.getByRole('heading', { name: 'Channels' }).closest('.epg-scroll')).not.toBeNull()
  })

  it('docks beside the player at 1440px, with the header and its controls still there', async () => {
    mockViewport({ width: 1440 })
    const chat = await openChat()
    expect(chat).toHaveAttribute('data-variant', 'docked')

    const main = screen.getByRole('main')
    expect(chat.parentElement).toBe(main.parentElement)
    expect(main.nextElementSibling).toBe(chat)
    expect(screen.getByRole('banner')).not.toContainElement(chat)
    expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Refresh video' })).toBeVisible()
  })

  it('opens as a sheet inside the content row on a 900px tablet, so it starts below the header', async () => {
    mockViewport({ width: 900 })
    const chat = await openChat()
    expect(chat).toHaveAttribute('data-variant', 'sheet')

    const row = screen.getByRole('main').parentElement as HTMLElement
    expect(chat.parentElement).toBe(row)
    expect(row).toHaveClass('relative')
    expect(screen.getByRole('banner')).toBeVisible()
  })

  // This covers TVView's half, the panel's place in the tree. That ChatPanel
  // keeps its own DOM across the switch is tested in ChatPanel.test.tsx
  it('keeps the panel mounted in place when theater switches it from docked to overlay', async () => {
    mockViewport({ width: 1440 })
    const chat = await openChat()
    expect(chat).toHaveAttribute('data-variant', 'docked')

    act(() => useUIStore.setState({ isTheaterMode: true }))
    expect(screen.getByTestId('chat')).toBe(chat)
    expect(chat).toHaveAttribute('data-variant', 'overlay')
  })

  it('slides over the side in theater', async () => {
    mockViewport({ width: 1440 })
    useUIStore.setState({ isTheaterMode: true })
    const chat = await openChat()
    expect(chat).toHaveAttribute('data-variant', 'overlay')
  })
})
