import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusTab } from './StatusTab'

// Mock useSystemStatus hook
const mockUseSystemStatus = vi.fn()
vi.mock('@/hooks/useSystemStatus', () => ({
  useSystemStatus: () => mockUseSystemStatus(),
}))

// Mock cn utility
vi.mock('@/lib/utils', () => ({
  cn: (...inputs: unknown[]) => inputs.filter(Boolean).join(' '),
}))

describe('StatusTab', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-04T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('should display loading skeleton when loading', () => {
    mockUseSystemStatus.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      lastUpdated: null,
      isRefreshing: false,
      refetch: vi.fn(),
    })

    render(<StatusTab />)

    // Check that skeleton elements are present
    expect(document.querySelector('[data-slot="skeleton"]')).toBeInTheDocument()
  })

  it('should display error message when error occurs', () => {
    mockUseSystemStatus.mockReturnValue({
      data: null,
      loading: false,
      error: 'Network error',
      lastUpdated: null,
      isRefreshing: false,
      refetch: vi.fn(),
    })

    render(<StatusTab />)

    expect(screen.getByText(/Failed to load system status/)).toBeInTheDocument()
    expect(screen.getByText(/Network error/)).toBeInTheDocument()
  })

  it('should display status cards for both services when online', () => {
    mockUseSystemStatus.mockReturnValue({
      data: {
        ersatztv: {
          name: 'ErsatzTV',
          online: true,
          lastChecked: '2026-01-04T12:00:00Z',
          error: null,
          activeSessions: 2,
          sessions: [
            { channelNumber: 1, channelName: 'Movies' },
            { channelNumber: 2, channelName: 'Sports' },
          ],
        },
        dispatcharr: {
          name: 'Dispatcharr',
          online: true,
          lastChecked: '2026-01-04T12:00:00Z',
          error: null,
          activeStreams: 5,
          totalViewers: 10,
        },
      },
      loading: false,
      error: null,
      lastUpdated: new Date('2026-01-04T12:00:00Z'),
      isRefreshing: false,
      refetch: vi.fn(),
    })

    render(<StatusTab />)

    // Check ErsatzTV card
    expect(screen.getByText('ErsatzTV')).toBeInTheDocument()
    expect(screen.getAllByText('Online').length).toBeGreaterThan(0)
    expect(screen.getByText('2')).toBeInTheDocument() // activeSessions

    // Check Dispatcharr card
    expect(screen.getByText('Dispatcharr')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument() // activeStreams
    expect(screen.getByText('10')).toBeInTheDocument() // totalViewers
  })

  it('should display offline status with error for unreachable service', () => {
    mockUseSystemStatus.mockReturnValue({
      data: {
        ersatztv: {
          name: 'ErsatzTV',
          online: false,
          lastChecked: '2026-01-04T12:00:00Z',
          error: 'Connection refused',
          activeSessions: 0,
          sessions: [],
        },
        dispatcharr: {
          name: 'Dispatcharr',
          online: true,
          lastChecked: '2026-01-04T12:00:00Z',
          error: null,
          activeStreams: 0,
          totalViewers: 0,
        },
      },
      loading: false,
      error: null,
      lastUpdated: new Date('2026-01-04T12:00:00Z'),
      isRefreshing: false,
      refetch: vi.fn(),
    })

    render(<StatusTab />)

    // Check offline ErsatzTV status
    expect(screen.getByText('Connection refused')).toBeInTheDocument()
    expect(screen.getByText('Offline')).toBeInTheDocument()
  })

  it('should display active channels when ErsatzTV has sessions', () => {
    mockUseSystemStatus.mockReturnValue({
      data: {
        ersatztv: {
          name: 'ErsatzTV',
          online: true,
          lastChecked: '2026-01-04T12:00:00Z',
          error: null,
          activeSessions: 2,
          sessions: [
            { channelNumber: 1, channelName: 'Movies' },
            { channelNumber: 3, channelName: 'News' },
          ],
        },
        dispatcharr: {
          name: 'Dispatcharr',
          online: true,
          lastChecked: '2026-01-04T12:00:00Z',
          error: null,
          activeStreams: 0,
          totalViewers: 0,
        },
      },
      loading: false,
      error: null,
      lastUpdated: new Date('2026-01-04T12:00:00Z'),
      isRefreshing: false,
      refetch: vi.fn(),
    })

    render(<StatusTab />)

    expect(screen.getByText('Active Channels')).toBeInTheDocument()
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('Movies')).toBeInTheDocument()
    expect(screen.getByText('#3')).toBeInTheDocument()
    expect(screen.getByText('News')).toBeInTheDocument()
  })

  it('should display refresh button', () => {
    mockUseSystemStatus.mockReturnValue({
      data: {
        ersatztv: {
          name: 'ErsatzTV',
          online: true,
          lastChecked: '2026-01-04T12:00:00Z',
          error: null,
          activeSessions: 0,
          sessions: [],
        },
        dispatcharr: {
          name: 'Dispatcharr',
          online: true,
          lastChecked: '2026-01-04T12:00:00Z',
          error: null,
          activeStreams: 0,
          totalViewers: 0,
        },
      },
      loading: false,
      error: null,
      lastUpdated: new Date('2026-01-04T12:00:00Z'),
      isRefreshing: false,
      refetch: vi.fn(),
    })

    render(<StatusTab />)

    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument()
  })

  it('should return null when no data', () => {
    mockUseSystemStatus.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      lastUpdated: null,
      isRefreshing: false,
      refetch: vi.fn(),
    })

    const { container } = render(<StatusTab />)

    expect(container.firstChild).toBeNull()
  })
})
