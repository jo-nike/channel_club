import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
import { StopLiveTVDialog } from './StopLiveTVDialog'
import { useAuthStore } from '@/stores/authStore'

interface MockActiveUsers {
  data: { liveUsers: { username: string; onLive: boolean }[] } | null
  loading: boolean
  error: string | null
}

const mockUseActiveUsers = vi.fn<() => MockActiveUsers>()
vi.mock('@/hooks/useActiveUsers', () => ({
  useActiveUsers: () => mockUseActiveUsers(),
}))

function withLiveUsers(...usernames: string[]): MockActiveUsers {
  return {
    data: { liveUsers: usernames.map((username) => ({ username, onLive: true })) },
    loading: false,
    error: null,
  }
}

function renderDialog(overrides: Partial<Parameters<typeof StopLiveTVDialog>[0]> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    channelName: 'TSN',
    onConfirm: vi.fn(),
    ...overrides,
  }
  render(<StopLiveTVDialog {...props} />)
  return props
}

describe('StopLiveTVDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseActiveUsers.mockReturnValue(withLiveUsers('alice', 'bob', 'carol'))
    useAuthStore.setState({ username: 'admin' })
  })

  it('asks before stopping live TV for everyone', () => {
    renderDialog()

    expect(screen.getByRole('dialog', { name: 'Stop live TV for everyone?' })).toBeInTheDocument()
  })

  it('names how many people are watching and what they will see', () => {
    renderDialog()

    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      '3 people are watching TSN. Their screens will show "No live broadcast" until someone picks a channel.'
    )
  })

  it('counts two sessions of the same person once', () => {
    mockUseActiveUsers.mockReturnValue(withLiveUsers('alice', 'alice', 'bob'))
    renderDialog()

    expect(screen.getByText(/^2 people are watching TSN\./)).toBeInTheDocument()
  })

  it('counts only people following the Live slot', () => {
    mockUseActiveUsers.mockReturnValue({
      data: {
        liveUsers: [
          { username: 'alice', onLive: true },
          { username: 'bob', onLive: false }, // On another channel
          { username: 'carol', onLive: false }, // Picked TSN herself
        ],
      },
      loading: false,
      error: null,
    })
    renderDialog()

    expect(screen.getByText(/^1 person is watching TSN\./)).toBeInTheDocument()
  })

  it('uses the singular for one person', () => {
    mockUseActiveUsers.mockReturnValue(withLiveUsers('alice', 'alice'))
    renderDialog()

    expect(screen.getByText(/^1 person is watching TSN\./)).toBeInTheDocument()
  })

  it('says so when nobody is watching', () => {
    mockUseActiveUsers.mockReturnValue(withLiveUsers())
    renderDialog()

    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      'Nobody else is watching TSN. Live TV will show "No live broadcast" until someone picks a channel.'
    )
  })

  it('leaves the admin pressing Stop out of the count', () => {
    mockUseActiveUsers.mockReturnValue(withLiveUsers('admin', 'admin', 'alice', 'bob'))
    renderDialog()

    expect(screen.getByText(/^2 people are watching TSN\./)).toBeInTheDocument()
  })

  it('says nobody else is watching when only the admin is', () => {
    mockUseActiveUsers.mockReturnValue(withLiveUsers('admin'))
    renderDialog()

    expect(screen.getByText(/^Nobody else is watching TSN\./)).toBeInTheDocument()
    expect(screen.queryByText(/person is watching/)).not.toBeInTheDocument()
  })

  it('leaves the count out while loading', () => {
    mockUseActiveUsers.mockReturnValue({ data: null, loading: true, error: null })
    renderDialog()

    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      'Everyone watching TSN will see "No live broadcast" until someone picks a channel.'
    )
  })

  it('leaves the count out when the viewer list fails to load', () => {
    mockUseActiveUsers.mockReturnValue({ ...withLiveUsers('alice'), error: 'Failed to fetch: 500' })
    renderDialog()

    expect(screen.getByText(/^Everyone watching TSN/)).toBeInTheDocument()
    expect(screen.queryByText(/person is watching/)).not.toBeInTheDocument()
  })

  it('does not fetch viewers while closed', () => {
    renderDialog({ open: false })

    expect(mockUseActiveUsers).not.toHaveBeenCalled()
  })

  it('focuses "Keep it on" and closes without confirming when chosen', () => {
    const props = renderDialog()

    const keep = screen.getByRole('button', { name: 'Keep it on' })
    expect(keep).toHaveFocus()

    fireEvent.click(keep)

    expect(props.onOpenChange).toHaveBeenCalledWith(false)
    expect(props.onConfirm).not.toHaveBeenCalled()
  })

  it('confirms once when "Stop live TV" is chosen', () => {
    const props = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Stop live TV' }))

    expect(props.onConfirm).toHaveBeenCalledTimes(1)
  })
})
