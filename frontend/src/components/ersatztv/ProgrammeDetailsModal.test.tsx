import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProgrammeDetailsModal } from './ProgrammeDetailsModal'
import type { ErsatzTVProgramme, ErsatzTVChannel } from '@/types'

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

  beforeEach(() => {
    vi.clearAllMocks()
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

  it('displays category badges', () => {
    render(<ProgrammeDetailsModal {...defaultProps} />)
    expect(screen.getByText('Movie')).toBeInTheDocument()
    expect(screen.getByText('Comedy')).toBeInTheDocument()
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

  it('closes modal on Close button click', () => {
    const onOpenChange = vi.fn()
    render(<ProgrammeDetailsModal {...defaultProps} onOpenChange={onOpenChange} />)

    // Get the footer Close button (not the X icon close button)
    const closeButtons = screen.getAllByRole('button', { name: /close/i })
    // The footer Close button is the one with "Close" text, not sr-only
    const footerCloseButton = closeButtons.find(
      (btn) => btn.textContent === 'Close'
    )
    expect(footerCloseButton).toBeDefined()
    fireEvent.click(footerCloseButton!)
    expect(onOpenChange).toHaveBeenCalledWith(false)
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
