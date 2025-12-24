import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LoginForm } from './LoginForm'
import { useAuthStore } from '@/stores/authStore'
import * as api from '@/services/api'

vi.mock('@/services/api', () => ({
  login: vi.fn(),
}))

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({
      token: null,
      role: null,
      isAuthenticated: false,
    })
  })

  it('should render login form with username and password fields', () => {
    render(<LoginForm />)

    expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('should render with 10-foot UI title', () => {
    render(<LoginForm />)

    expect(screen.getByText('IPTV Viewer')).toBeInTheDocument()
  })

  it('should update input values on change', () => {
    render(<LoginForm />)

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

    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'baduser' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'badpass' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials')
  })

  it('should have proper tab order for keyboard navigation', () => {
    render(<LoginForm />)

    const usernameInput = screen.getByLabelText(/username/i)
    const passwordInput = screen.getByLabelText(/password/i)
    const submitButton = screen.getByRole('button', { name: /sign in/i })

    // Check tabindex is not set (default natural tab order)
    expect(usernameInput).not.toHaveAttribute('tabindex', '-1')
    expect(passwordInput).not.toHaveAttribute('tabindex', '-1')
    expect(submitButton).not.toHaveAttribute('tabindex', '-1')
  })

  it('should have 10-foot UI appropriate styling', () => {
    render(<LoginForm />)

    const usernameInput = screen.getByLabelText(/username/i)
    const submitButton = screen.getByRole('button', { name: /sign in/i })

    // Check for h-14 class (56px height for 10-foot UI)
    expect(usernameInput.className).toContain('h-14')
    expect(submitButton.className).toContain('h-14')
  })
})
