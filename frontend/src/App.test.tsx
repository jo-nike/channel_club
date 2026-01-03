import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { App } from './App'
import { useAuthStore } from '@/stores/authStore'

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({
      token: null,
      role: null,
      isAuthenticated: false,
    })
  })

  describe('unauthenticated state', () => {
    it('should show LoginForm when not authenticated', () => {
      render(<App />)

      expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    })

    it('should not show MainView when not authenticated', () => {
      render(<App />)

      expect(screen.queryByRole('button', { name: /logout/i })).not.toBeInTheDocument()
    })
  })

  describe('authenticated state with valid token', () => {
    beforeEach(() => {
      // Create a valid JWT token that expires in 1 hour
      const payload = { exp: Math.floor(Date.now() / 1000) + 3600 }
      const token = `header.${btoa(JSON.stringify(payload))}.signature`

      useAuthStore.setState({
        token,
        role: 'admin',
        isAuthenticated: true,
      })
    })

    it('should show MainView when authenticated with valid token', () => {
      render(<App />)

      expect(screen.getByRole('button', { name: /logout/i })).toBeInTheDocument()
      // MainView is rendered - check for connection status indicator
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should not show LoginForm when authenticated', () => {
      render(<App />)

      expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument()
    })
  })

  describe('token validation on mount', () => {
    it('should auto-logout when token is expired', async () => {
      const logoutSpy = vi.fn()
      // Create an expired JWT token
      const payload = { exp: Math.floor(Date.now() / 1000) - 3600 } // expired 1 hour ago
      const token = `header.${btoa(JSON.stringify(payload))}.signature`

      useAuthStore.setState({
        token,
        role: 'admin',
        isAuthenticated: true,
        logout: logoutSpy,
      })

      render(<App />)

      await waitFor(() => {
        expect(logoutSpy).toHaveBeenCalled()
      })
    })

    it('should auto-logout when token is malformed', async () => {
      const logoutSpy = vi.fn()

      useAuthStore.setState({
        token: 'invalid-malformed-token',
        role: 'admin',
        isAuthenticated: true,
        logout: logoutSpy,
      })

      render(<App />)

      await waitFor(() => {
        expect(logoutSpy).toHaveBeenCalled()
      })
    })
  })

  describe('role-based rendering', () => {
    it('should show admin controls for admin role', () => {
      const payload = { exp: Math.floor(Date.now() / 1000) + 3600 }
      const token = `header.${btoa(JSON.stringify(payload))}.signature`

      useAuthStore.setState({
        token,
        role: 'admin',
        isAuthenticated: true,
      })

      render(<App />)

      expect(screen.getByText(/channel selection/i)).toBeInTheDocument()
    })

    it('should NOT show admin controls for viewer role', () => {
      const payload = { exp: Math.floor(Date.now() / 1000) + 3600 }
      const token = `header.${btoa(JSON.stringify(payload))}.signature`

      useAuthStore.setState({
        token,
        role: 'viewer',
        isAuthenticated: true,
      })

      render(<App />)

      expect(screen.queryByText(/channel selection/i)).not.toBeInTheDocument()
    })
  })
})
