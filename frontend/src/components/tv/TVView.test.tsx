import { act, render, screen, waitFor } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { TVView } from './TVView'
import { useChannelStore } from '@/stores/channelStore'
import { useTVStore } from '@/stores/tvStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useUIStore } from '@/stores/uiStore'
import * as api from '@/services/ersatztvApi'
import { fetchNowPlaying } from '@/services/api'
const presence = vi.hoisted(() => vi.fn())
vi.mock('@/services/api', () => ({ fetchNowPlaying: vi.fn() }))
import type { UnifiedChannel } from '@/types'

vi.mock('@/services/ersatztvApi', () => ({ fetchErsatzTVChannels: vi.fn(), fetchErsatzTVCurrentProgramme: vi.fn(), getErsatzTVLogoUrl: vi.fn() }))
vi.mock('@/hooks/useWebSocket', () => ({ useWebSocket: () => ({ status: 'connected', sendChannelUpdate: presence, sendChatMessage: vi.fn(), sendSetNickname: vi.fn() }) }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false, logout: vi.fn() }) }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => ({ userChannelSelection: false }) }))
vi.mock('@/hooks/useTheme', () => ({ useTheme: vi.fn() }))
vi.mock('@/components/tv/DualModeVideoPlayer', () => ({ DualModeVideoPlayer: ({ channel }: { channel: UnifiedChannel | null }) => <div data-testid="player">{channel?.streamUrl || 'No live broadcast'}</div> }))
vi.mock('@/components/tv/TVEPGGrid', () => ({ TVEPGGrid: () => null }))
vi.mock('@/components/ChatPanel', () => ({ ChatPanel: () => null }))
vi.mock('@/components/ersatztv/ProgrammeDetailsModal', () => ({ ProgrammeDetailsModal: () => null }))
vi.mock('@/components/UserSettingsMenu', () => ({ UserSettingsMenu: () => null }))
vi.mock('@/components/FeedbackButton', () => ({ FeedbackButton: () => null }))
vi.mock('@/components/AdminModal', () => ({ AdminModal: () => null }))
vi.mock('@/components/NHLScoresOverlay', () => ({ NHLScoresOverlay: () => null }))

beforeEach(() => {
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
    expect(presence).toHaveBeenLastCalledWith('Cinema', 'Second', 'ersatztv')
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
    expect(presence).toHaveBeenLastCalledWith('A', 'Next live', 'live')
  })
})
