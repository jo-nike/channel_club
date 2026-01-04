import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActiveUsersTab } from './ActiveUsersTab'

// Mock useActiveUsers hook
const mockUseActiveUsers = vi.fn()
vi.mock('@/hooks/useActiveUsers', () => ({
  useActiveUsers: () => mockUseActiveUsers(),
}))

// Mock formatDuration utility
vi.mock('@/lib/utils', () => ({
  formatDuration: (isoDate: string) => {
    // Simple mock - return a fixed duration for testing
    const diff = Date.now() - new Date(isoDate).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes >= 60) {
      return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    }
    return `${minutes}m`
  },
  cn: (...inputs: unknown[]) => inputs.filter(Boolean).join(' '),
}))

describe('ActiveUsersTab', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-04T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('should display loading skeleton when loading', () => {
    mockUseActiveUsers.mockReturnValue({
      data: null,
      loading: true,
      error: null,
    })

    render(<ActiveUsersTab />)

    // Check that skeleton elements are present
    expect(document.querySelector('[data-slot="skeleton"]')).toBeInTheDocument()
  })

  it('should display error message when error occurs', () => {
    mockUseActiveUsers.mockReturnValue({
      data: null,
      loading: false,
      error: 'Network error',
    })

    render(<ActiveUsersTab />)

    expect(screen.getByText(/Failed to load active users/)).toBeInTheDocument()
    expect(screen.getByText(/Network error/)).toBeInTheDocument()
  })

  it('should display total bandwidth summary at the top', () => {
    mockUseActiveUsers.mockReturnValue({
      data: {
        liveUsers: [],
        ersatztvUsers: [],
        totals: {
          liveCount: 2,
          ersatztvCount: 1,
          liveBitrateMbps: 17.0,
          ersatztvBitrateMbps: 12.5,
          totalBitrateMbps: 29.5,
        },
      },
      loading: false,
      error: null,
    })

    render(<ActiveUsersTab />)

    expect(screen.getByText(/Total Bandwidth: 29.5 Mbps/)).toBeInTheDocument()
    expect(screen.getByText(/3 active users/)).toBeInTheDocument()
  })

  it('should display Live TV section with users', () => {
    mockUseActiveUsers.mockReturnValue({
      data: {
        liveUsers: [
          {
            username: 'user1',
            channel: 'Channel 1',
            connectedSince: '2026-01-04T10:00:00Z',
            bitrateMbps: 8.5,
          },
          {
            username: 'user2',
            channel: 'Channel 2',
            connectedSince: '2026-01-04T11:30:00Z',
            bitrateMbps: 8.5,
          },
        ],
        ersatztvUsers: [],
        totals: {
          liveCount: 2,
          ersatztvCount: 0,
          liveBitrateMbps: 17.0,
          ersatztvBitrateMbps: 0,
          totalBitrateMbps: 17.0,
        },
      },
      loading: false,
      error: null,
    })

    render(<ActiveUsersTab />)

    // Check Live TV section header
    expect(screen.getByText('Live TV')).toBeInTheDocument()
    expect(screen.getByText(/2 users • 17.0 Mbps/)).toBeInTheDocument()

    // Check user rows
    expect(screen.getByText('user1')).toBeInTheDocument()
    expect(screen.getByText(/Channel 1/)).toBeInTheDocument()
    expect(screen.getByText('user2')).toBeInTheDocument()
    expect(screen.getByText(/Channel 2/)).toBeInTheDocument()
  })

  it('should display ErsatzTV section with users', () => {
    mockUseActiveUsers.mockReturnValue({
      data: {
        liveUsers: [],
        ersatztvUsers: [
          {
            username: 'movieUser',
            channel: 'Movie Channel',
            connectedSince: '2026-01-04T09:00:00Z',
            bitrateMbps: 12.0,
          },
        ],
        totals: {
          liveCount: 0,
          ersatztvCount: 1,
          liveBitrateMbps: 0,
          ersatztvBitrateMbps: 12.0,
          totalBitrateMbps: 12.0,
        },
      },
      loading: false,
      error: null,
    })

    render(<ActiveUsersTab />)

    // Check ErsatzTV section header
    expect(screen.getByText('ErsatzTV')).toBeInTheDocument()
    expect(screen.getByText(/1 user • 12.0 Mbps/)).toBeInTheDocument()

    // Check user row
    expect(screen.getByText('movieUser')).toBeInTheDocument()
    expect(screen.getByText(/Movie Channel/)).toBeInTheDocument()
  })

  it('should display "No active users" when section is empty', () => {
    mockUseActiveUsers.mockReturnValue({
      data: {
        liveUsers: [
          {
            username: 'liveUser',
            channel: 'Channel 1',
            connectedSince: '2026-01-04T11:00:00Z',
            bitrateMbps: 8.0,
          },
        ],
        ersatztvUsers: [],
        totals: {
          liveCount: 1,
          ersatztvCount: 0,
          liveBitrateMbps: 8.0,
          ersatztvBitrateMbps: 0,
          totalBitrateMbps: 8.0,
        },
      },
      loading: false,
      error: null,
    })

    render(<ActiveUsersTab />)

    // ErsatzTV section should show "No active users"
    expect(screen.getByText('No active users')).toBeInTheDocument()
  })

  it('should display user bitrate with Mbps suffix', () => {
    mockUseActiveUsers.mockReturnValue({
      data: {
        liveUsers: [
          {
            username: 'testUser',
            channel: 'Test Channel',
            connectedSince: '2026-01-04T11:00:00Z',
            bitrateMbps: 8.5,
          },
        ],
        ersatztvUsers: [],
        totals: {
          liveCount: 1,
          ersatztvCount: 0,
          liveBitrateMbps: 8.5,
          ersatztvBitrateMbps: 0,
          totalBitrateMbps: 8.5,
        },
      },
      loading: false,
      error: null,
    })

    render(<ActiveUsersTab />)

    expect(screen.getByText('8.5 Mbps')).toBeInTheDocument()
  })

  it('should display "No channel" when user has no channel', () => {
    mockUseActiveUsers.mockReturnValue({
      data: {
        liveUsers: [
          {
            username: 'noChannelUser',
            channel: null,
            connectedSince: '2026-01-04T11:00:00Z',
            bitrateMbps: 0,
          },
        ],
        ersatztvUsers: [],
        totals: {
          liveCount: 1,
          ersatztvCount: 0,
          liveBitrateMbps: 0,
          ersatztvBitrateMbps: 0,
          totalBitrateMbps: 0,
        },
      },
      loading: false,
      error: null,
    })

    render(<ActiveUsersTab />)

    expect(screen.getByText(/No channel/)).toBeInTheDocument()
  })
})
