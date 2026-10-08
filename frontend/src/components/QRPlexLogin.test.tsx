import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
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
  const mockStrongPin = { id: 123, code: 'strong-code-abc123', authToken: null }
  const mockShortPin = { id: 456, code: 'ABCD', authToken: null }
  const mockAuthUrl = 'https://app.plex.tv/auth#?code=strong-code-abc123'
  const mockStart = vi.fn()
  const mockCancel = vi.fn()
  const defaultMockReturn = {
    pin: mockStrongPin,
    shortPin: mockShortPin,
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

    it('should display short PIN code for manual entry at plex.tv/link', () => {
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
        shortPin: null,
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

    it('passes onCodeRequested to usePlexQRAuth, so the caller hears of each new code', () => {
      const onCodeRequested = vi.fn()
      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} onCodeRequested={onCodeRequested} />)

      expect(usePlexQRAuthModule.usePlexQRAuth).toHaveBeenCalledWith(
        expect.objectContaining({ onCodeRequested })
      )
    })
  })

  describe('tv variant', () => {
    it('renders the QR at 400px beside the steps and a large code', () => {
      const { container } = render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} variant="tv" />)

      expect(screen.getByTestId('qr-code')).toHaveAttribute('data-size', '400')
      expect(screen.getByText('ABCD')).toHaveClass('text-6xl', 'font-mono')
      expect(screen.getByText('plex.tv/link')).toBeInTheDocument()
      expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
        '1Scan the code with your phone',
        '2Sign in with your Plex account',
        '3This TV joins the club',
      ])
      // Two columns: the steps and code first, the QR second
      const layout = container.querySelector('[data-variant="tv"]')
      expect(layout).toHaveClass('grid')
      expect(layout?.lastElementChild).toContainElement(screen.getByTestId('qr-code'))
      expect(layout?.firstElementChild).toContainElement(screen.getByText('ABCD'))
    })

    it('keeps the default variant at 280px with the compact code', () => {
      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} />)

      expect(screen.getByTestId('qr-code')).toHaveAttribute('data-size', '280')
      expect(screen.getByText('ABCD')).toHaveClass('text-3xl')
      expect(screen.queryByRole('list')).not.toBeInTheDocument()
    })

    it('shows a 400px placeholder while the code loads', () => {
      vi.mocked(usePlexQRAuthModule.usePlexQRAuth).mockReturnValue({
        ...defaultMockReturn,
        authUrl: null,
        pin: null,
        shortPin: null,
      })

      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} variant="tv" />)

      expect(screen.getByText('Loading...').parentElement).toHaveClass('size-[448px]')
      expect(screen.queryByTestId('qr-code')).not.toBeInTheDocument()
    })

    it('shows Try Again, room-sized, once the restarts run out', () => {
      vi.mocked(usePlexQRAuthModule.usePlexQRAuth).mockReturnValue({
        ...defaultMockReturn,
        status: 'timeout',
        error: new Error('Authentication timed out'),
      })

      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} variant="tv" autoRestart />)

      expect(screen.getByRole('button', { name: 'Try Again' })).toHaveClass('h-14', 'text-2xl')
    })
  })

  describe('autoRestart and cancelLabel', () => {
    it('passes autoRestart to usePlexQRAuth', () => {
      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} variant="tv" autoRestart />)

      expect(usePlexQRAuthModule.usePlexQRAuth).toHaveBeenCalledWith(
        expect.objectContaining({ autoRestart: true })
      )
    })

    it('does not auto-restart by default', () => {
      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} />)

      expect(usePlexQRAuthModule.usePlexQRAuth).toHaveBeenCalledWith(
        expect.objectContaining({ autoRestart: false })
      )
    })

    it.each(['polling', 'timeout', 'error'] as const)(
      'labels the way out with cancelLabel while %s, and it still cancels',
      (status) => {
        vi.mocked(usePlexQRAuthModule.usePlexQRAuth).mockReturnValue({ ...defaultMockReturn, status })
        const onCancel = vi.fn()
        render(
          <QRPlexLogin
            onSuccess={vi.fn()}
            onCancel={onCancel}
            variant="tv"
            cancelLabel="Use another sign-in method"
          />
        )

        fireEvent.click(screen.getByRole('button', { name: 'Use another sign-in method' }))

        expect(mockCancel).toHaveBeenCalled()
        expect(onCancel).toHaveBeenCalled()
        expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
      }
    )
  })

  describe('inside a form', () => {
    // The setup wizard shows the code inside its <form>, and Button sets no
    // type, so a button without one would submit the wizard
    it.each([
      ['polling', 'default'],
      ['polling', 'tv'],
      ['timeout', 'default'],
      ['timeout', 'tv'],
      ['error', 'default'],
      ['error', 'tv'],
    ] as const)('gives every button type="button" while %s (%s)', (status, variant) => {
      vi.mocked(usePlexQRAuthModule.usePlexQRAuth).mockReturnValue({ ...defaultMockReturn, status })
      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} variant={variant} />)

      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThan(0)
      for (const button of buttons) expect(button).toHaveAttribute('type', 'button')
    })

    it.each(['Cancel', 'Try Again'])('does not submit the form around it when %s is pressed', (name) => {
      vi.mocked(usePlexQRAuthModule.usePlexQRAuth).mockReturnValue({ ...defaultMockReturn, status: 'timeout' })
      const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
      render(
        <form onSubmit={onSubmit}>
          <QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} />
        </form>
      )

      fireEvent.click(screen.getByRole('button', { name }))

      expect(onSubmit).not.toHaveBeenCalled()
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

    it('shows the error text in the foreground colour on its translucent red tint', () => {
      vi.mocked(usePlexQRAuthModule.usePlexQRAuth).mockReturnValue({
        ...defaultMockReturn,
        status: 'error',
        error: new Error('Network error'),
      })

      render(<QRPlexLogin onSuccess={vi.fn()} onCancel={vi.fn()} />)

      const alert = screen.getByRole('alert')
      expect(alert).toHaveClass('text-foreground', 'bg-destructive/10')
      expect(alert).not.toHaveClass('text-destructive-foreground')
    })
  })
})
