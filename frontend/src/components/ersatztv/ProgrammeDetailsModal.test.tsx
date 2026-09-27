import { render, screen, fireEvent, act } from '@/test/utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ProgrammeDetailsModal } from './ProgrammeDetailsModal'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore } from '@/stores/tvStore'
import type { ErsatzTVProgramme, ErsatzTVChannel, UnifiedChannel } from '@/types'

describe('ProgrammeDetailsModal', () => {
  const mockProgramme: ErsatzTVProgramme = {
    id: 'p1',
    channelId: 'ch1',
    title: 'Test Movie',
    description: 'A test movie description',
    start: '2026-01-03T14:00:00Z',
    stop: '2026-01-03T16:00:00Z',
    category: ['Movie', 'Comedy'],
  }

  const mockChannel: ErsatzTVChannel = {
    id: 'ch1',
    name: 'Comedy Classics',
    number: 1,
    group: 'Movies',
    streamUrl: 'http://example.com/stream.m3u8',
    logoUrl: '/api/ersatztv/logo/ch1',
  }

  const defaultProps = {
    programme: mockProgramme,
    channel: mockChannel,
    open: true,
    onOpenChange: vi.fn(),
    onWatch: vi.fn(),
  }

  // Test Movie runs 14:00-16:00Z; by default the clock sits halfway through it.
  const DURING = new Date('2026-01-03T15:00:00Z')

  const onAir: ErsatzTVProgramme = {
    id: 'p0',
    channelId: 'ch1',
    title: 'Morning Cartoons',
    start: '2026-01-03T12:12:00Z',
    stop: '2026-01-03T14:00:00Z',
  }

  const watching: UnifiedChannel = {
    id: 'ch1',
    name: 'Comedy Classics',
    number: 1,
    streamUrl: 'http://example.com/stream.m3u8',
    type: 'ersatztv',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(DURING)
    useTVStore.setState({ selectedChannel: null })
    useErsatztvStore.setState({ programmesByChannel: {} })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('displays programme title', () => {
    render(<ProgrammeDetailsModal {...defaultProps} />)
    expect(screen.getByText('Test Movie')).toBeInTheDocument()
  })

  it('displays time range with duration', () => {
    render(<ProgrammeDetailsModal {...defaultProps} />)
    // Check for the duration (120 min)
    expect(screen.getByText(/120 min/)).toBeInTheDocument()
  })

  it('displays channel name', () => {
    render(<ProgrammeDetailsModal {...defaultProps} />)
    expect(screen.getByText(/Comedy Classics/)).toBeInTheDocument()
  })

  it('displays description', () => {
    render(<ProgrammeDetailsModal {...defaultProps} />)
    expect(screen.getByText('A test movie description')).toBeInTheDocument()
  })

  it('shows fallback when no description', () => {
    const programmeWithoutDesc: ErsatzTVProgramme = {
      ...mockProgramme,
      description: undefined,
    }
    render(
      <ProgrammeDetailsModal {...defaultProps} programme={programmeWithoutDesc} />
    )
    expect(screen.getByText('No description available')).toBeInTheDocument()
  })

  it('does not show category section when no categories', () => {
    const programmeWithoutCategories: ErsatzTVProgramme = {
      ...mockProgramme,
      category: undefined,
    }
    render(
      <ProgrammeDetailsModal
        {...defaultProps}
        programme={programmeWithoutCategories}
      />
    )
    expect(screen.queryByText('Movie')).not.toBeInTheDocument()
    expect(screen.queryByText('Comedy')).not.toBeInTheDocument()
  })

  it('calls onWatch with channel when Watch Now button clicked', () => {
    const onWatch = vi.fn()
    render(<ProgrammeDetailsModal {...defaultProps} onWatch={onWatch} />)

    fireEvent.click(screen.getByRole('button', { name: /watch now/i }))
    expect(onWatch).toHaveBeenCalledWith(mockChannel)
  })

  it('closes modal when Watch Now button clicked', () => {
    const onOpenChange = vi.fn()
    render(<ProgrammeDetailsModal {...defaultProps} onOpenChange={onOpenChange} />)

    fireEvent.click(screen.getByRole('button', { name: /watch now/i }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('has no footer Close button, only the dialog X', () => {
    render(<ProgrammeDetailsModal {...defaultProps} />)

    const closeButtons = screen.getAllByRole('button', { name: /close/i })
    expect(closeButtons).toHaveLength(1)
    expect(closeButtons[0]).toHaveAttribute('data-slot', 'dialog-close')
  })

  describe('actions by programme state', () => {
    it('upcoming: says when it starts and offers the channel as it is now', () => {
      // 1h 48m before Test Movie starts at 14:00Z
      vi.setSystemTime(new Date('2026-01-03T12:12:00Z'))
      useErsatztvStore.setState({ programmesByChannel: { ch1: [onAir, mockProgramme] } })
      const onWatch = vi.fn()
      render(<ProgrammeDetailsModal {...defaultProps} onWatch={onWatch} />)

      expect(screen.getByText(/In 1h 48m ·/)).toBeInTheDocument()
      expect(screen.getByText('On now: Morning Cartoons')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Watch now' })).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Watch Comedy Classics now' }))
      expect(onWatch).toHaveBeenCalledWith(mockChannel)
    })

    it('upcoming: leaves out the on-now hint when nothing is on air', () => {
      vi.setSystemTime(new Date('2026-01-03T12:12:00Z'))
      render(<ProgrammeDetailsModal {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'Watch Comedy Classics now' })).toBeInTheDocument()
      expect(screen.queryByText(/On now:/)).not.toBeInTheDocument()
    })

    it('on now: shows the time left and a primary Watch now', () => {
      vi.setSystemTime(new Date('2026-01-03T15:28:00Z'))
      useErsatztvStore.setState({ programmesByChannel: { ch1: [onAir, mockProgramme] } })
      render(<ProgrammeDetailsModal {...defaultProps} />)

      expect(screen.getByText(/32m left ·/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Watch now' })).toBeInTheDocument()
      expect(screen.queryByText(/On now:/)).not.toBeInTheDocument()
    })

    it('watching: says so and offers no watch button', () => {
      useTVStore.setState({ selectedChannel: watching })
      render(<ProgrammeDetailsModal {...defaultProps} />)

      expect(screen.getByText("You're watching this")).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /watch/i })).not.toBeInTheDocument()
    })

    it('ended: says when it ended and offers only the channel as it is now', () => {
      vi.setSystemTime(new Date('2026-01-03T16:10:00Z'))
      useErsatztvStore.setState({
        programmesByChannel: {
          ch1: [
            mockProgramme,
            { ...onAir, id: 'p2', title: 'Evening News', start: '2026-01-03T16:00:00Z', stop: '2026-01-03T16:30:00Z' },
          ],
        },
      })
      render(<ProgrammeDetailsModal {...defaultProps} />)

      expect(screen.getByText(/Ended at/)).toBeInTheDocument()
      expect(screen.getByText('On now: Evening News')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Watch now' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Watch Comedy Classics now' })).toBeInTheDocument()
    })

    it('upcoming on the channel you are watching: no watch button, since it would do nothing', () => {
      vi.setSystemTime(new Date('2026-01-03T12:12:00Z'))
      useTVStore.setState({ selectedChannel: watching })
      render(<ProgrammeDetailsModal {...defaultProps} />)

      expect(screen.getByText("You're watching Comedy Classics")).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /watch/i })).not.toBeInTheDocument()
    })

    it('moves from upcoming to on now when the clock passes the start', () => {
      vi.setSystemTime(new Date('2026-01-03T13:59:45Z'))
      render(<ProgrammeDetailsModal {...defaultProps} />)
      expect(screen.getByText(/In 1m ·/)).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(30_000)
      })
      expect(screen.getByRole('button', { name: 'Watch now' })).toBeInTheDocument()
    })
  })

  it('returns null when programme is null', () => {
    const { container } = render(
      <ProgrammeDetailsModal {...defaultProps} programme={null} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('returns null when channel is null', () => {
    const { container } = render(
      <ProgrammeDetailsModal {...defaultProps} channel={null} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('does not render when open is false', () => {
    render(<ProgrammeDetailsModal {...defaultProps} open={false} />)
    // Dialog should not render its content when closed
    expect(screen.queryByText('Test Movie')).not.toBeInTheDocument()
  })

  it('has proper dialog role for accessibility', () => {
    render(<ProgrammeDetailsModal {...defaultProps} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closes modal on X button click', () => {
    const onOpenChange = vi.fn()
    render(<ProgrammeDetailsModal {...defaultProps} onOpenChange={onOpenChange} />)

    // The X button has data-slot="dialog-close" attribute
    const dialogCloseButton = screen
      .getAllByRole('button', { name: /close/i })
      .find((btn) => btn.getAttribute('data-slot') === 'dialog-close')

    expect(dialogCloseButton).toBeDefined()
    fireEvent.click(dialogCloseButton!)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
