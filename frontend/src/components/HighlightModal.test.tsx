import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@/test/utils'
import { HighlightModal } from './HighlightModal'
import * as api from '@/services/api'
import * as utils from '@/lib/utils'
import { toast } from 'sonner'

// Mock the API service
vi.mock('@/services/api', () => ({
  getHighlightStatus: vi.fn().mockResolvedValue({
    enabled: true,
    recording: true,
    bufferSeconds: 60,
    maxBufferSeconds: 60,
  }),
  saveHighlight: vi.fn().mockResolvedValue(new Blob(['fake video content'], { type: 'video/mp4' })),
}))

// Mock isWebMSupported utility
vi.mock('@/lib/utils', async () => {
  const actual = await vi.importActual('@/lib/utils')
  return {
    ...actual,
    isWebMSupported: vi.fn().mockReturnValue(true),
  }
})

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

const mockSaveHighlight = api.saveHighlight as ReturnType<typeof vi.fn>
const mockGetHighlightStatus = api.getHighlightStatus as ReturnType<typeof vi.fn>
const mockIsWebMSupported = utils.isWebMSupported as ReturnType<typeof vi.fn>

// Mock URL methods for download
const mockCreateObjectURL = vi.fn(() => 'blob:test-url')
const mockRevokeObjectURL = vi.fn()
global.URL.createObjectURL = mockCreateObjectURL
global.URL.revokeObjectURL = mockRevokeObjectURL

