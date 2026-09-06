import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@/test/utils'
import { LoginForm } from './LoginForm'
import { useAuthStore } from '@/stores/authStore'
import * as api from '@/services/api'
import * as plexAuth from '@/services/plexAuth'
import * as useTVModeModule from '@/hooks/useTVMode'

vi.mock('@/services/api', () => ({
  login: vi.fn(),
  getAuthConfig: vi.fn(),
  loginWithPlex: vi.fn(),
}))

vi.mock('@/services/plexAuth', () => ({
  authenticateWithPlex: vi.fn(),
}))

vi.mock('@/hooks/useTVMode', () => ({
  useTVMode: vi.fn(() => false),
}))

// Mock QRPlexLogin component for testing
vi.mock('@/components/QRPlexLogin', () => ({
  QRPlexLogin: ({ onSuccess, onCancel, onError }: {
    onSuccess: (token: string) => void
    onCancel: () => void
    onError?: (err: Error) => void
  }) => (
    <div data-testid="qr-plex-login">
      <button onClick={() => onSuccess('qr-auth-token')}>Mock QR Success</button>
      <button onClick={onCancel}>Mock QR Cancel</button>
      <button onClick={() => onError?.(new Error('QR error'))}>Mock QR Error</button>
    </div>
  ),
}))

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({
      token: null,
      role: null,
      isAuthenticated: false,
    })
    // Default mock: local auth enabled, plex disabled
    vi.mocked(api.getAuthConfig).mockResolvedValue({
      localAuthEnabled: true,
      plexAuthEnabled: false,
    })
  })

  it('should render login form with username and password fields', async () => {
    render(<LoginForm />)

    await waitFor(() => {
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
    })
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('should render with 10-foot UI title', async () => {
    render(<LoginForm />)

    await waitFor(() => {
      expect(screen.getByText('Channel Club')).toBeInTheDocument()
    })
  })

  it('should update input values on change', async () => {
    render(<LoginForm />)

    await waitFor(() => {
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
    })

    const usernameInput = screen.getByLabelText(/username/i)
    const passwordInput = screen.getByLabelText(/password/i)

    fireEvent.change(usernameInput, { target: { value: 'testuser' } })
    fireEvent.change(passwordInput, { target: { value: 'testpass' } })

    expect(usernameInput).toHaveValue('testuser')
    expect(passwordInput).toHaveValue('testpass')
  })

  it('should show loading state during submission', async () => {
    vi.mocked(api.login).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({
        accessToken: 'token',
        tokenType: 'Bearer',
        role: 'admin',
      }), 100))
    )

    render(<LoginForm />)

    await waitFor(() => {
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'testuser' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'testpass' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/signing in/i)).toBeInTheDocument()
  })

  it('should call login API and setAuth on successful submission', async () => {
    const mockSetAuth = vi.fn()
    useAuthStore.setState({ setAuth: mockSetAuth } as unknown as Parameters<typeof useAuthStore.setState>[0])

    vi.mocked(api.login).mockResolvedValueOnce({
      accessToken: 'test-token',
      tokenType: 'Bearer',
      role: 'admin',
    })

    render(<LoginForm />)

    await waitFor(() => {
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'testuser' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'testpass' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(api.login).toHaveBeenCalledWith({ username: 'testuser', password: 'testpass' })
    })
  })

  it('should show error message on failed login', async () => {
    vi.mocked(api.login).mockRejectedValueOnce(new Error('Invalid credentials'))

    render(<LoginForm />)

    await waitFor(() => {
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'baduser' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'badpass' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials')
  })

  it('should have proper tab order for keyboard navigation', async () => {
    render(<LoginForm />)

    await waitFor(() => {
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
    })

    const usernameInput = screen.getByLabelText(/username/i)
    const passwordInput = screen.getByLabelText(/password/i)
    const submitButton = screen.getByRole('button', { name: /sign in/i })

    // Check tabindex is not set (default natural tab order)
    expect(usernameInput).not.toHaveAttribute('tabindex', '-1')
    expect(passwordInput).not.toHaveAttribute('tabindex', '-1')
    expect(submitButton).not.toHaveAttribute('tabindex', '-1')
  })

  it('should have 10-foot UI appropriate styling', async () => {
    render(<LoginForm />)

    await waitFor(() => {
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
    })

    const usernameInput = screen.getByLabelText(/username/i)
    const submitButton = screen.getByRole('button', { name: /sign in/i })

    // Check for h-14 class (56px height for 10-foot UI)
    expect(usernameInput.className).toContain('h-14')
    expect(submitButton.className).toContain('h-14')
  })

  describe('Plex authentication', () => {
    it('should show Plex button when plexAuthEnabled is true', async () => {
      vi.mocked(api.getAuthConfig).mockResolvedValueOnce({
        localAuthEnabled: true,
        plexAuthEnabled: true,
      })

      render(<LoginForm />)

      await waitFor(() => {
        expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
      })
    })

    it('should hide Plex button when plexAuthEnabled is false', async () => {
      vi.mocked(api.getAuthConfig).mockResolvedValueOnce({
        localAuthEnabled: true,
        plexAuthEnabled: false,
      })

      render(<LoginForm />)

      // Wait for config to load, then verify no Plex button
      await waitFor(() => {
        expect(api.getAuthConfig).toHaveBeenCalled()
      })

      expect(screen.queryByText('Sign in with Plex')).not.toBeInTheDocument()
    })

    it('should handle successful Plex login flow', async () => {
      const mockSetAuth = vi.fn()
      useAuthStore.setState({ setAuth: mockSetAuth } as unknown as Parameters<typeof useAuthStore.setState>[0])

      vi.mocked(api.getAuthConfig).mockResolvedValueOnce({
        localAuthEnabled: true,
        plexAuthEnabled: true,
      })

      vi.mocked(plexAuth.authenticateWithPlex).mockResolvedValueOnce('plex-auth-token')
      vi.mocked(api.loginWithPlex).mockResolvedValueOnce({
        accessToken: 'jwt-token',
        tokenType: 'bearer',
        role: 'viewer',
      })

      render(<LoginForm />)

      // Wait for config to load
      await waitFor(() => {
        expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
      })

      // Click Plex login button
      fireEvent.click(screen.getByText('Sign in with Plex'))

      await waitFor(() => {
        expect(plexAuth.authenticateWithPlex).toHaveBeenCalled()
        expect(api.loginWithPlex).toHaveBeenCalledWith('plex-auth-token')
      })
    })

    it('should not show error when Plex auth is cancelled', async () => {
      vi.mocked(api.getAuthConfig).mockResolvedValueOnce({
        localAuthEnabled: true,
        plexAuthEnabled: true,
      })

      vi.mocked(plexAuth.authenticateWithPlex).mockRejectedValueOnce(
        new Error('Authentication cancelled')
      )

      render(<LoginForm />)

      await waitFor(() => {
        expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Sign in with Plex'))

      await waitFor(() => {
        expect(plexAuth.authenticateWithPlex).toHaveBeenCalled()
      })

      // Should not show error for cancelled auth
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('should show error for other Plex auth failures', async () => {
      vi.mocked(api.getAuthConfig).mockResolvedValueOnce({
        localAuthEnabled: true,
        plexAuthEnabled: true,
      })

      vi.mocked(plexAuth.authenticateWithPlex).mockRejectedValueOnce(
        new Error('No access to Plex server')
      )

      render(<LoginForm />)

      await waitFor(() => {
        expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Sign in with Plex'))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('No access to Plex server')
      })
    })

    it('should hide local auth form when localAuthEnabled is false', async () => {
      vi.mocked(api.getAuthConfig).mockResolvedValueOnce({
        localAuthEnabled: false,
        plexAuthEnabled: true,
      })

      render(<LoginForm />)

      await waitFor(() => {
        expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
      })

      // Local auth fields should not be visible
      expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument()
      expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
    })
  })

  describe('Conditional Login UI (Story 8.4)', () => {
    it('should show error when no auth methods configured', async () => {
      vi.mocked(api.getAuthConfig).mockResolvedValueOnce({
        localAuthEnabled: false,
        plexAuthEnabled: false,
      })

      render(<LoginForm />)

      await waitFor(() => {
        expect(screen.getByText('No authentication methods configured')).toBeInTheDocument()
      })
      // Should not show login form elements
      expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument()
      expect(screen.queryByText('Sign in with Plex')).not.toBeInTheDocument()
      // Should show admin contact message
      expect(screen.getByText(/Please contact the administrator/)).toBeInTheDocument()
    })

    it('should show only credential form when local auth only', async () => {
      vi.mocked(api.getAuthConfig).mockResolvedValueOnce({
        localAuthEnabled: true,
        plexAuthEnabled: false,
      })

      render(<LoginForm />)

      await waitFor(() => {
        expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
      })
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
      expect(screen.getByText('Sign In')).toBeInTheDocument()
      // Plex button should not be visible
      expect(screen.queryByText('Sign in with Plex')).not.toBeInTheDocument()
      // Separator should not be visible
      expect(screen.queryByText('or')).not.toBeInTheDocument()
    })

    it('should show only Plex button when Plex auth only', async () => {
      vi.mocked(api.getAuthConfig).mockResolvedValueOnce({
        localAuthEnabled: false,
        plexAuthEnabled: true,
      })

      render(<LoginForm />)

      await waitFor(() => {
        expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
      })
      // Local auth should not be visible
      expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument()
      expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
      // Separator should not be visible
      expect(screen.queryByText('or')).not.toBeInTheDocument()
    })

    it('should show both options with separator when both enabled', async () => {
      vi.mocked(api.getAuthConfig).mockResolvedValueOnce({
        localAuthEnabled: true,
        plexAuthEnabled: true,
      })

      render(<LoginForm />)

      await waitFor(() => {
        expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
      })
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
      expect(screen.getByText('Sign In')).toBeInTheDocument()
      expect(screen.getByText('or')).toBeInTheDocument()
      expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
    })

    it('should show loading state while fetching config', () => {
      // Mock a never-resolving promise to keep loading state
      vi.mocked(api.getAuthConfig).mockImplementation(
        () => new Promise(() => {})
      )

      render(<LoginForm />)

      // Check for loading skeleton elements
      expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument()
      expect(screen.queryByText('Sign in with Plex')).not.toBeInTheDocument()
      // Verify title is not visible yet (skeleton is shown)
      expect(screen.queryByText('Channel Club')).not.toBeInTheDocument()
    })

    it('should redirect on successful local login', async () => {
      const mockSetAuth = vi.fn()
      useAuthStore.setState({ setAuth: mockSetAuth } as unknown as Parameters<typeof useAuthStore.setState>[0])

      vi.mocked(api.login).mockResolvedValueOnce({
        accessToken: 'jwt-token',
        tokenType: 'bearer',
        role: 'admin',
      })

      render(<LoginForm />)

      await waitFor(() => {
        expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
      })

      fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'admin' } })
      fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'admin' } })
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

      await waitFor(() => {
        expect(mockSetAuth).toHaveBeenCalledWith('jwt-token', 'admin', 'admin')
      })
    })

    it('should redirect on successful Plex login', async () => {
      const mockSetAuth = vi.fn()
      useAuthStore.setState({ setAuth: mockSetAuth } as unknown as Parameters<typeof useAuthStore.setState>[0])

      vi.mocked(api.getAuthConfig).mockResolvedValueOnce({
        localAuthEnabled: true,
        plexAuthEnabled: true,
      })

      vi.mocked(plexAuth.authenticateWithPlex).mockResolvedValueOnce('plex-auth-token')
      vi.mocked(api.loginWithPlex).mockResolvedValueOnce({
        accessToken: 'jwt-token',
        tokenType: 'bearer',
        role: 'viewer',
      })

      render(<LoginForm />)

      await waitFor(() => {
        expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Sign in with Plex'))

      await waitFor(() => {
        expect(mockSetAuth).toHaveBeenCalledWith('jwt-token', 'viewer')
      })
    })
  })

  describe('QR Code Plex Authentication', () => {
    beforeEach(() => {
      vi.mocked(api.getAuthConfig).mockResolvedValue({
        localAuthEnabled: false,
        plexAuthEnabled: true,
      })
    })

    it('should show QR login on TV mode when Plex button clicked', async () => {
      vi.mocked(useTVModeModule.useTVMode).mockReturnValue(true)

      render(<LoginForm />)

      await waitFor(() => {
        expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Sign in with Plex'))

      await waitFor(() => {
        expect(screen.getByTestId('qr-plex-login')).toBeInTheDocument()
      })
    })

    it('should show "Use QR code" link for desktop users', async () => {
      vi.mocked(useTVModeModule.useTVMode).mockReturnValue(false)

      render(<LoginForm />)

      await waitFor(() => {
        expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
      })

      expect(screen.getByText(/use qr code instead/i)).toBeInTheDocument()
    })

    it('should not show "Use QR code" link for TV users', async () => {
      vi.mocked(useTVModeModule.useTVMode).mockReturnValue(true)

      render(<LoginForm />)

      await waitFor(() => {
        expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
      })

      expect(screen.queryByText(/use qr code instead/i)).not.toBeInTheDocument()
    })

    it('should show QR login when desktop user clicks QR link', async () => {
      vi.mocked(useTVModeModule.useTVMode).mockReturnValue(false)

      render(<LoginForm />)

      await waitFor(() => {
        expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText(/use qr code instead/i))

      await waitFor(() => {
        expect(screen.getByTestId('qr-plex-login')).toBeInTheDocument()
      })
    })

    it('should handle successful QR auth flow', async () => {
      const mockSetAuth = vi.fn()
      useAuthStore.setState({ setAuth: mockSetAuth } as unknown as Parameters<typeof useAuthStore.setState>[0])

      vi.mocked(useTVModeModule.useTVMode).mockReturnValue(true)
      vi.mocked(api.loginWithPlex).mockResolvedValueOnce({
        accessToken: 'jwt-from-qr',
        tokenType: 'bearer',
        role: 'admin',
      })

      render(<LoginForm />)

      await waitFor(() => {
        expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Sign in with Plex'))

      await waitFor(() => {
        expect(screen.getByTestId('qr-plex-login')).toBeInTheDocument()
      })

      // Trigger mock QR success
      fireEvent.click(screen.getByText('Mock QR Success'))

      await waitFor(() => {
        expect(api.loginWithPlex).toHaveBeenCalledWith('qr-auth-token')
        expect(mockSetAuth).toHaveBeenCalledWith('jwt-from-qr', 'admin')
      })
    })

    it('should return to select mode on QR cancel', async () => {
      vi.mocked(useTVModeModule.useTVMode).mockReturnValue(true)

      render(<LoginForm />)

      await waitFor(() => {
        expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Sign in with Plex'))

      await waitFor(() => {
        expect(screen.getByTestId('qr-plex-login')).toBeInTheDocument()
      })

      // Trigger mock QR cancel
      fireEvent.click(screen.getByText('Mock QR Cancel'))

      await waitFor(() => {
        expect(screen.queryByTestId('qr-plex-login')).not.toBeInTheDocument()
        expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
      })
    })

    it('should show error on QR error', async () => {
      vi.mocked(useTVModeModule.useTVMode).mockReturnValue(true)

      render(<LoginForm />)

      await waitFor(() => {
        expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Sign in with Plex'))

      await waitFor(() => {
        expect(screen.getByTestId('qr-plex-login')).toBeInTheDocument()
      })

      // Trigger mock QR error
      fireEvent.click(screen.getByText('Mock QR Error'))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('QR error')
      })
    })

    it('should use popup flow for desktop users by default', async () => {
      vi.mocked(useTVModeModule.useTVMode).mockReturnValue(false)
      vi.mocked(plexAuth.authenticateWithPlex).mockResolvedValueOnce('plex-token')
      vi.mocked(api.loginWithPlex).mockResolvedValueOnce({
        accessToken: 'jwt-token',
        tokenType: 'bearer',
        role: 'viewer',
      })

      render(<LoginForm />)

      await waitFor(() => {
        expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Sign in with Plex'))

      // Should not show QR login, should call popup auth
      await waitFor(() => {
        expect(plexAuth.authenticateWithPlex).toHaveBeenCalled()
      })
      expect(screen.queryByTestId('qr-plex-login')).not.toBeInTheDocument()
    })
  })
})
