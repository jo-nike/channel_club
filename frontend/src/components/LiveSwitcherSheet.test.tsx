import { describe, it, expect, beforeEach, vi } from 'vitest'
import { toast } from 'sonner'
import { act, render, screen, fireEvent, waitFor, within } from '@/test/utils'
import { LiveSwitcherSheet } from './LiveSwitcherSheet'
import { useChannelStore } from '@/stores/channelStore'
import { useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useRecentLiveStore } from '@/stores/recentLiveStore'
import { useNhlMappingStore } from '@/stores/nhlMappingStore'
import { useTVStore, LIVE_CHANNEL_ID } from '@/stores/tvStore'
import { usePresenceStore } from '@/stores/presenceStore'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import * as api from '@/services/api'
import type { ChatSendResult } from '@/hooks/useWebSocket'
import type { Channel, GroupedChannelsResponse, PresenceEntry, UnifiedChannel } from '@/types'
import type { GameStatus, NHLBroadcast, NHLGame, NHLScoresResponse } from '@/types/nhl'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

vi.mock('@/services/api', () => ({
  fetchGroupedChannels: vi.fn(),
  fetchNowPlaying: vi.fn(),
  fetchNowPlayingAll: vi.fn(),
  fetchLiveProgrammes: vi.fn(async () => ({ channelId: 'x', programmes: [] })),
  setCurrentChannel: vi.fn(),
  clearCurrentChannel: vi.fn(),
}))

const scores = vi.hoisted(() => ({ data: null as NHLScoresResponse | null, polled: [] as boolean[] }))
// Like the real hook: nothing while it isn't enabled
vi.mock('@/hooks/useNHLScores', () => ({
  useNHLScores: (enabled: boolean) => {
    scores.polled.push(enabled)
    return { data: enabled ? scores.data : null, isLoading: false, error: null, refetch: vi.fn() }
  },
}))

// The watching count's admin-only presence poll
const mockUseActiveUsers = vi.fn(() => ({ data: { liveUsers: [] }, loading: false, error: null }))
vi.mock('@/hooks/useActiveUsers', () => ({
  useActiveUsers: () => mockUseActiveUsers(),
}))

const ch = (id: string, name: string): Channel => ({ id, name, streamUrl: `http://stream${id}.m3u8`, guideId: id })
const tsn5 = ch('1', 'TSN 5')
const sportsnet = ch('2', 'Sportsnet')
const cnn = ch('3', 'CNN')
const cbc = ch('4', 'CBC')
const movies: UnifiedChannel = { id: 'e1', name: 'Movies', number: 1, streamUrl: '/e1', type: 'ersatztv' }

const lineup: GroupedChannelsResponse = {
  groups: [
    { id: 1, name: 'Sports', channelCount: 2, channels: [tsn5, sportsnet] },
    { id: 2, name: 'News', channelCount: 1, channels: [cnn] },
  ],
  ungrouped: [cbc],
}

const team = (abbreviation: string) => ({ name: abbreviation, abbreviation, score: 2, logo: '', logoDark: '' })
const broadcast = (network: string): NHLBroadcast => ({ network, market: 'N', countryCode: 'CA' })
function game(id: number, away: string, home: string, status: GameStatus, broadcasts: NHLBroadcast[]): NHLGame {
  return {
    id,
    status,
    awayTeam: team(away),
    homeTeam: team(home),
    startTime: `2026-10-11T2${id}:00:00Z`,
    gameCenterLink: '',
    period: '3RD',
    timeRemaining: '4:32',
    broadcasts,
  }
}
function setGames(games: NHLGame[]) {
  scores.data = { games, date: '2026-10-11', liveGameCount: games.filter((g) => g.status === 'live').length }
}

function renderSheet() {
  const onOpenChange = vi.fn()
  render(<LiveSwitcherSheet open onOpenChange={onOpenChange} />)
  return onOpenChange
}

const section = (name: string) => screen.getByRole('region', { name })

