import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@/test/utils'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ProtectedRoute } from './ProtectedRoute'
import { useAuthStore } from '@/stores/authStore'

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to the root when not authenticated', () => {
    useAuthStore.setState({
      token: null,
      role: null,
      isAuthenticated: false,
      isInitializing: false,
    })

    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route path="/" element={<div>Login Page</div>} />
          <Route
            path="/protected"
            element={
              <ProtectedRoute>
                <div>Protected Content</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    )

    expect(screen.getByText('Login Page')).toBeInTheDocument()
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
  })

  it('renders children when authenticated', () => {
    // Create a valid JWT token
    const payload = { exp: Math.floor(Date.now() / 1000) + 3600 }
    const token = `header.${btoa(JSON.stringify(payload))}.signature`

    useAuthStore.setState({
      token,
      role: 'viewer',
      isAuthenticated: true,
      isInitializing: false,
    })

    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      </MemoryRouter>
    )

    expect(screen.getByText('Protected Content')).toBeInTheDocument()
  })

  it('renders nothing while initializing', () => {
    useAuthStore.setState({
      token: null,
      role: null,
      isAuthenticated: false,
      isInitializing: true,
    })

    const { container } = render(
      <MemoryRouter>
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      </MemoryRouter>
    )

    expect(container.firstChild).toBeNull()
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
  })
})
