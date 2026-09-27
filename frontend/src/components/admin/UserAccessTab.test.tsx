import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@/test/utils'
import { UserAccessTab } from './UserAccessTab'
import { useSettingsStore } from '@/stores/settingsStore'
import * as api from '@/services/api'

vi.mock('@/services/api', () => ({
  fetchAppSettings: vi.fn(),
  updateAppSettings: vi.fn(),
}))

describe('UserAccessTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ userChannelSelection: false })
    vi.mocked(api.fetchAppSettings).mockResolvedValue({ userChannelSelection: false })
  })

  // Let the mount fetch land first, so it can't overwrite the toggle mid-test
  const settled = () => act(async () => {})

  const liveChannelSwitch = () =>
    screen.getByRole('switch', { name: 'Users can set the live channel' })

  it('renders the live channel selection setting as a switch', async () => {
    render(<UserAccessTab />)

    expect(screen.getByText('Live Channel Selection')).toBeInTheDocument()
    expect(liveChannelSwitch()).toHaveAttribute('aria-checked', 'false')
    expect(liveChannelSwitch()).toHaveAccessibleDescription('Only admins can change the channel')
    // Persistence is deferred, so the card stays honest about it
    expect(screen.getByText(/resets when the\s+server restarts/)).toBeInTheDocument()
    await waitFor(() => expect(api.fetchAppSettings).toHaveBeenCalled())
  })

  it('reflects the setting fetched from the server', async () => {
    vi.mocked(api.fetchAppSettings).mockResolvedValue({ userChannelSelection: true })

    render(<UserAccessTab />)

    await waitFor(() => {
      expect(liveChannelSwitch()).toHaveAttribute('aria-checked', 'true')
    })
    expect(liveChannelSwitch()).toHaveAccessibleDescription('Anyone watching can change the channel')
  })

  it('turns on at once (optimistically) and saves the setting', async () => {
    let resolveUpdate: (value: { userChannelSelection: boolean }) => void = () => {}
    vi.mocked(api.updateAppSettings).mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = resolve
      })
    )

    render(<UserAccessTab />)
    await settled()

    fireEvent.click(liveChannelSwitch())

    // On before the server answers, and locked until it does
    expect(liveChannelSwitch()).toHaveAttribute('aria-checked', 'true')
    expect(liveChannelSwitch()).toBeDisabled()
    expect(vi.mocked(api.updateAppSettings)).toHaveBeenCalledWith({
      userChannelSelection: true,
    })

    await act(async () => resolveUpdate({ userChannelSelection: true }))

    expect(liveChannelSwitch()).toBeEnabled()
    expect(liveChannelSwitch()).toHaveAttribute('aria-checked', 'true')
    expect(useSettingsStore.getState().userChannelSelection).toBe(true)
  })

  it('turns off when switched off', async () => {
    vi.mocked(api.fetchAppSettings).mockResolvedValue({ userChannelSelection: true })
    vi.mocked(api.updateAppSettings).mockResolvedValue({ userChannelSelection: false })

    render(<UserAccessTab />)

    await waitFor(() => {
      expect(liveChannelSwitch()).toHaveAttribute('aria-checked', 'true')
    })
    fireEvent.click(liveChannelSwitch())

    await waitFor(() => {
      expect(vi.mocked(api.updateAppSettings)).toHaveBeenCalledWith({
        userChannelSelection: false,
      })
    })
    expect(liveChannelSwitch()).toHaveAttribute('aria-checked', 'false')
    expect(useSettingsStore.getState().userChannelSelection).toBe(false)
  })

  it('reverts the switch and shows an error when the update fails', async () => {
    vi.mocked(api.updateAppSettings).mockRejectedValue(new Error('Only admins can change settings'))

    render(<UserAccessTab />)
    await settled()

    fireEvent.click(liveChannelSwitch())

    await waitFor(() => {
      expect(screen.getByText('Only admins can change settings')).toBeInTheDocument()
    })
    expect(liveChannelSwitch()).toHaveAttribute('aria-checked', 'false')
    expect(liveChannelSwitch()).toBeEnabled()
    expect(useSettingsStore.getState().userChannelSelection).toBe(false)
  })
})