describe('HighlightModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    channelId: 'channel-1',
    onVolumeChange: vi.fn(),
    previousVolume: 1,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockSaveHighlight.mockResolvedValue(new Blob(['fake video content'], { type: 'video/mp4' }))
    mockGetHighlightStatus.mockResolvedValue({
      enabled: true,
      recording: true,
      bufferSeconds: 60,
      maxBufferSeconds: 60,
    })
    mockIsWebMSupported.mockReturnValue(true)
  })

  describe('Modal Rendering', () => {
    it('renders the modal when isOpen is true', async () => {
      render(<HighlightModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(screen.getByText('Highlight Preview')).toBeInTheDocument()
      })
    })

    it('does not render when isOpen is false', () => {
      render(<HighlightModal {...defaultProps} isOpen={false} />)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('shows loading state initially', () => {
      render(<HighlightModal {...defaultProps} />)

      expect(screen.getByText('Loading highlight...')).toBeInTheDocument()
    })
  })

  describe('Video Loading', () => {
    it('fetches highlight on modal open', async () => {
      render(<HighlightModal {...defaultProps} />)

      await waitFor(() => {
        expect(mockSaveHighlight).toHaveBeenCalledWith('channel-1')
      })
    })

    it('displays video element after successful load', async () => {
      render(<HighlightModal {...defaultProps} />)

      await waitFor(() => {
        const video = screen.getByLabelText('Highlight preview')
        expect(video).toBeInTheDocument()
        expect(video).toHaveAttribute('src', 'blob:test-url')
        expect(video).toHaveAttribute('controls')
        expect(video).toHaveAttribute('autoplay')
      })
    })

    it('shows error message on fetch failure', async () => {
      mockSaveHighlight.mockRejectedValue(new Error('Network error'))

      render(<HighlightModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument()
        expect(toast.error).toHaveBeenCalledWith('Failed to load highlight', {
          description: 'Network error',
        })
      })
    })
  })

  describe('Volume Ducking', () => {
    it('ducks volume to 20% when modal opens and loads highlight', async () => {
      const onVolumeChange = vi.fn()
      render(<HighlightModal {...defaultProps} onVolumeChange={onVolumeChange} />)

      await waitFor(() => {
        expect(onVolumeChange).toHaveBeenCalledWith(0.2)
      })
    })

    it('restores previous volume when modal closes', async () => {
      const onVolumeChange = vi.fn()
      const onClose = vi.fn()
      render(
        <HighlightModal
          {...defaultProps}
          onVolumeChange={onVolumeChange}
          onClose={onClose}
          previousVolume={0.8}
        />
      )

      // Wait for highlight to load
      await waitFor(() => {
        expect(screen.getByLabelText('Highlight preview')).toBeInTheDocument()
      })

      // Clear mocks to track restore call
      onVolumeChange.mockClear()

      // Click close button
      const closeButton = screen.getByRole('button', { name: /close/i })
      fireEvent.click(closeButton)

      await waitFor(() => {
        expect(onVolumeChange).toHaveBeenCalledWith(0.8)
        expect(onClose).toHaveBeenCalled()
      })
    })
  })

  describe('Download Functionality', () => {
    it('shows download button after video loads', async () => {
      render(<HighlightModal {...defaultProps} />)

      await waitFor(() => {
        const downloadButton = screen.getByRole('button', { name: /download mp4/i })
        expect(downloadButton).toBeInTheDocument()
      })
    })

    it('triggers download when download button clicked', async () => {
      render(<HighlightModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByLabelText('Highlight preview')).toBeInTheDocument()
      })

      const downloadButton = screen.getByRole('button', { name: /download mp4/i })
      fireEvent.click(downloadButton)

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalled()
      })
    })

    it('shows partial capture toast when buffer not full', async () => {
      mockGetHighlightStatus.mockResolvedValue({
        enabled: true,
        recording: true,
        bufferSeconds: 30,
        maxBufferSeconds: 60,
      })

      render(<HighlightModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByLabelText('Highlight preview')).toBeInTheDocument()
      })

      const downloadButton = screen.getByRole('button', { name: /download mp4/i })
      fireEvent.click(downloadButton)

      await waitFor(() => {
        expect(toast.info).toHaveBeenCalled()
      })
    })
  })

  describe('WebM Download Functionality', () => {
    it('shows both MP4 and WebM download buttons when WebM is supported', async () => {
      mockIsWebMSupported.mockReturnValue(true)
      render(<HighlightModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /download mp4/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /download webm/i })).toBeInTheDocument()
      })
    })

    it('hides WebM button when WebM is not supported (graceful degradation)', async () => {
      mockIsWebMSupported.mockReturnValue(false)
      render(<HighlightModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /download mp4/i })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /download webm/i })).not.toBeInTheDocument()
      })
    })

    it('triggers WebM download when WebM button clicked', async () => {
      mockIsWebMSupported.mockReturnValue(true)
      mockSaveHighlight.mockResolvedValue(new Blob(['fake webm content'], { type: 'video/webm' }))

      render(<HighlightModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByLabelText('Highlight preview')).toBeInTheDocument()
      })

      const webmButton = screen.getByRole('button', { name: /download webm/i })
      fireEvent.click(webmButton)

      await waitFor(() => {
        // saveHighlight should be called with webm format
        expect(mockSaveHighlight).toHaveBeenCalledWith('channel-1', 'webm')
        expect(toast.success).toHaveBeenCalled()
      })
    })

    it('disables both buttons while downloading', async () => {
      mockIsWebMSupported.mockReturnValue(true)
      // Create a never-resolving promise to simulate ongoing download
      let resolveDownload: (value: Blob) => void
      mockSaveHighlight.mockImplementation(
        (_channelId: string, format?: string) =>
          new Promise((resolve) => {
            if (format === 'webm') {
              resolveDownload = resolve
            } else {
              resolve(new Blob(['mp4 content'], { type: 'video/mp4' }))
            }
          })
      )

      render(<HighlightModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByLabelText('Highlight preview')).toBeInTheDocument()
      })

      const webmButton = screen.getByRole('button', { name: /download webm/i })
      fireEvent.click(webmButton)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /download mp4/i })).toBeDisabled()
        expect(webmButton).toBeDisabled()
      })

      // Cleanup: resolve the promise
      resolveDownload!(new Blob(['webm content'], { type: 'video/webm' }))
    })
  })

  describe('Keyboard Navigation', () => {
    it('closes modal on Escape key press', async () => {
      const onClose = vi.fn()
      const onVolumeChange = vi.fn()
      render(<HighlightModal {...defaultProps} onClose={onClose} onVolumeChange={onVolumeChange} />)

      await waitFor(() => {
        expect(screen.getByLabelText('Highlight preview')).toBeInTheDocument()
      })

      // Escape key triggers dialog close
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled()
      })
    })
  })

  describe('Cleanup', () => {
    it('revokes blob URL on modal close', async () => {
      const { unmount } = render(<HighlightModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByLabelText('Highlight preview')).toBeInTheDocument()
      })

      unmount()

      expect(mockRevokeObjectURL).toHaveBeenCalled()
    })
  })
})
