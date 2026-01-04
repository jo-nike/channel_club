import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useChannelStore } from '@/stores/channelStore'
import { useUIStore } from '@/stores/uiStore'
import * as api from '@/services/api'

vi.mock('@/services/api', () => ({
  fetchChannels: vi.fn(),
  fetchNowPlaying: vi.fn(),
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

// Lazy imports to avoid circular dependencies
const createRouter = async (initialEntries: string[]) => {
  const { App } = await import('@/App')
  const { MainView } = await import('@/components/MainView')
  const { ErsatzTVView } = await import('@/components/ersatztv/ErsatzTVView')
  const { ProtectedRoute } = await import('@/components/ProtectedRoute')

  return createMemoryRouter(
    [
      {
        path: '/',
        element: <App />,
        children: [
          {
            index: true,
            element: (
              <ProtectedRoute>
                <MainView />
              </ProtectedRoute>
            ),
          },
          {
            path: 'ersatztv',
            element: (
              <ProtectedRoute>
                <ErsatzTVView />
              </ProtectedRoute>
            ),
          },
        ],
      },
    ],
    { initialEntries }
  )
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

  it('renders MainView at root path when authenticated', async () => {
    const router = await createRouter(['/'])

    render(<RouterProvider router={router} />)

    // MainView should be rendered - check for elements from MainView
    expect(screen.getByText('Logout')).toBeInTheDocument()
    // "No channel selected" appears multiple times (header and video player)
    expect(screen.getAllByText('No channel selected').length).toBeGreaterThanOrEqual(1)
  })

  it('renders ErsatzTVView at /ersatztv when authenticated', async () => {
    const router = await createRouter(['/ersatztv'])

    render(<RouterProvider router={router} />)

    // The ErsatzTVView should show the Movie Channels header and Live TV nav link
    expect(screen.getByText('Movie Channels')).toBeInTheDocument()
    expect(screen.getByText('Live TV')).toBeInTheDocument()
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

    // LoginForm should be displayed when not authenticated
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('shows login form for protected /ersatztv route when not authenticated', async () => {
    useAuthStore.setState({
      token: null,
      role: null,
      isAuthenticated: false,
      isInitializing: false,
    })

    const router = await createRouter(['/ersatztv'])

    render(<RouterProvider router={router} />)

    // LoginForm should be displayed
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.queryByText('Movie Channels')).not.toBeInTheDocument()
  })

  it('renders Movies link in MainView header', async () => {
    const router = await createRouter(['/'])

    render(<RouterProvider router={router} />)

    // Check for the navigation link - button text is "Movies" (short form)
    const link = screen.getByRole('link', { name: /movies/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/ersatztv')
  })
})
