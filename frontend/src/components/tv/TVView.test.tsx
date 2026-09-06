import { act, render, screen, waitFor } from '@/test/utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { TVView } from './TVView'
import { useChannelStore } from '@/stores/channelStore'
import { useTVStore } from '@/stores/tvStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useUIStore } from '@/stores/uiStore'
import * as api from '@/services/ersatztvApi'
import type { UnifiedChannel } from '@/types'

vi.mock('@/services/ersatztvApi', () => ({ fetchErsatzTVChannels: vi.fn(), fetchErsatzTVCurrentProgramme: vi.fn(), getErsatzTVLogoUrl: vi.fn() }))
vi.mock('@/hooks/useWebSocket', () => ({ useWebSocket: () => ({ status: 'connected', sendChannelUpdate: vi.fn(), sendChatMessage: vi.fn(), sendSetNickname: vi.fn() }) }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false, logout: vi.fn() }) }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => ({ userChannelSelection: false }) }))
vi.mock('@/hooks/useTheme', () => ({ useTheme: vi.fn() }))
vi.mock('@/components/tv/DualModeVideoPlayer', () => ({ DualModeVideoPlayer: ({ channel }: { channel: UnifiedChannel | null }) => <div data-testid="player">{channel?.streamUrl || 'No live broadcast'}</div> }))
vi.mock('@/components/tv/TVEPGGrid', () => ({ TVEPGGrid: () => null }))
vi.mock('@/components/ChatPanel', () => ({ ChatPanel: () => null }))
vi.mock('@/components/ProgrammeDetailsModal', () => ({}))
vi.mock('@/components/ersatztv/ProgrammeDetailsModal', () => ({ ProgrammeDetailsModal: () => null }))
vi.mock('@/components/UserSettingsMenu', () => ({ UserSettingsMenu: () => null }))
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