const here = (userId: string, displayName: string, view: PresenceEntry['view'], channelName: string | null = null): PresenceEntry => ({
  userId,
  displayName,
  channelId: null,
  channelName,
  programme: null,
  view,
  since: null,
})

describe('LiveSwitcherSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChannelStore.setState({ currentChannel: cbc })
    useAuthStore.setState({ token: 'test-token', role: 'viewer', username: 'sam', isAuthenticated: true })
    useSettingsStore.setState({
      userChannelSelection: true,
      presenceVisible: false,
      serverFeatures: { chat: false, gif: false, nhl: true, sources: { dispatcharr: true, ersatztv: true } },
    })
    scores.polled = []
    useUIStore.setState({ hideMyActivity: false })
    usePresenceStore.setState({ entries: [] })
    useChatStore.setState({ nickname: null, me: { username: 'sam', userId: 'u_sam' } })
    useRecentLiveStore.setState({ byUser: {} })
    useNhlMappingStore.setState({ overrides: {} })
    // The person opening the switcher is watching an ErsatzTV channel
    useTVStore.setState({ selectedChannel: movies })
    vi.mocked(api.fetchGroupedChannels).mockResolvedValue(lineup)
    vi.mocked(api.fetchNowPlaying).mockResolvedValue({ channelId: 'x', currentProgram: null })
    vi.mocked(api.fetchNowPlayingAll).mockResolvedValue({})
    vi.mocked(api.setCurrentChannel).mockImplementation(async (channel) => channel)
    setGames([
      game(1, 'TOR', 'MTL', 'live', [broadcast('TSN5')]),
      // Live but on no channel in the lineup, and one on your channels not started yet
      game(2, 'LAK', 'ANA', 'live', [broadcast('KCOP-13')]),
      game(3, 'EDM', 'CGY', 'scheduled', [broadcast('SN')]),
    ])
  })

  it('has no sports on now, and asks for no scores, while the server has NHL scores off', async () => {
    useSettingsStore.setState({ serverFeatures: { chat: false, gif: false, nhl: false, sources: { dispatcharr: true, ersatztv: true } } })
    renderSheet()

    await screen.findByText('Sports')
    expect(screen.queryByRole('region', { name: 'Sports on now' })).not.toBeInTheDocument()
    expect(scores.polled).not.toContain(true)
  })

  it('shows on air, sports on now, recents, then the full lineup, in that order', async () => {
    useRecentLiveStore.getState().record('sam', cnn.id)
    renderSheet()

    await screen.findByRole('region', { name: 'Sports on now' })
    await screen.findByRole('region', { name: 'Recent' })
    await screen.findByText('Sports')
    expect(screen.getByRole('dialog', { name: 'Live TV' })).toBeInTheDocument()
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual([
      'On air',
      'Sports on now',
      'Recent',
      'All channels',
    ])
    expect(within(section('On air')).getByText('CBC')).toBeInTheDocument()
  })

  it('lists only the live games on your channels, each with the channels showing it', async () => {
    renderSheet()

    const sports = await screen.findByRole('region', { name: 'Sports on now' })
    expect(within(sports).getByText('TOR')).toBeInTheDocument()
    expect(within(sports).getByText('3RD 4:32')).toBeInTheDocument()
    expect(within(sports).queryByText('LAK')).not.toBeInTheDocument()
    expect(within(sports).queryByText('EDM')).not.toBeInTheDocument()
    const channels = within(sports).getByRole('group', { name: 'Channels showing TOR at MTL' })
    expect(within(channels).getAllByRole('button').map((b) => b.textContent)).toEqual(['TSN 5'])
  })

  it('puts a game on live TV from its chip, closes, then tunes the person to channel 0', async () => {
    let accept!: (channel: Channel) => void
    vi.mocked(api.setCurrentChannel).mockReturnValueOnce(new Promise((r) => { accept = r }))
    const onOpenChange = renderSheet()

    const sports = await screen.findByRole('region', { name: 'Sports on now' })
    fireEvent.click(within(sports).getByRole('button', { name: 'TSN 5' }))

    expect(api.setCurrentChannel).toHaveBeenCalledWith(tsn5)
    expect(useChannelStore.getState().currentChannel).toEqual(tsn5)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    // Still on their own channel until the server accepts the switch
    expect(useTVStore.getState().selectedChannel).toEqual(movies)

    await act(async () => accept(tsn5))
    expect(useTVStore.getState().selectedChannel).toMatchObject({ id: LIVE_CHANNEL_ID, streamUrl: tsn5.streamUrl })
    expect(useRecentLiveStore.getState().byUser.sam).toEqual([tsn5.id])
  })

  it('marks the channel already on air instead of offering it', async () => {
    useChannelStore.setState({ currentChannel: tsn5 })
    renderSheet()

    const sports = await screen.findByRole('region', { name: 'Sports on now' })
    const chip = within(sports).getByRole('button', { name: /TSN 5/ })
    expect(chip).toBeDisabled()
    expect(chip).toHaveTextContent('On air')
  })

  it('leaves Sports on now out when no live game is on your channels', async () => {
    setGames([game(2, 'LAK', 'ANA', 'live', [broadcast('KCOP-13')])])
    renderSheet()

    await screen.findByText('Sports')
    expect(screen.queryByRole('region', { name: 'Sports on now' })).not.toBeInTheDocument()
  })

  it('uses a network pinned on this browser', async () => {
    useNhlMappingStore.setState({ overrides: { 'KCOP-13': cnn.id } })
    renderSheet()

    const sports = await screen.findByRole('region', { name: 'Sports on now' })
    const lak = within(sports).getByRole('group', { name: 'Channels showing LAK at ANA' })
    expect(within(lak).getByRole('button', { name: 'CNN' })).toBeInTheDocument()
  })

  it("offers the person's recent channels except the one on air, and switches and tunes to one", async () => {
    const { record } = useRecentLiveStore.getState()
    record('sam', sportsnet.id)
    record('sam', cbc.id)
    record('sam', cnn.id)
    const onOpenChange = renderSheet()

    const recent = await screen.findByRole('region', { name: 'Recent' })
    expect(within(recent).getAllByRole('button').map((b) => b.textContent)).toEqual(['CNN', 'Sportsnet'])

    fireEvent.click(within(recent).getByRole('button', { name: 'Sportsnet' }))
    expect(api.setCurrentChannel).toHaveBeenCalledWith(sportsnet)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    await waitFor(() => expect(useTVStore.getState().selectedChannel).toMatchObject({ id: LIVE_CHANNEL_ID, streamUrl: sportsnet.streamUrl }))
  })

  it('has no Recent section for someone who has not switched yet', async () => {
    useRecentLiveStore.getState().record('jon', cnn.id)
    renderSheet()

    await screen.findByText('Sports')
    await screen.findByRole('region', { name: 'Sports on now' })
    expect(screen.queryByRole('region', { name: 'Recent' })).not.toBeInTheDocument()
  })

  it('puts a channel from the full lineup on live TV, closes and tunes the person to it', async () => {
    const onOpenChange = renderSheet()

    const all = section('All channels')
    fireEvent.click(await within(all).findByText('News'))
    fireEvent.click(within(all).getByText('CNN'))

    expect(api.setCurrentChannel).toHaveBeenCalledWith(cnn)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    await waitFor(() => expect(useTVStore.getState().selectedChannel).toMatchObject({ id: LIVE_CHANNEL_ID, streamUrl: cnn.streamUrl }))
  })

  it('keeps Stop live TV and the watching count from viewers', async () => {
    renderSheet()

    await screen.findByRole('region', { name: 'Sports on now' })
    expect(within(section('On air')).queryByRole('button', { name: /stop live tv/i })).not.toBeInTheDocument()
    expect(mockUseActiveUsers).not.toHaveBeenCalled()
  })

  it('gives admins Stop live TV', async () => {
    useAuthStore.setState({ role: 'admin', username: 'jon' })
    renderSheet()

    await screen.findByRole('region', { name: 'Sports on now' })
    expect(within(section('On air')).getByRole('button', { name: /stop live tv/i })).toBeInTheDocument()
  })

  it("opens with focus on the dialog, not an admin's Stop live TV", async () => {
    useAuthStore.setState({ role: 'admin', username: 'jon' })
    renderSheet()

    await screen.findByRole('region', { name: 'Sports on now' })
    const stop = within(section('On air')).getByRole('button', { name: /stop live tv/i })
    const dialog = screen.getByRole('dialog', { name: 'Live TV' })
    expect(document.activeElement).toBe(dialog)
    expect(stop).not.toHaveFocus()
  })

  describe('Suggest a channel, for a viewer who cannot change live TV', () => {
    const onSuggest = vi.fn<(channel: Channel) => Promise<ChatSendResult>>(async () => 'acknowledged')

    function renderSuggest() {
      const onOpenChange = vi.fn()
      render(<LiveSwitcherSheet open onOpenChange={onOpenChange} onSuggest={onSuggest} />)
      return onOpenChange
    }

    beforeEach(() => {
      useSettingsStore.setState({ userChannelSelection: false })
    })

    it('says it suggests rather than switches', async () => {
      renderSuggest()

      await screen.findByRole('region', { name: 'Sports on now' })
      expect(screen.getByRole('dialog', { name: 'Suggest a channel' })).toBeInTheDocument()
      expect(screen.getByText(/suggest in chat/)).toBeInTheDocument()
    })

    it('suggests a game from its chip instead of switching, closes and confirms it once posted', async () => {
      const onOpenChange = renderSuggest()

      const sports = await screen.findByRole('region', { name: 'Sports on now' })
      const chip = within(sports).getByRole('button', { name: 'TSN 5' })
      expect(chip).toHaveAttribute('title', 'Suggest TSN 5 in chat')
      fireEvent.click(chip)

      expect(onSuggest).toHaveBeenCalledWith(tsn5)
      expect(api.setCurrentChannel).not.toHaveBeenCalled()
      expect(useChannelStore.getState().currentChannel).toEqual(cbc)
      expect(onOpenChange).toHaveBeenCalledWith(false)
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Suggested TSN 5 in chat'))
      // Nobody is tuned anywhere by a suggestion
      expect(useTVStore.getState().selectedChannel).toEqual(movies)
    })

    it('suggests a channel from the full lineup, closing once', async () => {
      const onOpenChange = renderSuggest()

      const all = section('All channels')
      fireEvent.click(await within(all).findByText('News'))
      fireEvent.click(within(all).getByText('CNN'))

      expect(onSuggest).toHaveBeenCalledWith(cnn)
      expect(api.setCurrentChannel).not.toHaveBeenCalled()
      expect(onOpenChange).toHaveBeenCalledTimes(1)
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('says so when the suggestion is not posted', async () => {
      onSuggest.mockResolvedValueOnce('not-sent')
      renderSuggest()

      const sports = await screen.findByRole('region', { name: 'Sports on now' })
      fireEvent.click(within(sports).getByRole('button', { name: 'TSN 5' }))

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('Could not suggest TSN 5', { description: 'Please try again' })
      )
      expect(toast.success).not.toHaveBeenCalled()
    })

    it('warns when the server never confirmed it', async () => {
      onSuggest.mockResolvedValueOnce('unconfirmed')
      renderSuggest()

      const sports = await screen.findByRole('region', { name: 'Sports on now' })
      fireEvent.click(within(sports).getByRole('button', { name: 'TSN 5' }))

      await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1))
      expect(toast.success).not.toHaveBeenCalled()
    })

    it('points to suggesting when nothing is on live TV', async () => {
      useChannelStore.setState({ currentChannel: null })
      renderSuggest()

      expect(await within(section('On air')).findByText(/suggest it in chat/)).toBeInTheDocument()
    })

    it('switches as usual for a viewer the admin allows, even with Suggest on offer', async () => {
      useSettingsStore.setState({ userChannelSelection: true })
      renderSuggest()

      const sports = await screen.findByRole('region', { name: 'Sports on now' })
      fireEvent.click(within(sports).getByRole('button', { name: 'TSN 5' }))

      expect(screen.queryByRole('dialog', { name: 'Suggest a channel' })).not.toBeInTheDocument()
      expect(api.setCurrentChannel).toHaveBeenCalledWith(tsn5)
      expect(onSuggest).not.toHaveBeenCalled()
    })

    it('switches as usual for an admin', async () => {
      useAuthStore.setState({ role: 'admin', username: 'jon' })
      renderSuggest()

      const sports = await screen.findByRole('region', { name: 'Sports on now' })
      fireEvent.click(within(sports).getByRole('button', { name: 'TSN 5' }))

      expect(api.setCurrentChannel).toHaveBeenCalledWith(tsn5)
      expect(onSuggest).not.toHaveBeenCalled()
    })
  })

  describe("who's watching", () => {
    beforeEach(() => {
      usePresenceStore.setState({
        entries: [
          here('u_sam', 'sam', 'live', 'CBC'),
          here('u_maya', 'maya', 'live', 'CBC'),
          here('u_dev', 'dev', 'live', 'CBC'),
          here('u_ali', 'ali', 'ersatztv', 'Movies'),
        ],
      })
    })

    it('names the others on live TV while presence is visible', async () => {
      useSettingsStore.setState({ presenceVisible: true })
      renderSheet()

      await screen.findByRole('region', { name: 'Sports on now' })
      // Not the person looking, nor someone on another channel
      expect(within(section('On air')).getByText('maya and dev are watching')).toBeInTheDocument()
      expect(within(section('On air')).queryByText(/ali/)).not.toBeInTheDocument()
    })

    it('says "is" for one person', async () => {
      useSettingsStore.setState({ presenceVisible: true })
      usePresenceStore.setState({ entries: [here('u_maya', 'maya', 'live', 'CBC')] })
      renderSheet()

      expect(await within(section('On air')).findByText('maya is watching')).toBeInTheDocument()
    })

    it('names nobody while the admin keeps what everyone watches private', async () => {
      renderSheet()

      await screen.findByRole('region', { name: 'Sports on now' })
      expect(within(section('On air')).queryByText(/watching/)).not.toBeInTheDocument()
    })

    it('names nobody to someone who hides what they watch', async () => {
      useSettingsStore.setState({ presenceVisible: true })
      useUIStore.setState({ hideMyActivity: true })
      renderSheet()

      await screen.findByRole('region', { name: 'Sports on now' })
      expect(within(section('On air')).queryByText(/watching/)).not.toBeInTheDocument()
    })

    it('has no line while nobody else is on live TV', async () => {
      useSettingsStore.setState({ presenceVisible: true })
      usePresenceStore.setState({ entries: [here('u_sam', 'sam', 'live', 'CBC'), here('u_ali', 'ali', 'ersatztv', 'Movies')] })
      renderSheet()

      await screen.findByRole('region', { name: 'Sports on now' })
      expect(within(section('On air')).queryByText(/watching/)).not.toBeInTheDocument()
    })

    it('follows the presence snapshot as people come and go', async () => {
      useSettingsStore.setState({ presenceVisible: true })
      renderSheet()

      expect(await within(section('On air')).findByText('maya and dev are watching')).toBeInTheDocument()
      act(() => usePresenceStore.setState({ entries: [here('u_dev', 'dev', 'live', 'CBC')] }))
      expect(within(section('On air')).getByText('dev is watching')).toBeInTheDocument()
    })
  })

  it('loads nothing while closed', async () => {
    render(<LiveSwitcherSheet open={false} onOpenChange={vi.fn()} />)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.fetchGroupedChannels).not.toHaveBeenCalled()
  })
})
