import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { HighlightButton } from './HighlightButton'
import * as api from '@/services/api'
import { toast } from 'sonner'

// Mock the API service
vi.mock('@/services/api', () => ({
  getHighlightStatus: vi.fn().mockResolvedValue({
    enabled: true,
    recording: true,
    bufferSeconds: 30,
    maxBufferSeconds: 60,
  }),
  saveHighlight: vi.fn().mockResolvedValue(new Blob(['fake video content'], { type: 'video/mp4' })),
}))

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

const mockGetHighlightStatus = api.getHighlightStatus as ReturnType<typeof vi.fn>
const mockSaveHighlight = api.saveHighlight as ReturnType<typeof vi.fn>

// Mock URL methods for download
const mockCreateObjectURL = vi.fn(() => 'blob:test-url')
const mockRevokeObjectURL = vi.fn()
global.URL.createObjectURL = mockCreateObjectURL
global.URL.revokeObjectURL = mockRevokeObjectURL

describe('HighlightButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('renders the button with download icon when recording', async () => {
      render(<HighlightButton channelId="channel-1" isVisible={true} />)

      await waitFor(() => {
        const button = screen.getByRole('button')
        expect(button).toBeInTheDocument()
      })
    })

    it('has correct accessibility attributes', async () => {
      render(<HighlightButton channelId="channel-1" isVisible={true} />)

      await waitFor(() => {
        const button = screen.getByRole('button')
        expect(button).toHaveAttribute('aria-label')
        expect(button).toHaveAttribute('type', 'button')
      })
    })

    it('is tabbable when visible and recording', async () => {
      render(<HighlightButton channelId="channel-1" isVisible={true} />)

      await waitFor(() => {
        const button = screen.getByRole('button')
        expect(button).toHaveAttribute('tabindex', '0')
      })
    })

    it('does not render when isVisible is false (status not fetched)', async () => {
      render(<HighlightButton channelId="channel-1" isVisible={false} />)

      // When not visible, status is not fetched so button never renders
      await new Promise((r) => setTimeout(r, 100))
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  describe('Status Polling', () => {
    it('fetches status on mount when visible', async () => {
      render(<HighlightButton channelId="channel-1" isVisible={true} />)

      await waitFor(() => {
        expect(mockGetHighlightStatus).toHaveBeenCalledWith('channel-1')
      })
    })

    it('does not fetch status when not visible', async () => {
      mockGetHighlightStatus.mockClear()

      render(<HighlightButton channelId="channel-1" isVisible={false} />)

      // Wait a bit to ensure no call is made
      await new Promise((r) => setTimeout(r, 100))
      expect(mockGetHighlightStatus).not.toHaveBeenCalled()
    })
  })

  describe('Save Highlight', () => {
    it('calls saveHighlight API when clicked', async () => {
      mockGetHighlightStatus.mockResolvedValue({
        enabled: true,
        recording: true,
        bufferSeconds: 60,
        maxBufferSeconds: 60,
      })

      render(<HighlightButton channelId="channel-1" isVisible={true} />)

      // Wait for status to be fetched
      await waitFor(() => {
        expect(screen.getByRole('button')).not.toBeDisabled()
      })

      fireEvent.click(screen.getByRole('button'))

      await waitFor(() => {
        expect(mockSaveHighlight).toHaveBeenCalledWith('channel-1')
      })
    })

    it('shows success toast when save succeeds', async () => {
      mockGetHighlightStatus.mockResolvedValue({
        enabled: true,
        recording: true,
        bufferSeconds: 60,
        maxBufferSeconds: 60,
      })

      render(<HighlightButton channelId="channel-1" isVisible={true} />)

      // Wait for status to be fetched
      await waitFor(() => {
        expect(screen.getByRole('button')).not.toBeDisabled()
      })

      fireEvent.click(screen.getByRole('button'))

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalled()
      })
    })

    it('shows error toast when save fails', async () => {
      mockGetHighlightStatus.mockResolvedValue({
        enabled: true,
        recording: true,
        bufferSeconds: 60,
        maxBufferSeconds: 60,
      })
      mockSaveHighlight.mockRejectedValue(new Error('Network error'))

      render(<HighlightButton channelId="channel-1" isVisible={true} />)

      // Wait for status to be fetched
      await waitFor(() => {
        expect(screen.getByRole('button')).not.toBeDisabled()
      })

      fireEvent.click(screen.getByRole('button'))

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalled()
      })
    })

    it('shows partial capture toast when buffer not full', async () => {
      // Reset mocks to default partial buffer state
      mockGetHighlightStatus.mockResolvedValue({
        enabled: true,
        recording: true,
        bufferSeconds: 30,
        maxBufferSeconds: 60,
      })
      mockSaveHighlight.mockResolvedValue(new Blob(['fake'], { type: 'video/mp4' }))

      render(<HighlightButton channelId="channel-1" isVisible={true} />)

      // Wait for status to be fetched
      await waitFor(() => {
        expect(screen.getByRole('button')).not.toBeDisabled()
      })

      fireEvent.click(screen.getByRole('button'))

      await waitFor(() => {
        expect(toast.info).toHaveBeenCalled()
      })
    })
  })

  describe('Hidden State', () => {
    it('is hidden when not recording', async () => {
      mockGetHighlightStatus.mockResolvedValue({
        enabled: true,
        recording: false,
        bufferSeconds: 0,
        maxBufferSeconds: 60,
      })

      render(<HighlightButton channelId="channel-1" isVisible={true} />)

      // Wait for status to be fetched
      await waitFor(() => {
        expect(mockGetHighlightStatus).toHaveBeenCalled()
      })

      // Button should not be in the document when not recording
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  describe('Styling', () => {
    it('has control button styling', async () => {
      mockGetHighlightStatus.mockResolvedValue({
        enabled: true,
        recording: true,
        bufferSeconds: 30,
        maxBufferSeconds: 60,
      })

      render(<HighlightButton channelId="channel-1" isVisible={true} />)

      await waitFor(() => {
        const button = screen.getByRole('button')
        expect(button).toHaveClass('control-button')
      })
    })

    it('has minimum touch target size', async () => {
      mockGetHighlightStatus.mockResolvedValue({
        enabled: true,
        recording: true,
        bufferSeconds: 30,
        maxBufferSeconds: 60,
      })

      render(<HighlightButton channelId="channel-1" isVisible={true} />)

      await waitFor(() => {
        const button = screen.getByRole('button')
        expect(button).toHaveClass('min-h-[48px]')
        expect(button).toHaveClass('min-w-[48px]')
      })
    })
  })
})
