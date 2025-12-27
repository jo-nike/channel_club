import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MainView } from './MainView'
import { useAuthStore } from '@/stores/authStore'
import { useChannelStore } from '@/stores/channelStore'
import * as api from '@/services/api'

vi.mock('@/services/api', () => ({
  fetchChannels: vi.fn(),
}))

// Mock Vidstack web components for MainView tests
beforeEach(() => {
  // Define custom elements if not already defined
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

describe('MainView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Create a valid JWT token
    const payload = { exp: Math.floor(Date.now() / 1000) + 3600 }
    const token = `header.${btoa(JSON.stringify(payload))}.signature`

    useAuthStore.setState({
      token,
      role: 'admin',
      isAuthenticated: true,
    })

    useChannelStore.setState({
      channels: [],
      currentChannel: null,
      isLoading: false,
      error: null,
    })

    // Mock fetchChannels to return empty array by default
    vi.mocked(api.fetchChannels).mockResolvedValue([])
  })

  describe('layout', () => {
    it('should render IPTV Viewer heading', () => {
      render(<MainView />)

      expect(screen.getByRole('heading', { name: /iptv viewer/i })).toBeInTheDocument()
    })

    it('should render logout button', () => {
      render(<MainView />)

      expect(screen.getByRole('button', { name: /logout/i })).toBeInTheDocument()
    })

    it('should render video player area', () => {
      render(<MainView />)

      // VideoPlayer shows placeholder when no channel selected
      expect(screen.getByText(/no channel selected/i)).toBeInTheDocument()
    })
  })

  describe('admin role', () => {
    beforeEach(() => {
      const payload = { exp: Math.floor(Date.now() / 1000) + 3600 }
      const token = `header.${btoa(JSON.stringify(payload))}.signature`

      useAuthStore.setState({
        token,
        role: 'admin',
        isAuthenticated: true,
      })
    })

    it('should show AdminControls for admin users', () => {
      render(<MainView />)

      expect(screen.getByText(/channel selection/i)).toBeInTheDocument()
    })
  })

  describe('viewer role', () => {
    beforeEach(() => {
      const payload = { exp: Math.floor(Date.now() / 1000) + 3600 }
      const token = `header.${btoa(JSON.stringify(payload))}.signature`

      useAuthStore.setState({
        token,
        role: 'viewer',
        isAuthenticated: true,
      })
    })

    it('should show Channels heading (not Channel Selection) for viewer users', () => {
      render(<MainView />)

      // Viewer sees "Channels" heading, not "Channel Selection"
      expect(screen.getByText('Channels')).toBeInTheDocument()
      expect(screen.queryByText(/channel selection/i)).not.toBeInTheDocument()
    })

    it('should still show video player area for viewers', () => {
      render(<MainView />)

      // VideoPlayer shows placeholder when no channel selected
      expect(screen.getByText(/no channel selected/i)).toBeInTheDocument()
    })

    it('should show channel list for viewers', () => {
      render(<MainView />)

      // ChannelList is rendered (showing empty state since we mock empty channels)
      expect(screen.getByText(/no channels available/i)).toBeInTheDocument()
    })
  })

  describe('logout functionality', () => {
    it('should call logout when logout button is clicked', () => {
      const logoutSpy = vi.fn()
      const payload = { exp: Math.floor(Date.now() / 1000) + 3600 }
      const token = `header.${btoa(JSON.stringify(payload))}.signature`

      useAuthStore.setState({
        token,
        role: 'admin',
        isAuthenticated: true,
        logout: logoutSpy,
      })

      render(<MainView />)

      fireEvent.click(screen.getByRole('button', { name: /logout/i }))

      expect(logoutSpy).toHaveBeenCalled()
    })
  })

  describe('10-foot UI compliance', () => {
    it('should have minimum height logout button for touch targets', () => {
      render(<MainView />)

      const logoutButton = screen.getByRole('button', { name: /logout/i })
      // Button should have h-12 class (48px height for 10-foot UI)
      expect(logoutButton.className).toContain('h-12')
    })

    it('should have visible focus state on logout button', () => {
      render(<MainView />)

      const logoutButton = screen.getByRole('button', { name: /logout/i })
      // Button should have focus-visible styling
      expect(logoutButton.className).toContain('focus')
    })
  })
})
