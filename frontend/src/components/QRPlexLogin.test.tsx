import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QRPlexLogin } from './QRPlexLogin'
import * as usePlexQRAuthModule from '@/hooks/usePlexQRAuth'

vi.mock('@/hooks/usePlexQRAuth', () => ({
  usePlexQRAuth: vi.fn(),
}))

vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value, size, 'aria-label': ariaLabel }: { value: string; size: number; 'aria-label': string }) => (
    <div data-testid="qr-code" data-value={value} data-size={size} aria-label={ariaLabel}>
      QR Code Mock
    </div>
  ),
}))

describe('QRPlexLogin', () => {
  const mockPin = { id: 123, code: 'ABCD', authToken: null }
  const mockAuthUrl = 'https://app.plex.tv/auth#?code=ABCD'
  const mockStart = vi.fn()
  const mockCancel = vi.fn()
  const defaultMockReturn = {
    pin: mockPin,
    authUrl: mockAuthUrl,
    status: 'polling' as const,
    timeRemaining: 300,
    error: null,
    start: mockStart,
    cancel: mockCancel,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(usePlexQRAuthModule.usePlexQRAuth).mockReturnValue(defaultMockReturn)
  })

  describe('rendering', () => {
    it('should render QR code with auth URL', () => {
      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} />)

      const qrCode = screen.getByTestId('qr-code')
      expect(qrCode).toBeInTheDocument()
      expect(qrCode).toHaveAttribute('data-value', mockAuthUrl)
    })

    it('should render title', () => {
      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} />)

      expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
    })

    it('should render scan instructions', () => {
      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} />)

      expect(screen.getByText('Scan with your phone to log in')).toBeInTheDocument()
    })

    it('should display manual PIN code', () => {
      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} />)

      expect(screen.getByText('ABCD')).toBeInTheDocument()
      expect(screen.getByText(/plex.tv\/link/)).toBeInTheDocument()
    })

    it('should display time remaining', () => {
      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} />)

      expect(screen.getByText(/5:00/)).toBeInTheDocument()
    })

    it('should render cancel button', () => {
      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} />)

      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    })

    it('should show loading state when no authUrl', () => {
      vi.mocked(usePlexQRAuthModule.usePlexQRAuth).mockReturnValue({
        ...defaultMockReturn,
        authUrl: null,
        pin: null,
      })

      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} />)

      expect(screen.getByText('Loading...')).toBeInTheDocument()
      expect(screen.queryByTestId('qr-code')).not.toBeInTheDocument()
    })
  })

  describe('interactions', () => {
    it('should call start on mount', () => {
      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} />)

      expect(mockStart).toHaveBeenCalled()
    })

    it('should call cancel and onCancel when cancel button clicked', () => {
      const onCancel = vi.fn()
      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={onCancel} />)

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

      expect(mockCancel).toHaveBeenCalled()
      expect(onCancel).toHaveBeenCalled()
    })
  })

  describe('error state', () => {
    it('should display error message when status is error', () => {
      vi.mocked(usePlexQRAuthModule.usePlexQRAuth).mockReturnValue({
        ...defaultMockReturn,
        status: 'error',
        error: new Error('Network error'),
      })

      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} />)

      expect(screen.getByRole('alert')).toHaveTextContent('Network error')
    })

    it('should show retry button on error', () => {
      vi.mocked(usePlexQRAuthModule.usePlexQRAuth).mockReturnValue({
        ...defaultMockReturn,
        status: 'error',
        error: new Error('Network error'),
      })

      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} />)

      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    })

    it('should call start when retry button clicked', () => {
      vi.mocked(usePlexQRAuthModule.usePlexQRAuth).mockReturnValue({
        ...defaultMockReturn,
        status: 'error',
        error: new Error('Network error'),
      })

      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} />)

      fireEvent.click(screen.getByRole('button', { name: /try again/i }))

      // start is called once on mount, once on retry
      expect(mockStart).toHaveBeenCalledTimes(2)
    })

    it('should not show QR code on error', () => {
      vi.mocked(usePlexQRAuthModule.usePlexQRAuth).mockReturnValue({
        ...defaultMockReturn,
        status: 'error',
        error: new Error('Network error'),
      })

      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} />)

      expect(screen.queryByTestId('qr-code')).not.toBeInTheDocument()
    })
  })

  describe('timeout state', () => {
    it('should display timeout message', () => {
      vi.mocked(usePlexQRAuthModule.usePlexQRAuth).mockReturnValue({
        ...defaultMockReturn,
        status: 'timeout',
        error: new Error('Authentication timed out'),
      })

      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} />)

      expect(screen.getByText(/timed out/i)).toBeInTheDocument()
    })

    it('should show retry button on timeout', () => {
      vi.mocked(usePlexQRAuthModule.usePlexQRAuth).mockReturnValue({
        ...defaultMockReturn,
        status: 'timeout',
        error: new Error('Authentication timed out'),
      })

      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} />)

      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    })

    it('should not show QR code on timeout', () => {
      vi.mocked(usePlexQRAuthModule.usePlexQRAuth).mockReturnValue({
        ...defaultMockReturn,
        status: 'timeout',
        error: new Error('Authentication timed out'),
      })

      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} />)

      expect(screen.queryByTestId('qr-code')).not.toBeInTheDocument()
    })
  })

  describe('time formatting', () => {
    it('should format time with leading zeros', () => {
      vi.mocked(usePlexQRAuthModule.usePlexQRAuth).mockReturnValue({
        ...defaultMockReturn,
        timeRemaining: 65, // 1:05
      })

      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} />)

      expect(screen.getByText(/1:05/)).toBeInTheDocument()
    })

    it('should handle zero seconds correctly', () => {
      vi.mocked(usePlexQRAuthModule.usePlexQRAuth).mockReturnValue({
        ...defaultMockReturn,
        timeRemaining: 60, // 1:00
      })

      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} />)

      expect(screen.getByText(/1:00/)).toBeInTheDocument()
    })
  })

  describe('callbacks', () => {
    it('should pass onSuccess to usePlexQRAuth', () => {
      const onSuccess = vi.fn()
      render(<QRPlexLogin onSuccess={onSuccess} onCancel={vi.fn()} />)

      expect(usePlexQRAuthModule.usePlexQRAuth).toHaveBeenCalledWith(
        expect.objectContaining({ onSuccess })
      )
    })

    it('should pass onError to usePlexQRAuth', () => {
      const onError = vi.fn()
      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} onError={onError} />)

      expect(usePlexQRAuthModule.usePlexQRAuth).toHaveBeenCalledWith(
        expect.objectContaining({ onError })
      )
    })
  })

  describe('accessibility', () => {
    it('should have aria-label on QR code', () => {
      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} />)

      const qrCode = screen.getByTestId('qr-code')
      expect(qrCode).toHaveAttribute('aria-label', 'Scan this QR code with your phone to log in')
    })

    it('should have role alert for error state', () => {
      vi.mocked(usePlexQRAuthModule.usePlexQRAuth).mockReturnValue({
        ...defaultMockReturn,
        status: 'error',
        error: new Error('Network error'),
      })

      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} />)

      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
  })
})
