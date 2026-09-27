import { act, fireEvent, render, screen, waitFor } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { TVView } from './TVView'
import { useChannelStore } from '@/stores/channelStore'
import { useTVStore } from '@/stores/tvStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import * as api from '@/services/ersatztvApi'
import { fetchNowPlaying } from '@/services/api'
const presence = vi.hoisted(() => vi.fn())
const crash = vi.hoisted(() => ({ player: false, chat: false }))
const socket = vi.hoisted(() => ({ status: 'connected', reconnect: () => {} }))
const chatProps = vi.hoisted(() => ({ last: null as null | { status?: string; onReconnect?: () => void } }))
vi.mock('@/services/api', () => ({ fetchNowPlaying: vi.fn() }))
import type { UnifiedChannel } from '@/types'

vi.mock('@/services/ersatztvApi', () => ({ fetchErsatzTVChannels: vi.fn(), fetchErsatzTVCurrentProgramme: vi.fn(), getErsatzTVLogoUrl: vi.fn() }))
vi.mock('@/hooks/useWebSocket', () => ({ useWebSocket: () => ({ status: socket.status, reconnect: socket.reconnect, sendChannelUpdate: presence, sendChatMessage: vi.fn(), sendSetNickname: vi.fn() }) }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false, logout: vi.fn() }) }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => ({ userChannelSelection: false }) }))
vi.mock('@/components/tv/DualModeVideoPlayer', () => ({ DualModeVideoPlayer: ({ channel }: { channel: UnifiedChannel | null }) => {
  if (crash.player) throw new Error('player exploded')
  return <div data-testid="player">{channel?.streamUrl || 'No live broadcast'}</div>
} }))
vi.mock('@/components/tv/TVEPGGrid', () => ({ TVEPGGrid: () => null }))
vi.mock('@/components/ChatPanel', async () => {
  const { useChatStore } = await import('@/stores/chatStore')
  // Like the real panel, renders nothing (and so can't throw) while closed
  return { ChatPanel: (props: { status?: string; onReconnect?: () => void }) => {
    chatProps.last = props
    const isOpen = useChatStore((s) => s.isOpen)
    if (crash.chat && isOpen) throw new Error('chat exploded')
    return null
  } }
})
vi.mock('@/components/ersatztv/ProgrammeDetailsModal', () => ({ ProgrammeDetailsModal: () => null }))
vi.mock('@/components/UserSettingsMenu', () => ({ UserSettingsMenu: () => null }))
vi.mock('@/components/FeedbackButton', () => ({ FeedbackButton: () => null }))
vi.mock('@/components/AdminModal', () => ({ AdminModal: () => null }))
vi.mock('@/components/NHLScoresOverlay', () => ({ NHLScoresOverlay: () => null }))

beforeEach(() => {
  socket.status = 'connected'
  chatProps.last = null
  crash.player = false
  crash.chat = false
  useChatStore.setState({ isOpen: false })
  useTVStore.setState({ selectedChannel: null, liveEPG: null })
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
    expect(screen.getByText('Cinema - First')).toBeVisible()
    await act(() => vi.advanceTimersByTimeAsync(30000))
    expect(screen.getByText('Cinema - Second')).toBeVisible()
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
    expect(screen.getByText('A - First live')).toBeVisible()
    await act(() => vi.advanceTimersByTimeAsync(10000))
    expect(screen.getByText('A - Next live')).toBeVisible()
    expect(presence).toHaveBeenLastCalledWith('A', 'Next live', 'live', 'a')
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

describe('E-V1 chat connection state', () => {
  it('hands the socket status and reconnect to the chat panel', () => {
    vi.mocked(api.fetchErsatzTVChannels).mockResolvedValue([])
    socket.status = 'disconnected'
    render(<MemoryRouter><TVView /></MemoryRouter>)
    expect(chatProps.last?.status).toBe('disconnected')
    expect(chatProps.last?.onReconnect).toBe(socket.reconnect)
  })
})

describe('G-03 phone portrait layout', () => {
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
