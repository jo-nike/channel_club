import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@/test/utils'
import { PeopleTab } from './PeopleTab'
import { useSettingsStore } from '@/stores/settingsStore'
import * as api from '@/services/api'

vi.mock('@/services/api', () => ({
  fetchAppSettings: vi.fn(),
  updateAppSettings: vi.fn(),
}))

vi.mock('@/hooks/useActiveUsers', () => ({
  useActiveUsers: () => ({
    data: {
      liveUsers: [
        { username: 'jon', channel: 'TSN 1', programme: null, connectedSince: '2026-01-04T11:00:00Z' },
        { username: 'jon', channel: 'CBC', programme: null, connectedSince: '2026-01-04T11:30:00Z' },
      ],
      ersatztvUsers: [],
      totals: { liveCount: 2, ersatztvCount: 0 },
    },
    loading: false,
    error: null,
    lastUpdated: null,
    isRefreshing: false,
    refetch: vi.fn(),
  }),
}))

describe('PeopleTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ userChannelSelection: false, presenceVisible: false })
    vi.mocked(api.fetchAppSettings).mockResolvedValue({ userChannelSelection: false, presenceVisible: false })
    vi.mocked(api.updateAppSettings).mockResolvedValue({ userChannelSelection: true })
  })

  it('shows who is here above what users may do', async () => {
    render(<PeopleTab />)
    await act(async () => {})

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual(['Active Users', 'User Access'])

    // One person, with both of their sessions
    expect(screen.getAllByText('jon')).toHaveLength(1)
    expect(within(screen.getByRole('list', { name: "jon's sessions" })).getAllByRole('listitem'))
      .toHaveLength(2)
  })

  it('lets the admin open channel switching to everyone from the same tab', async () => {
    render(<PeopleTab />)
    await act(async () => {})

    const toggle = screen.getByRole('switch', { name: 'Users can set the live channel' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await waitFor(() => {
      expect(api.updateAppSettings).toHaveBeenCalledWith({ userChannelSelection: true })
    })
  })

  it("has a 'Show what everyone is watching' switch, off by default, that tells the admin to ask first", async () => {
    render(<PeopleTab />)
    await act(async () => {})

    const toggle = screen.getByRole('switch', { name: 'Show what everyone is watching' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(toggle).toHaveAccessibleDescription('Others see only who is online')
    expect(screen.getByText(/Ask the\s+group before turning this on/)).toBeInTheDocument()
    expect(screen.getByText(/Admins still see\s+everything in Active Users/)).toBeInTheDocument()
    expect(screen.getByText(/resets to off when the server restarts/)).toBeInTheDocument()
  })

  it('shows everyone what everyone is watching once the admin switches it on', async () => {
    vi.mocked(api.updateAppSettings).mockResolvedValue({ userChannelSelection: false, presenceVisible: true })
    render(<PeopleTab />)
    await act(async () => {})

    const toggle = screen.getByRole('switch', { name: 'Show what everyone is watching' })
    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await waitFor(() => {
      expect(api.updateAppSettings).toHaveBeenCalledWith({ presenceVisible: true })
    })
    expect(api.updateAppSettings).not.toHaveBeenCalledWith(
      expect.objectContaining({ userChannelSelection: expect.anything() }),
    )
    expect(useSettingsStore.getState().presenceVisible).toBe(true)
    expect(toggle).toHaveAccessibleDescription('Everyone can see who is watching what')
    // The other setting is untouched
    expect(screen.getByRole('switch', { name: 'Users can set the live channel' }))
      .toHaveAttribute('aria-checked', 'false')
  })
})
