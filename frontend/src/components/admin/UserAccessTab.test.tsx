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
    useSettingsStore.setState({ userChannelSelection: false, presenceVisible: false })
    vi.mocked(api.fetchAppSettings).mockResolvedValue({ userChannelSelection: false, presenceVisible: false })
  })

  // Let the mount fetch land first, so it can't overwrite the toggle mid-test
  const settled = () => act(async () => {})

  const liveChannelSwitch = () =>
    screen.getByRole('switch', { name: 'Users can set the live channel' })
  const presenceSwitch = () =>
    screen.getByRole('switch', { name: 'Show what everyone is watching' })

  it("says viewing is recorded for the host's stats whichever way presence is set", async () => {
    render(<UserAccessTab />)
    await settled()

    expect(
      screen.getByText(/Viewing is recorded for the host's stats whichever way it is set\./),
    ).toBeInTheDocument()
  })

  it('renders the live channel selection setting as a switch', async () => {
    render(<UserAccessTab />)

    expect(screen.getByText('Live Channel Selection')).toBeInTheDocument()
    expect(liveChannelSwitch()).toHaveAttribute('aria-checked', 'false')
    expect(liveChannelSwitch()).toHaveAccessibleDescription('Only admins can change the channel')
    // The setting is saved to the server's state file
    expect(screen.getByText(/admin-only\. This setting is kept when the\s+server restarts/)).toBeInTheDocument()
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

  describe('Show what everyone is watching', () => {
    it('reflects the setting fetched from the server', async () => {
      vi.mocked(api.fetchAppSettings).mockResolvedValue({ userChannelSelection: false, presenceVisible: true })

      render(<UserAccessTab />)

      await waitFor(() => {
        expect(presenceSwitch()).toHaveAttribute('aria-checked', 'true')
      })
      expect(useSettingsStore.getState().presenceVisible).toBe(true)
    })

    it('reads a server without the setting as off', async () => {
      useSettingsStore.setState({ presenceVisible: true })
      vi.mocked(api.fetchAppSettings).mockResolvedValue({ userChannelSelection: false })

      render(<UserAccessTab />)

      await waitFor(() => {
        expect(presenceSwitch()).toHaveAttribute('aria-checked', 'false')
      })
    })

    it('turns off again when switched off', async () => {
      vi.mocked(api.fetchAppSettings).mockResolvedValue({ userChannelSelection: false, presenceVisible: true })
      vi.mocked(api.updateAppSettings).mockResolvedValue({ userChannelSelection: false, presenceVisible: false })

      render(<UserAccessTab />)
      await waitFor(() => {
        expect(presenceSwitch()).toHaveAttribute('aria-checked', 'true')
      })
      fireEvent.click(presenceSwitch())

      await waitFor(() => {
        expect(vi.mocked(api.updateAppSettings)).toHaveBeenCalledWith({ presenceVisible: false })
      })
      expect(presenceSwitch()).toHaveAttribute('aria-checked', 'false')
      expect(useSettingsStore.getState().presenceVisible).toBe(false)
    })

    it('locks both switches while one is saving', async () => {
      let resolveUpdate: (value: { userChannelSelection: boolean; presenceVisible: boolean }) => void = () => {}
      vi.mocked(api.updateAppSettings).mockReturnValue(
        new Promise((resolve) => {
          resolveUpdate = resolve
        })
      )

      render(<UserAccessTab />)
      await settled()

      fireEvent.click(presenceSwitch())

      expect(presenceSwitch()).toBeDisabled()
      expect(liveChannelSwitch()).toBeDisabled()

      await act(async () => resolveUpdate({ userChannelSelection: false, presenceVisible: true }))

      expect(presenceSwitch()).toBeEnabled()
      expect(liveChannelSwitch()).toBeEnabled()
    })

    it('reverts only this switch, with the error on its own card, when the update fails', async () => {
      vi.mocked(api.updateAppSettings).mockRejectedValue(new Error('Only admins can change settings'))

      render(<UserAccessTab />)
      await settled()

      fireEvent.click(presenceSwitch())

      const error = await screen.findByText('Only admins can change settings')
      expect(presenceSwitch()).toHaveAttribute('aria-checked', 'false')
      expect(useSettingsStore.getState().presenceVisible).toBe(false)
      // Shown in the presence card, next to the switch that failed
      expect(error.closest('[data-slot="card"]')).toContainElement(presenceSwitch())
      expect(error.closest('[data-slot="card"]')).not.toContainElement(liveChannelSwitch())
    })
  })
})
