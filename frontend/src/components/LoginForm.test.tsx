import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { StrictMode } from 'react'
import { cleanup, render as renderAtRoot } from '@testing-library/react'
import { render, screen, fireEvent, waitFor, within, act } from '@/test/utils'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { LoginForm } from './LoginForm'
import { focusOverrides } from '@/test/focus'
import { useAuthStore } from '@/stores/authStore'
import * as api from '@/services/api'
import * as plexAuth from '@/services/plexAuth'
import * as useTVModeModule from '@/hooks/useTVMode'

vi.mock('@/services/api', () => ({
  login: vi.fn(),
  getAuthConfig: vi.fn(),
  loginWithPlex: vi.fn(),
}))

vi.mock('@/services/plexAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/plexAuth')>()),
  authenticateWithPlex: vi.fn(),
  openPlexAuthWindow: vi.fn(),
}))

/** Stand-in for the window returned by openPlexAuthWindow. */
const plexWindow = { closed: false, close: vi.fn() } as unknown as Window

vi.mock('@/hooks/useTVMode', () => ({
  useTVMode: vi.fn(() => false),
}))

// Mock QRPlexLogin component for testing; its cancel button shows the label it is given
vi.mock('@/components/QRPlexLogin', () => ({
  QRPlexLogin: ({ onSuccess, onCancel, onError, onCodeRequested, variant, autoRestart, cancelLabel }: {
    onSuccess: (token: string) => void
    onCancel: () => void
    onError?: (err: Error) => void
    onCodeRequested?: () => void
    variant?: 'default' | 'tv'
    autoRestart?: boolean
    cancelLabel?: string
  }) => (
    <div
      data-testid="qr-plex-login"
      data-variant={variant ?? 'default'}
      data-auto-restart={String(autoRestart ?? false)}
    >
      <button onClick={() => onSuccess('qr-auth-token')}>Mock QR Success</button>
      <button onClick={onCancel}>{cancelLabel ?? 'Cancel'}</button>
      <button onClick={() => onError?.(new Error('QR error'))}>Mock QR Error</button>
      <button onClick={() => onCodeRequested?.()}>Mock New Code</button>
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
    vi.mocked(plexAuth.openPlexAuthWindow).mockReturnValue(plexWindow)
    vi.mocked(useTVModeModule.useTVMode).mockReturnValue(false)
  })

  it('should render login form with username and password fields', async () => {
    render(<LoginForm />)

    await waitFor(() => {
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
    })
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('shows the wordmark as its heading', async () => {
    render(<LoginForm />)

    await screen.findByLabelText(/username/i)
    const heading = screen.getByRole('heading', { level: 1, name: 'Channel Club' })
    expect(within(heading).getByRole('img', { name: 'Channel Club' })).toHaveAttribute('data-size', 'lg')
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

  it('shows the error text in the foreground colour on its translucent red tint', async () => {
    vi.mocked(api.login).mockRejectedValueOnce(new Error('Invalid credentials'))

    render(<LoginForm />)

    await waitFor(() => {
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'baduser' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'badpass' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveClass('text-foreground', 'bg-destructive/10')
    expect(alert).not.toHaveClass('text-destructive-foreground')
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

  it('sizes the fields, labels and button for a desktop, not a TV', async () => {
    render(<LoginForm />)

    const usernameInput = await screen.findByLabelText(/username/i)
    const submitButton = screen.getByRole('button', { name: /sign in/i })

    for (const input of [usernameInput, screen.getByLabelText(/password/i)]) {
      expect(input).toHaveClass('h-11', 'text-base', 'md:text-base')
      expect(input).not.toHaveClass('h-14')
      expect(input).not.toHaveClass('text-2xl')
    }
    expect(screen.getByText('Username')).toHaveClass('text-sm')
    expect(screen.getByText('Username')).not.toHaveClass('text-xl')
    expect(submitButton).toHaveClass('h-12', 'text-base')
    expect(submitButton).not.toHaveClass('h-14')
    expect(submitButton).not.toHaveClass('text-2xl')
  })

  it('keeps the room-sized fields and button on a TV', async () => {
    vi.mocked(useTVModeModule.useTVMode).mockReturnValue(true)
    render(<LoginForm />)

    const usernameInput = await screen.findByLabelText(/username/i)

    expect(usernameInput).toHaveClass('h-14', 'text-2xl')
    expect(screen.getByText('Username')).toHaveClass('text-xl')
    expect(screen.getByRole('button', { name: /sign in/i })).toHaveClass('h-14', 'text-2xl')
  })

  it('makes Sign In the primary button when it is the only way in', async () => {
    render(<LoginForm />)

    const submitButton = await screen.findByRole('button', { name: 'Sign In' })
    expect(submitButton).toHaveAttribute('data-variant', 'default')
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
        new plexAuth.PlexAuthError('cancelled', 'Any wording')
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
      expect(await screen.findByRole('button', { name: 'Sign in with Plex' })).toBeEnabled()
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
      // Retrying won't change the server's answer, so no Plex actions
      expect(within(screen.getByRole('alert')).queryByRole('button')).not.toBeInTheDocument()
    })

    it('opens the Plex window during the click, before anything is awaited', async () => {
      vi.mocked(api.getAuthConfig).mockResolvedValueOnce({
        localAuthEnabled: true,
        plexAuthEnabled: true,
      })
      vi.mocked(plexAuth.authenticateWithPlex).mockReturnValueOnce(new Promise(() => {}))

      render(<LoginForm />)
      fireEvent.click(await screen.findByText('Sign in with Plex'))

      // Checked synchronously after the click: no await has run yet
      expect(plexAuth.openPlexAuthWindow).toHaveBeenCalledTimes(1)
      expect(plexAuth.authenticateWithPlex).toHaveBeenCalledWith(plexWindow, expect.any(AbortSignal))
    })

    it('shows an error and starts no flow when the browser blocks the window', async () => {
      vi.mocked(api.getAuthConfig).mockResolvedValueOnce({
        localAuthEnabled: true,
        plexAuthEnabled: true,
      })
      vi.mocked(plexAuth.openPlexAuthWindow).mockReturnValueOnce(null)

      render(<LoginForm />)
      fireEvent.click(await screen.findByText('Sign in with Plex'))

      expect(await screen.findByRole('alert')).toHaveTextContent('Your browser blocked the Plex window.')
      expect(plexAuth.authenticateWithPlex).not.toHaveBeenCalled()
      expect(screen.getByText('Sign in with Plex')).toBeEnabled()
    })

    describe('actionable error callout', () => {
      beforeEach(() => {
        vi.mocked(api.getAuthConfig).mockResolvedValue({
          localAuthEnabled: true,
          plexAuthEnabled: true,
        })
      })

      async function blockedWindow() {
        vi.mocked(plexAuth.openPlexAuthWindow).mockReturnValueOnce(null)
        render(<LoginForm />)
        fireEvent.click(await screen.findByText('Sign in with Plex'))
        return screen.findByRole('alert')
      }

      it('offers Try again and Sign in with a code when the window is blocked', async () => {
        const alert = await blockedWindow()

        expect(alert).toHaveTextContent('Your browser blocked the Plex window.')
        expect(within(alert).getByRole('button', { name: 'Try again' })).toBeEnabled()
        expect(within(alert).getByRole('button', { name: 'Sign in with a code' })).toBeEnabled()
      })

      it('keeps the Plex button the only amber action, with Try again stepped back', async () => {
        const alert = await blockedWindow()

        expect(within(alert).getByRole('button', { name: 'Try again' })).toHaveAttribute('data-variant', 'secondary')
        // The default variant is bg-primary, amber under Club Night; only Plex's own button is filled
        const filled = screen.getAllByRole('button').filter((b) => b.getAttribute('data-variant') === 'default')
        expect(filled.map((b) => b.textContent)).toEqual(['Sign in with Plex'])
      })

      it('is a small callout with an icon, in the foreground colour on the red tint', async () => {
        const alert = await blockedWindow()

        expect(alert).toHaveClass('text-sm', 'text-foreground', 'bg-destructive/10')
        expect(alert).not.toHaveClass('text-xl')
        expect(alert.querySelector('svg')).toHaveClass('text-destructive')
      })

      it('Sign in with a code switches to the code sign-in and clears the error', async () => {
        const alert = await blockedWindow()

        fireEvent.click(within(alert).getByRole('button', { name: 'Sign in with a code' }))

        expect(await screen.findByTestId('qr-plex-login')).toBeInTheDocument()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      })

      it('the Sign in with a code link below the button clears the error too', async () => {
        const alert = await blockedWindow()
        const link = screen.getAllByRole('button', { name: 'Sign in with a code' })
          .find((el) => !alert.contains(el))

        fireEvent.click(link!)

        expect(await screen.findByTestId('qr-plex-login')).toBeInTheDocument()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      })

      it('Try again opens the Plex window again and clears the error', async () => {
        vi.mocked(plexAuth.authenticateWithPlex).mockReturnValueOnce(new Promise(() => {}))
        const alert = await blockedWindow()

        fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))

        expect(plexAuth.openPlexAuthWindow).toHaveBeenCalledTimes(2)
        expect(plexAuth.authenticateWithPlex).toHaveBeenCalledWith(plexWindow, expect.any(AbortSignal))
        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
        expect(screen.getByRole('button', { name: 'Waiting for Plex...' })).toBeDisabled()
      })

      it.each([
        ['timeout', 'Plex sign-in timed out.'],
        ['rate_limited', 'Too many attempts, wait a minute.'],
      ] as const)('shows the %s copy with both actions', async (code, copy) => {
        vi.mocked(plexAuth.authenticateWithPlex).mockRejectedValueOnce(
          new plexAuth.PlexAuthError(code, 'raw message')
        )
        render(<LoginForm />)
        fireEvent.click(await screen.findByText('Sign in with Plex'))

        const alert = await screen.findByRole('alert')
        expect(alert).toHaveTextContent(copy)
        expect(alert).not.toHaveTextContent('raw message')
        expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
        expect(within(alert).getByRole('button', { name: 'Sign in with a code' })).toBeInTheDocument()
      })
    })

    describe('Cancel while waiting for Plex', () => {
      beforeEach(() => {
        vi.mocked(api.getAuthConfig).mockResolvedValue({
          localAuthEnabled: true,
          plexAuthEnabled: true,
        })
      })

      /** Behaves like the real flow: pending until the signal aborts, then 'cancelled'. */
      function pendingUntilAborted() {
        const signals: AbortSignal[] = []
        vi.mocked(plexAuth.authenticateWithPlex).mockImplementationOnce((_popup, signal) => {
          if (signal) signals.push(signal)
          return new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => {
              reject(new plexAuth.PlexAuthError('cancelled', 'Authentication cancelled'))
            })
          })
        })
        return signals
      }

      it('shows Waiting for Plex with a Cancel button while the window is open', async () => {
        pendingUntilAborted()
        render(<LoginForm />)
        fireEvent.click(await screen.findByText('Sign in with Plex'))

        expect(await screen.findByRole('button', { name: 'Waiting for Plex...' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
      })

      it('Cancel aborts the flow and re-enables the button with no error', async () => {
        const signals = pendingUntilAborted()
        render(<LoginForm />)
        fireEvent.click(await screen.findByText('Sign in with Plex'))

        fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

        expect(signals[0].aborted).toBe(true)
        expect(await screen.findByRole('button', { name: 'Sign in with Plex' })).toBeEnabled()
        expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Sign In' })).toBeEnabled()
        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
      })

      it('does not sign in when Cancel is pressed after Plex returned a token', async () => {
        const mockSetAuth = vi.fn()
        useAuthStore.setState({ setAuth: mockSetAuth } as unknown as Parameters<typeof useAuthStore.setState>[0])
        vi.mocked(plexAuth.authenticateWithPlex).mockResolvedValueOnce('plex-auth-token')
        let finishLogin!: (r: Awaited<ReturnType<typeof api.loginWithPlex>>) => void
        vi.mocked(api.loginWithPlex).mockReturnValueOnce(new Promise((done) => { finishLogin = done }))

        render(<LoginForm />)
        fireEvent.click(await screen.findByText('Sign in with Plex'))
        await waitFor(() => expect(api.loginWithPlex).toHaveBeenCalledWith('plex-auth-token'))

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
        finishLogin({ accessToken: 'jwt-token', tokenType: 'bearer', role: 'viewer' })

        expect(await screen.findByRole('button', { name: 'Sign in with Plex' })).toBeEnabled()
        // Let the finished login settle before checking nothing was signed in
        await new Promise((done) => setTimeout(done, 0))
        expect(mockSetAuth).not.toHaveBeenCalled()
      })

      it('a local sign-in disables the Plex button without the waiting state', async () => {
        vi.mocked(api.login).mockReturnValueOnce(new Promise(() => {}))
        render(<LoginForm />)

        fireEvent.change(await screen.findByLabelText(/username/i), { target: { value: 'u' } })
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'p' } })
        fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

        expect(await screen.findByRole('button', { name: 'Sign in with Plex' })).toBeDisabled()
        expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
      })
    })

    describe('redirect sign-in on iPhone, iPad and installed apps', () => {
      const IPHONE =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
      const ANDROID =
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
      const originalLocation = window.location
      const originalMatchMedia = window.matchMedia
      let assign: ReturnType<typeof vi.fn>

      function userAgent(ua: string) {
        Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
      }

      beforeEach(() => {
        vi.mocked(api.getAuthConfig).mockResolvedValue({
          localAuthEnabled: true,
          plexAuthEnabled: true,
        })
        assign = vi.fn()
        Object.defineProperty(window, 'location', {
          value: { ...originalLocation, origin: 'https://club.example', assign },
          writable: true,
          configurable: true,
        })
        // The real redirect flow runs; only Plex's API is faked
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ id: 42, code: 'PINCODE', authToken: null }),
        } as Response))
        sessionStorage.clear()
      })

      afterEach(() => {
        Object.defineProperty(window, 'location', {
          value: originalLocation,
          writable: true,
          configurable: true,
        })
        window.matchMedia = originalMatchMedia
        Reflect.deleteProperty(navigator, 'userAgent')
        vi.unstubAllGlobals()
        sessionStorage.clear()
      })

      async function expectSentToPlex() {
        await waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
        const url = new URL(assign.mock.calls[0][0] as string)
        expect(url.origin + url.pathname).toBe('https://app.plex.tv/auth')
        expect(new URLSearchParams(url.hash.slice(2)).get('forwardUrl')).toBe('https://club.example/')
        expect(sessionStorage.getItem(plexAuth.PLEX_PENDING_PIN_KEY)).toBe('42')
        expect(plexAuth.openPlexAuthWindow).not.toHaveBeenCalled()
        expect(plexAuth.authenticateWithPlex).not.toHaveBeenCalled()
      }

      it('sends the whole page to Plex with forwardUrl on an iPhone, opening no window', async () => {
        userAgent(IPHONE)
        render(<LoginForm />)
        fireEvent.click(await screen.findByText('Sign in with Plex'))

        await expectSentToPlex()
        // Stays waiting while the page leaves
        expect(screen.getByRole('button', { name: 'Waiting for Plex...' })).toBeDisabled()
      })

      it('sends the whole page to Plex from an installed app (standalone display mode)', async () => {
        window.matchMedia = vi.fn((query: string) => ({
          ...originalMatchMedia(query),
          matches: query === '(display-mode: standalone)',
        }))
        render(<LoginForm />)
        fireEvent.click(await screen.findByText('Sign in with Plex'))

        await expectSentToPlex()
      })

      it('keeps the popup in an Android browser', async () => {
        userAgent(ANDROID)
        vi.mocked(plexAuth.authenticateWithPlex).mockReturnValueOnce(new Promise(() => {}))
        render(<LoginForm />)
        fireEvent.click(await screen.findByText('Sign in with Plex'))

        expect(plexAuth.openPlexAuthWindow).toHaveBeenCalledTimes(1)
        expect(plexAuth.authenticateWithPlex).toHaveBeenCalledWith(plexWindow, expect.any(AbortSignal))
        expect(assign).not.toHaveBeenCalled()
        expect(sessionStorage.getItem(plexAuth.PLEX_PENDING_PIN_KEY)).toBeNull()
      })

      it('shows the callout and stays on the page when Plex refuses the PIN', async () => {
        userAgent(IPHONE)
        vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 429 } as Response)
        render(<LoginForm />)
        fireEvent.click(await screen.findByText('Sign in with Plex'))

        const alert = await screen.findByRole('alert')
        expect(alert).toHaveTextContent('Too many attempts, wait a minute.')
        expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
        expect(within(alert).getByRole('button', { name: 'Sign in with a code' })).toBeInTheDocument()
        expect(assign).not.toHaveBeenCalled()
        expect(screen.getByRole('button', { name: 'Sign in with Plex' })).toBeEnabled()
      })

      describe('Back from Plex restores the page from the back-forward cache', () => {
        const restorePage = () =>
          act(() => {
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
          })

        async function waitingForPlex() {
          userAgent(IPHONE)
          render(<LoginForm />)
          fireEvent.click(await screen.findByText('Sign in with Plex'))
          await expectSentToPlex()
          expect(screen.getByRole('button', { name: 'Waiting for Plex...' })).toBeDisabled()
          vi.mocked(fetch).mockClear()
        }

        it('checks the pending PIN, as a normal return would, and signs in', async () => {
          const mockSetAuth = vi.fn()
          useAuthStore.setState({ setAuth: mockSetAuth } as unknown as Parameters<typeof useAuthStore.setState>[0])
          vi.mocked(api.loginWithPlex).mockResolvedValue({
            accessToken: 'jwt-token',
            tokenType: 'bearer',
            role: 'viewer',
          })
          await waitingForPlex()
          vi.mocked(fetch).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ authToken: 'plex-token' }),
          } as Response)

          await restorePage()

          await waitFor(() => expect(mockSetAuth).toHaveBeenCalledWith('jwt-token', 'viewer'))
          expect(fetch).toHaveBeenCalledWith('https://plex.tv/api/v2/pins/42', expect.anything())
          expect(sessionStorage.getItem(plexAuth.PLEX_PENDING_PIN_KEY)).toBeNull()
        })

        it('stops the PIN checks it started when the form goes away', async () => {
          await waitingForPlex()
          // Plex hasn't marked the PIN yet, so the checks would go on every second
          vi.mocked(fetch).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ authToken: null }),
          } as Response)
          vi.useFakeTimers()
          try {
            await restorePage()
            await act(() => vi.advanceTimersByTimeAsync(0))
            expect(fetch).toHaveBeenCalledTimes(1)

            cleanup()
            await act(() => vi.advanceTimersByTimeAsync(10_000))

            expect(fetch).toHaveBeenCalledTimes(1)
          } finally {
            vi.useRealTimers()
          }
        })

        it('stops waiting when no PIN is pending', async () => {
          await waitingForPlex()
          sessionStorage.clear()

          await restorePage()

          expect(await screen.findByRole('button', { name: 'Sign in with Plex' })).toBeEnabled()
          expect(fetch).not.toHaveBeenCalled()
          expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        })

        it('ignores a normal page show', async () => {
          await waitingForPlex()

          await act(() => {
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }))
          })

          expect(screen.getByRole('button', { name: 'Waiting for Plex...' })).toBeDisabled()
          expect(sessionStorage.getItem(plexAuth.PLEX_PENDING_PIN_KEY)).toBe('42')
          expect(fetch).not.toHaveBeenCalled()
        })
      })
    })

    describe('coming back from the Plex redirect', () => {
      const originalLocation = window.location
      let assign: ReturnType<typeof vi.fn>
      let mockSetAuth: ReturnType<typeof vi.fn>

      function pinStatus(authToken: string | null): Response {
        return { ok: true, json: () => Promise.resolve({ authToken }) } as Response
      }

      beforeEach(() => {
        vi.mocked(api.getAuthConfig).mockResolvedValue({
          localAuthEnabled: true,
          plexAuthEnabled: true,
        })
        vi.mocked(api.loginWithPlex).mockResolvedValue({
          accessToken: 'jwt-token',
          tokenType: 'bearer',
          role: 'viewer',
        })
        mockSetAuth = vi.fn()
        useAuthStore.setState({ setAuth: mockSetAuth } as unknown as Parameters<typeof useAuthStore.setState>[0])
        assign = vi.fn()
        Object.defineProperty(window, 'location', {
          value: { ...originalLocation, assign },
          writable: true,
          configurable: true,
        })
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pinStatus('plex-token')))
        sessionStorage.clear()
        sessionStorage.setItem(plexAuth.PLEX_PENDING_PIN_KEY, '42')
      })

      afterEach(() => {
        vi.useRealTimers()
        Object.defineProperty(window, 'location', {
          value: originalLocation,
          writable: true,
          configurable: true,
        })
        vi.unstubAllGlobals()
        sessionStorage.clear()
      })

      it('checks the pending PIN, signs in with its token and clears the key', async () => {
        render(<LoginForm />)

        await waitFor(() => expect(mockSetAuth).toHaveBeenCalledWith('jwt-token', 'viewer'))
        expect(fetch).toHaveBeenCalledWith('https://plex.tv/api/v2/pins/42', expect.anything())
        expect(api.loginWithPlex).toHaveBeenCalledWith('plex-token')
        expect(sessionStorage.getItem(plexAuth.PLEX_PENDING_PIN_KEY)).toBeNull()
        // Finishing needs no new window and no second trip to Plex
        expect(plexAuth.openPlexAuthWindow).not.toHaveBeenCalled()
        expect(assign).not.toHaveBeenCalled()
      })

      it('signs in once under StrictMode, whose re-run effect finds the key already gone', async () => {
        // StrictMode only re-runs effects when it is the root, as in main.tsx
        renderAtRoot(
          <StrictMode>
            <TooltipProvider>
              <LoginForm />
            </TooltipProvider>
          </StrictMode>
        )

        await waitFor(() => expect(mockSetAuth).toHaveBeenCalledTimes(1))
        // Let StrictMode's aborted first run settle before counting logins
        await new Promise((done) => setTimeout(done, 0))
        expect(api.loginWithPlex).toHaveBeenCalledTimes(1)
        expect(mockSetAuth).toHaveBeenCalledTimes(1)
      })

      it('removes the key before the check finishes and waits with a Cancel button', async () => {
        vi.mocked(fetch).mockReturnValue(new Promise<Response>(() => {}))
        render(<LoginForm />)

        expect(await screen.findByRole('button', { name: 'Waiting for Plex...' })).toBeDisabled()
        expect(sessionStorage.getItem(plexAuth.PLEX_PENDING_PIN_KEY)).toBeNull()

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

        expect(await screen.findByRole('button', { name: 'Sign in with Plex' })).toBeEnabled()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(api.loginWithPlex).not.toHaveBeenCalled()
      })

      it('shows the server error when the Plex login is refused', async () => {
        vi.mocked(api.loginWithPlex).mockRejectedValueOnce(new Error('No access to Plex server'))
        render(<LoginForm />)

        expect(await screen.findByRole('alert')).toHaveTextContent('No access to Plex server')
        expect(screen.getByRole('button', { name: 'Sign in with Plex' })).toBeEnabled()
        expect(mockSetAuth).not.toHaveBeenCalled()
      })

      it('shows no error when the user came back without signing in', async () => {
        vi.useFakeTimers()
        vi.mocked(fetch).mockResolvedValue(pinStatus(null))
        render(<LoginForm />)

        await act(() => vi.advanceTimersByTimeAsync(10_000))

        expect(fetch).toHaveBeenCalledTimes(5)
        expect(screen.getByRole('button', { name: 'Sign in with Plex' })).toBeEnabled()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(api.loginWithPlex).not.toHaveBeenCalled()
      })

      it('shows the actionable callout when Plex keeps refusing the check', async () => {
        vi.useFakeTimers()
        vi.mocked(fetch).mockResolvedValue({ ok: false, status: 429 } as Response)
        render(<LoginForm />)

        await act(() => vi.advanceTimersByTimeAsync(10_000))

        const alert = screen.getByRole('alert')
        expect(alert).toHaveTextContent('Too many attempts, wait a minute.')
        expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
        expect(within(alert).getByRole('button', { name: 'Sign in with a code' })).toBeInTheDocument()
      })

      it('says it could not finish, not start, when Plex fails the check', async () => {
        vi.useFakeTimers()
        vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response)
        render(<LoginForm />)

        await act(() => vi.advanceTimersByTimeAsync(10_000))

        const alert = screen.getByRole('alert')
        expect(alert).toHaveTextContent("Couldn't finish Plex sign-in. Try again.")
        expect(alert).not.toHaveTextContent("Couldn't start Plex sign-in.")
        expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
      })

      it('checks nothing on mount without a pending PIN', async () => {
        sessionStorage.clear()
        render(<LoginForm />)

        expect(await screen.findByRole('button', { name: 'Sign in with Plex' })).toBeEnabled()
        expect(fetch).not.toHaveBeenCalled()
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
        expect(screen.getByRole('alert')).toHaveTextContent('Sign-in is switched off on this server')
      })
      // Should not show login form elements
      expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument()
      expect(screen.queryByText('Sign in with Plex')).not.toBeInTheDocument()
      // Tells whoever runs the server how to turn sign-in on, or set it up here
      expect(screen.getByText(/If you run it, turn on/)).toHaveTextContent(
        'If you run it, turn on LOCAL_AUTH_ENABLED or PLEX_AUTH_ENABLED in its environment. To set it up here in the browser instead, remove the sign-in variables, give it a data folder with STATE_FILE, then restart it.'
      )
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

    it('steps Sign In back to secondary so the Plex button is the one call to action', async () => {
      vi.mocked(api.getAuthConfig).mockResolvedValueOnce({
        localAuthEnabled: true,
        plexAuthEnabled: true,
      })

      render(<LoginForm />)

      expect(await screen.findByRole('button', { name: 'Sign In' })).toHaveAttribute('data-variant', 'secondary')
      expect(screen.getByRole('button', { name: 'Sign in with Plex' })).toHaveClass('bg-[#E5A00D]', 'h-12', 'text-base')
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

      // The app's branded loading screen carries on, not a second skeleton
      expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument()
      expect(screen.queryByText('Sign in with Plex')).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 1, name: 'Channel Club' })).toBeInTheDocument()
      expect(screen.getByText('Loading…')).toBeInTheDocument()
      expect(document.querySelector('.animate-pulse')).toBeNull()
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

    it('opens straight to the TV code screen on a TV, without a click', async () => {
      vi.mocked(useTVModeModule.useTVMode).mockReturnValue(true)

      render(<LoginForm />)

      const qr = await screen.findByTestId('qr-plex-login')
      expect(qr).toHaveAttribute('data-variant', 'tv')
      expect(qr).toHaveAttribute('data-auto-restart', 'true')
      // The choice screen is skipped, not shown first
      expect(screen.queryByText('Sign in with Plex')).not.toBeInTheDocument()
      expect(plexAuth.openPlexAuthWindow).not.toHaveBeenCalled()
    })

    it('keeps the wordmark heading on the TV code screen', async () => {
      vi.mocked(useTVModeModule.useTVMode).mockReturnValue(true)

      render(<LoginForm />)

      await screen.findByTestId('qr-plex-login')
      expect(screen.getByRole('heading', { level: 1, name: 'Channel Club' })).toBeInTheDocument()
    })

    it('offers Cancel on a Plex-only TV, which returns to the Plex button', async () => {
      vi.mocked(useTVModeModule.useTVMode).mockReturnValue(true)

      render(<LoginForm />)

      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

      expect(await screen.findByRole('button', { name: 'Sign in with Plex' })).toHaveClass('h-14', 'text-2xl')
      expect(screen.queryByTestId('qr-plex-login')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Use another sign-in method' })).not.toBeInTheDocument()
    })

    it('pressing Sign in with Plex on a TV goes back to the code screen', async () => {
      vi.mocked(useTVModeModule.useTVMode).mockReturnValue(true)

      render(<LoginForm />)
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Plex' }))

      expect(await screen.findByTestId('qr-plex-login')).toHaveAttribute('data-variant', 'tv')
    })

    describe('on a TV with local sign-in too', () => {
      beforeEach(() => {
        vi.mocked(useTVModeModule.useTVMode).mockReturnValue(true)
        vi.mocked(api.getAuthConfig).mockResolvedValue({
          localAuthEnabled: true,
          plexAuthEnabled: true,
        })
      })

      it('still opens on the code screen, with Use another sign-in method', async () => {
        render(<LoginForm />)

        expect(await screen.findByTestId('qr-plex-login')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Use another sign-in method' })).toBeInTheDocument()
        expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument()
      })

      it('Use another sign-in method shows the form and does not re-enter the code screen', async () => {
        render(<LoginForm />)

        fireEvent.click(await screen.findByRole('button', { name: 'Use another sign-in method' }))

        expect(await screen.findByLabelText(/username/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Sign in with Plex' })).toBeInTheDocument()
        // Let any pending effects and promises settle: the code screen stays closed
        await new Promise((done) => setTimeout(done, 0))
        expect(screen.queryByTestId('qr-plex-login')).not.toBeInTheDocument()
        expect(api.getAuthConfig).toHaveBeenCalledTimes(1)
      })
    })

    it('does not open the code screen on a TV when Plex sign-in is off', async () => {
      vi.mocked(useTVModeModule.useTVMode).mockReturnValue(true)
      vi.mocked(api.getAuthConfig).mockResolvedValue({
        localAuthEnabled: true,
        plexAuthEnabled: false,
      })

      render(<LoginForm />)

      expect(await screen.findByLabelText(/username/i)).toBeInTheDocument()
      expect(screen.queryByTestId('qr-plex-login')).not.toBeInTheDocument()
    })

    it('does not open the code screen on a desktop', async () => {
      render(<LoginForm />)

      expect(await screen.findByText('Sign in with Plex')).toBeInTheDocument()
      await new Promise((done) => setTimeout(done, 0))
      expect(screen.queryByTestId('qr-plex-login')).not.toBeInTheDocument()
    })

    it('should show the "Sign in with a code" link for desktop users', async () => {
      vi.mocked(useTVModeModule.useTVMode).mockReturnValue(false)

      render(<LoginForm />)

      await waitFor(() => {
        expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
      })

      expect(screen.getByRole('button', { name: 'Sign in with a code' })).toBeInTheDocument()
    })

    it('should not show the "Sign in with a code" link for TV users', async () => {
      vi.mocked(useTVModeModule.useTVMode).mockReturnValue(true)

      render(<LoginForm />)
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

      await waitFor(() => {
        expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
      })

      expect(screen.queryByRole('button', { name: 'Sign in with a code' })).not.toBeInTheDocument()
    })

    it('should show QR login when desktop user clicks QR link', async () => {
      vi.mocked(useTVModeModule.useTVMode).mockReturnValue(false)

      render(<LoginForm />)

      await waitFor(() => {
        expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Sign in with a code' }))

      const qr = await screen.findByTestId('qr-plex-login')
      // A desktop keeps the compact code screen inside the card, and no restarts
      expect(qr).toHaveAttribute('data-variant', 'default')
      expect(qr).toHaveAttribute('data-auto-restart', 'false')
      expect(within(qr).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
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
      vi.mocked(useTVModeModule.useTVMode).mockReturnValue(false)

      render(<LoginForm />)

      fireEvent.click(await screen.findByRole('button', { name: 'Sign in with a code' }))

      await waitFor(() => {
        expect(screen.getByTestId('qr-plex-login')).toBeInTheDocument()
      })

      // Trigger mock QR cancel
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      await waitFor(() => {
        expect(screen.queryByTestId('qr-plex-login')).not.toBeInTheDocument()
        expect(screen.getByText('Sign in with Plex')).toBeInTheDocument()
      })
    })

    it('should show error on QR error', async () => {
      vi.mocked(useTVModeModule.useTVMode).mockReturnValue(true)

      render(<LoginForm />)

      await waitFor(() => {
        expect(screen.getByTestId('qr-plex-login')).toBeInTheDocument()
      })

      // Trigger mock QR error
      fireEvent.click(screen.getByText('Mock QR Error'))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('QR error')
      })
    })

    it('clears the error on a TV when a new code is asked for', async () => {
      vi.mocked(useTVModeModule.useTVMode).mockReturnValue(true)

      render(<LoginForm />)

      fireEvent.click(await screen.findByText('Mock QR Error'))
      expect(await screen.findByRole('alert')).toHaveTextContent('QR error')

      // Try Again, or an automatic restart, asks Plex for a fresh code
      fireEvent.click(screen.getByText('Mock New Code'))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByTestId('qr-plex-login')).toBeInTheDocument()
    })

    it('clears the error in the desktop code sign-in when a new code is asked for', async () => {
      vi.mocked(useTVModeModule.useTVMode).mockReturnValue(false)

      render(<LoginForm />)
      fireEvent.click(await screen.findByRole('button', { name: 'Sign in with a code' }))
      fireEvent.click(await screen.findByText('Mock QR Error'))
      expect(await screen.findByRole('alert')).toHaveTextContent('QR error')

      fireEvent.click(screen.getByText('Mock New Code'))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
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

  describe('iOS safe area', () => {
    const safe = ['p-4', 'pt-[max(1rem,env(safe-area-inset-top))]', 'pb-[max(1rem,env(safe-area-inset-bottom))]']

    it('keeps the sign-in screen at least 1rem clear of the status bar and home indicator', async () => {
      render(<LoginForm />)
      await screen.findByLabelText(/username/i)
      const heading = screen.getByRole('heading', { name: 'Channel Club' })
      expect(heading.closest('.min-h-screen')).toHaveClass(...safe)
    })

    it('keeps the loading screen clear of them too', () => {
      vi.mocked(api.getAuthConfig).mockReturnValue(new Promise(() => {}))
      const { container } = render(<LoginForm />)
      expect(container.firstChild).toHaveClass('h-screen', 'pt-safe', 'pb-safe')
    })
  })

  it('leaves focus on the fields and the sign-in button to the global outline', async () => {
    render(<LoginForm />)
    const username = await screen.findByLabelText(/username/i)

    for (const el of [username, screen.getByLabelText(/password/i), screen.getByRole('button', { name: /sign in/i })]) {
      expect(focusOverrides(el)).toEqual([])
    }
  })

  describe('first-run setup', () => {
    // Only these go through the router: the others render LoginForm alone
    function renderInRouter() {
      render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<LoginForm />} />
            <Route path="/setup" element={<p>Setup wizard</p>} />
          </Routes>
        </MemoryRouter>
      )
    }

    it('sends the first visitor to set the club up', async () => {
      vi.mocked(api.getAuthConfig).mockResolvedValueOnce({ localAuthEnabled: false, plexAuthEnabled: false, setupState: 'unclaimed' })

      renderInRouter()

      expect(await screen.findByText('Setup wizard')).toBeInTheDocument()
    })

    it('asks the admin of a club being set up to sign in', async () => {
      vi.mocked(api.getAuthConfig).mockResolvedValueOnce({ localAuthEnabled: true, plexAuthEnabled: false, setupState: 'claimed' })

      renderInRouter()

      expect(await screen.findByLabelText(/username/i)).toBeInTheDocument()
      expect(screen.queryByText('Setup wizard')).not.toBeInTheDocument()
    })
  })
})
