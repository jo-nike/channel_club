import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { App } from './App'
import { MainView } from '@/components/MainView'
import { useAuthStore } from '@/stores/authStore'
import { useChannelStore } from '@/stores/channelStore'
import { useUIStore } from '@/stores/uiStore'
import * as api from '@/services/api'

vi.mock('@/services/api', () => ({
  fetchChannels: vi.fn(),
  fetchNowPlaying: vi.fn(),
  getAuthConfig: vi.fn().mockResolvedValue({
    localAuthEnabled: true,
    plexAuthEnabled: false,
  }),
}))

// Mock Vidstack web components
beforeEach(() => {
  if (!customElements.get('media-player')) {
    customElements.define(
      'media-player',
      class extends HTMLElement {
        subscribe(callback: (state: Record<string, unknown>) => void) {
          callback({
            error: undefined,
            waiting: false,
            playing: false,
            canPlay: false,
          })
          return () => {}
        }
      }
    )
  }
  if (!customElements.get('media-outlet')) {
    customElements.define('media-outlet', class extends HTMLElement {})
  }
  if (!customElements.get('media-community-skin')) {
    customElements.define('media-community-skin', class extends HTMLElement {})
  }
})

// Helper to render App with routing context
const renderWithRouter = () => {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <App />,
        children: [
          {
            index: true,
            element: <MainView />,
          },
        ],
      },
    ],
    { initialEntries: ['/'] }
  )
  return render(<RouterProvider router={router} />)
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({
      token: null,
      role: null,
      isAuthenticated: false,
      isInitializing: false,
    })
    useChannelStore.setState({
      channels: [],
      currentChannel: null,
      isLoading: false,
      error: null,
    })
    useUIStore.setState({
      isTheaterMode: false,
      isSidebarOpen: false,
    })
    vi.mocked(api.fetchChannels).mockResolvedValue([])
  })

  describe('unauthenticated state', () => {
    it('should show LoginForm when not authenticated', async () => {
      renderWithRouter()

      // Wait for auth config to load before checking for form fields
      await waitFor(() => {
        expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
      })
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    })

    it('should not show MainView when not authenticated', () => {
      renderWithRouter()

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
        isInitializing: false,
      })
    })

    it('should show MainView when authenticated with valid token', () => {
      renderWithRouter()

      expect(screen.getByRole('button', { name: /logout/i })).toBeInTheDocument()
    })

    it('should not show LoginForm when authenticated', () => {
      renderWithRouter()

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
        isInitializing: false,
        logout: logoutSpy,
      })

      renderWithRouter()

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
        isInitializing: false,
        logout: logoutSpy,
      })

      renderWithRouter()

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
        isInitializing: false,
      })

      renderWithRouter()

      // Admin should see the admin button to open admin panel
      expect(screen.getByRole('button', { name: /open admin panel/i })).toBeInTheDocument()
    })

    it('should NOT show admin controls for viewer role', () => {
      const payload = { exp: Math.floor(Date.now() / 1000) + 3600 }
      const token = `header.${btoa(JSON.stringify(payload))}.signature`

      useAuthStore.setState({
        token,
        role: 'viewer',
        isAuthenticated: true,
        isInitializing: false,
      })

      renderWithRouter()

      // Viewer should NOT see the admin button
      expect(screen.queryByRole('button', { name: /open admin panel/i })).not.toBeInTheDocument()
    })
  })
})
