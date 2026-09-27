import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen, waitFor } from '@/test/utils'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
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

// Helper to mock window width
const mockWindowWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  })
  window.dispatchEvent(new Event('resize'))
}

// Lazy import to avoid circular dependencies; uses the real route table
const createRouter = async (initialEntries: string[]) => {
  const { routes } = await import('@/router')

  return createMemoryRouter(routes, { initialEntries })
}

describe('Router', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Create a valid JWT token
    const payload = { exp: Math.floor(Date.now() / 1000) + 3600 }
    const token = `header.${btoa(JSON.stringify(payload))}.signature`

    useAuthStore.setState({
      token,
      role: 'admin',
      isAuthenticated: true,
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

    mockWindowWidth(1200)
  })

  it('renders TVView at root path when authenticated', async () => {
    const router = await createRouter(['/'])

    render(<RouterProvider router={router} />)

    // TVView should be rendered - check for the account menu
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument()
  })

  it('redirects /tv to root for backwards compatibility', async () => {
    const router = await createRouter(['/tv'])

    render(<RouterProvider router={router} />)

    // Should redirect to root and show TVView
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument()
    // Verify we're at the root path after redirect
    expect(router.state.location.pathname).toBe('/')
  })

  it('redirects /ersatztv to root for backwards compatibility', async () => {
    const router = await createRouter(['/ersatztv'])

    render(<RouterProvider router={router} />)

    // Should redirect to root and show TVView
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument()
    // Verify we're at the root path after redirect
    expect(router.state.location.pathname).toBe('/')
  })

  it('redirects unknown paths to root when authenticated', async () => {
    const router = await createRouter(['/admin'])

    render(<RouterProvider router={router} />)

    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('redirects unknown paths to the sign-in screen when not authenticated', async () => {
    useAuthStore.setState({
      token: null,
      role: null,
      isAuthenticated: false,
      isInitializing: false,
    })

    const router = await createRouter(['/does-not-exist'])

    render(<RouterProvider router={router} />)

    // App shows the sign-in screen in place of any child route
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    })
    expect(screen.queryByText(/404 Not Found/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Unexpected Application Error/)).not.toBeInTheDocument()

    // Once signed in, the unknown path lands on the root view
    const payload = { exp: Math.floor(Date.now() / 1000) + 3600 }
    act(() => {
      useAuthStore.setState({
        token: `header.${btoa(JSON.stringify(payload))}.signature`,
        role: 'viewer',
        isAuthenticated: true,
      })
    })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument()
  })

  it('shows login form when not authenticated', async () => {
    useAuthStore.setState({
      token: null,
      role: null,
      isAuthenticated: false,
      isInitializing: false,
    })

    const router = await createRouter(['/'])

    render(<RouterProvider router={router} />)

    // LoginForm should be displayed when not authenticated - wait for config to load
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    })
  })

  it('shows login form for protected routes when not authenticated', async () => {
    useAuthStore.setState({
      token: null,
      role: null,
      isAuthenticated: false,
      isInitializing: false,
    })

    const router = await createRouter(['/'])

    render(<RouterProvider router={router} />)

    // LoginForm should be displayed (not TVView) - wait for config to load
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument()
  })

  it('shows admin button for admin users', async () => {
    const router = await createRouter(['/'])

    render(<RouterProvider router={router} />)

    // Admin should see the admin button to open admin panel
    expect(screen.getByRole('button', { name: /open admin panel/i })).toBeInTheDocument()
  })

  it('does not show admin button for viewer users', async () => {
    const payload = { exp: Math.floor(Date.now() / 1000) + 3600 }
    const token = `header.${btoa(JSON.stringify(payload))}.signature`

    useAuthStore.setState({
      token,
      role: 'viewer',
      isAuthenticated: true,
      isInitializing: false,
    })

    const router = await createRouter(['/'])

    render(<RouterProvider router={router} />)

    // Viewer should NOT see the admin button
    expect(screen.queryByRole('button', { name: /open admin panel/i })).not.toBeInTheDocument()
  })
})
