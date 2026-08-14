import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@/test/utils'
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

  it('renders the live channel selection setting', async () => {
    render(<UserAccessTab />)

    expect(screen.getByText('Live Channel Selection')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /disabled/i })).toBeInTheDocument()
    })
  })

  it('reflects the setting fetched from the server', async () => {
    vi.mocked(api.fetchAppSettings).mockResolvedValue({ userChannelSelection: true })

    render(<UserAccessTab />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /enabled/i })).toBeInTheDocument()
    })
  })

  it('enables the setting when toggled on', async () => {
    vi.mocked(api.updateAppSettings).mockResolvedValue({ userChannelSelection: true })

    render(<UserAccessTab />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /disabled/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /disabled/i }))

    await waitFor(() => {
      expect(vi.mocked(api.updateAppSettings)).toHaveBeenCalledWith({
        userChannelSelection: true,
      })
    })
    expect(useSettingsStore.getState().userChannelSelection).toBe(true)
  })

  it('disables the setting when toggled off', async () => {
    vi.mocked(api.fetchAppSettings).mockResolvedValue({ userChannelSelection: true })
    vi.mocked(api.updateAppSettings).mockResolvedValue({ userChannelSelection: false })

    render(<UserAccessTab />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /enabled/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /enabled/i }))

    await waitFor(() => {
      expect(vi.mocked(api.updateAppSettings)).toHaveBeenCalledWith({
        userChannelSelection: false,
      })
    })
    expect(useSettingsStore.getState().userChannelSelection).toBe(false)
  })

  it('reverts and shows an error when the update fails', async () => {
    vi.mocked(api.updateAppSettings).mockRejectedValue(new Error('Only admins can change settings'))

    render(<UserAccessTab />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /disabled/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /disabled/i }))

    await waitFor(() => {
      expect(screen.getByText('Only admins can change settings')).toBeInTheDocument()
    })
    expect(useSettingsStore.getState().userChannelSelection).toBe(false)
  })
})
