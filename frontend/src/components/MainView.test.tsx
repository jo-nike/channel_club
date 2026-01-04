import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MainView } from './MainView'
import { useAuthStore } from '@/stores/authStore'
import { useChannelStore } from '@/stores/channelStore'
import { useUIStore } from '@/stores/uiStore'
import * as api from '@/services/api'

vi.mock('@/services/api', () => ({
  fetchChannels: vi.fn(),
  fetchNowPlaying: vi.fn(),
}))

// Helper to render MainView with router context
const renderWithRouter = (ui: React.ReactElement = <MainView />) => {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

// Helper to mock window width for responsive tests
const mockWindowWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  })
  window.dispatchEvent(new Event('resize'))
}

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
  const originalInnerWidth = window.innerWidth

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

    useUIStore.setState({
      isTheaterMode: false,
      isSidebarOpen: false,
    })

    // Mock fetchChannels to return empty array by default
    vi.mocked(api.fetchChannels).mockResolvedValue([])

    // Default to desktop viewport for most tests
    mockWindowWidth(1200)
  })

  afterEach(() => {
    // Restore original width
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    })
    // Clean up tv-mode class from body
    document.body.classList.remove('tv-mode')
  })

  describe('layout', () => {
    it('should render header with connection status and logout button', () => {
      renderWithRouter()

      // Header contains connection status and logout button
      expect(screen.getByRole('status')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /logout/i })).toBeInTheDocument()
    })

    it('should render logout button', () => {
      renderWithRouter()

      expect(screen.getByRole('button', { name: /logout/i })).toBeInTheDocument()
    })

    it('should render video player area', () => {
      renderWithRouter()

      // VideoPlayer shows placeholder when no channel selected
      // Note: "No channel selected" appears in both header and video player area
      expect(screen.getAllByText(/no channel selected/i).length).toBeGreaterThanOrEqual(1)
    })

    it('should display "No channel selected" in header when no channel is selected', () => {
      useChannelStore.setState({ currentChannel: null })
      renderWithRouter()

      // Header should show "No channel selected"
      const headerChannelTexts = screen.getAllByText(/no channel selected/i)
      expect(headerChannelTexts.length).toBeGreaterThanOrEqual(1)
    })

    it('should display current channel name in header when channel is selected', () => {
      vi.mocked(api.fetchNowPlaying).mockResolvedValue({ channelId: '1', currentProgram: null })
      useChannelStore.setState({
        currentChannel: { id: '1', name: 'Test Channel', streamUrl: 'http://test.com/stream.m3u8', guideId: '1' },
      })
      renderWithRouter()

      expect(screen.getByText('Test Channel')).toBeInTheDocument()
    })

    it('should display channel name with EPG program title when available', async () => {
      vi.mocked(api.fetchNowPlaying).mockResolvedValue({
        channelId: '1',
        currentProgram: {
          title: 'Morning News',
          startTime: '2025-01-01T08:00:00Z',
          endTime: '2025-01-01T09:00:00Z',
        },
      })
      useChannelStore.setState({
        currentChannel: { id: '1', name: 'CNN', streamUrl: 'http://test.com/stream.m3u8', guideId: '1' },
      })
      renderWithRouter()

      // Wait for EPG data to load and display
      await screen.findByText('CNN - Morning News')
    })

    it('should display only channel name when EPG returns no current program', async () => {
      vi.mocked(api.fetchNowPlaying).mockResolvedValue({
        channelId: '1',
        currentProgram: null,
      })
      useChannelStore.setState({
        currentChannel: { id: '1', name: 'ESPN', streamUrl: 'http://test.com/stream.m3u8', guideId: '1' },
      })
      renderWithRouter()

      // Should show only channel name when no program data
      expect(screen.getByText('ESPN')).toBeInTheDocument()
    })

    it('should display only channel name when EPG fetch fails', async () => {
      vi.mocked(api.fetchNowPlaying).mockRejectedValue(new Error('Failed to fetch'))
      useChannelStore.setState({
        currentChannel: { id: '1', name: 'BBC', streamUrl: 'http://test.com/stream.m3u8', guideId: '1' },
      })
      renderWithRouter()

      // Should gracefully show only channel name on error (no error displayed)
      expect(screen.getByText('BBC')).toBeInTheDocument()
    })

    it('should have compact header padding', () => {
      renderWithRouter()

      const header = document.querySelector('header')
      expect(header).not.toBeNull()
      // Header uses px-4 py-2 for horizontal/vertical padding
      expect(header!.className).toContain('px-4')
      expect(header!.className).toContain('py-2')
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

    describe('admin button and modal (Story 11-3)', () => {
      it('should show admin button with Settings icon for admin users (AC: #1)', () => {
        renderWithRouter()

        // Admin should see a button to open admin panel
        expect(screen.getByRole('button', { name: /open admin panel/i })).toBeInTheDocument()
      })

      it('should open AdminModal when admin button is clicked (AC: #1)', () => {
        renderWithRouter()

        const adminButton = screen.getByRole('button', { name: /open admin panel/i })
        fireEvent.click(adminButton)

        // AdminModal should be visible with its dialog role
        expect(screen.getByRole('dialog', { name: /admin/i })).toBeInTheDocument()
      })

      it('should NOT show sidebar drawer or hamburger menu (AC: #1)', () => {
        renderWithRouter()

        // Old sidebar drawer elements should not exist
        expect(screen.queryByRole('button', { name: /open channel list/i })).not.toBeInTheDocument()
        expect(document.querySelector('aside[aria-label="Channel list"]')).toBeNull()
      })

      it('should NOT show mobile FAB button', () => {
        mockWindowWidth(500) // Mobile viewport
        renderWithRouter()

        // No FAB for channel list should exist
        const fabButton = document.querySelector('.fixed.bottom-6.right-6')
        expect(fabButton).toBeNull()
      })
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

    it('should still show video player area for viewers', () => {
      renderWithRouter()

      // VideoPlayer shows placeholder when no channel selected
      // Note: "No channel selected" appears in both header and video player area
      expect(screen.getAllByText(/no channel selected/i).length).toBeGreaterThanOrEqual(1)
    })

    describe('admin button hidden for viewers (Story 11-3 AC: #2)', () => {
      it('should NOT show admin button for viewers', () => {
        mockWindowWidth(1200)
        renderWithRouter()

        // Viewer should NOT see the admin button
        expect(screen.queryByRole('button', { name: /open admin panel/i })).not.toBeInTheDocument()
      })
    })

    describe('channel list hidden for viewers (AC: #1, #3)', () => {
      it('should NOT show channel list sidebar on desktop for viewers', () => {
        mockWindowWidth(1200)
        renderWithRouter()

        // Viewer should NOT see the channel selection sidebar content
        // Note: "Movie Channels" link is visible for navigation, but channel list is hidden
        expect(screen.queryByText(/channel selection/i)).not.toBeInTheDocument()
        expect(screen.queryByText(/no channels available/i)).not.toBeInTheDocument()
      })

      it('should NOT show hamburger menu button for viewers on tablet', () => {
        mockWindowWidth(900)
        renderWithRouter()

        // Viewer should NOT see the menu button
        expect(screen.queryByRole('button', { name: /open channel list/i })).not.toBeInTheDocument()
      })

      it('should NOT show hamburger menu button for viewers on mobile', () => {
        mockWindowWidth(500)
        renderWithRouter()

        // Viewer should NOT see any menu buttons (header or FAB)
        expect(screen.queryByRole('button', { name: /open channel list/i })).not.toBeInTheDocument()
      })

      it('should NOT show mobile FAB for viewers', () => {
        mockWindowWidth(500)
        renderWithRouter()

        // Viewer should NOT see the FAB
        expect(screen.queryByRole('button', { name: /open channel list/i })).not.toBeInTheDocument()
      })

      it('should NOT render sidebar overlay for viewers on tablet', () => {
        mockWindowWidth(900)
        renderWithRouter()

        // No sidebar drawer should exist for viewers
        expect(document.querySelector('aside[aria-label="Channel list"]')).toBeNull()
      })

      it('should NOT render sidebar overlay for viewers on mobile', () => {
        mockWindowWidth(500)
        renderWithRouter()

        // No sidebar drawer should exist for viewers
        expect(document.querySelector('aside[aria-label="Channel list"]')).toBeNull()
      })
    })

    describe('full-width video for viewers (AC: #2)', () => {
      it('should have video take full width on desktop when sidebar hidden', () => {
        mockWindowWidth(1200)
        renderWithRouter()

        // Video container should have flex-1 and no sidebar reducing its width
        const mainContent = document.querySelector('main')
        expect(mainContent).not.toBeNull()

        // No sidebar should exist
        const desktopSidebar = mainContent!.querySelector('aside')
        expect(desktopSidebar).toBeNull()
      })
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

      renderWithRouter()

      fireEvent.click(screen.getByRole('button', { name: /logout/i }))

      expect(logoutSpy).toHaveBeenCalled()
    })
  })

  describe('10-foot UI compliance', () => {
    it('should have minimum height logout button for touch targets', () => {
      renderWithRouter()

      const logoutButton = screen.getByRole('button', { name: /logout/i })
      // Button has h-8 class (32px height) for compact header design
      expect(logoutButton.className).toContain('h-8')
    })

    it('should have visible focus state on logout button', () => {
      renderWithRouter()

      const logoutButton = screen.getByRole('button', { name: /logout/i })
      // Button should have focus-visible styling
      expect(logoutButton.className).toContain('focus')
    })

    describe('logout button text overflow fix (Story 6-6)', () => {
      it('should have whitespace-nowrap to prevent text wrapping (AC: #1, #2)', () => {
        renderWithRouter()

        const logoutButton = screen.getByRole('button', { name: /logout/i })
        expect(logoutButton.className).toContain('whitespace-nowrap')
      })

      it('should have shrink-0 to prevent flex shrinking (AC: #1, #2)', () => {
        renderWithRouter()

        const logoutButton = screen.getByRole('button', { name: /logout/i })
        expect(logoutButton.className).toContain('shrink-0')
      })

      it('should have consistent height styling (AC: #3)', () => {
        renderWithRouter()

        const logoutButton = screen.getByRole('button', { name: /logout/i })
        // Uses h-8 for compact header design
        expect(logoutButton.className).toContain('h-8')
      })

      it('should have consistent padding (AC: #4)', () => {
        mockWindowWidth(500) // Mobile viewport
        renderWithRouter()

        const logoutButton = screen.getByRole('button', { name: /logout/i })
        // Uses px-3 padding for compact design
        expect(logoutButton.className).toContain('px-3')
      })

      it('should have consistent text size (AC: #4)', () => {
        mockWindowWidth(500) // Mobile viewport
        renderWithRouter()

        const logoutButton = screen.getByRole('button', { name: /logout/i })
        // Uses text-sm for compact header
        expect(logoutButton.className).toContain('text-sm')
      })
    })

    it('should apply tv-mode class to body on large screens', () => {
      mockWindowWidth(1400) // Large screen triggers TV mode
      renderWithRouter()

      expect(document.body.classList.contains('tv-mode')).toBe(true)
    })

    it('should not apply tv-mode class to body on small screens', () => {
      mockWindowWidth(1000) // Small screen
      renderWithRouter()

      expect(document.body.classList.contains('tv-mode')).toBe(false)
    })

    it('should remove tv-mode class from body on component unmount', () => {
      mockWindowWidth(1400) // Large screen triggers TV mode
      const { unmount } = renderWithRouter()

      expect(document.body.classList.contains('tv-mode')).toBe(true)

      // Unmount the component
      unmount()

      // TV mode class should be removed on cleanup
      expect(document.body.classList.contains('tv-mode')).toBe(false)
    })
  })

  describe('responsive layout', () => {
    describe('desktop (>= 1024px)', () => {
      beforeEach(() => {
        mockWindowWidth(1200)
      })

      it('should show admin button on desktop for admin', () => {
        renderWithRouter()

        // Admin button should be visible on desktop for admin
        expect(screen.getByRole('button', { name: /open admin panel/i })).toBeInTheDocument()
      })

      it('should NOT show sidebar - uses modal instead', () => {
        renderWithRouter()

        // No sidebar drawer should exist - admin functionality is in modal
        const sidebar = document.querySelector('aside[aria-label="Channel list"]')
        expect(sidebar).toBeNull()
      })
    })

    describe('tablet (768px - 1023px)', () => {
      beforeEach(() => {
        mockWindowWidth(900)
      })

      it('should show admin button on tablet', () => {
        renderWithRouter()

        expect(screen.getByRole('button', { name: /open admin panel/i })).toBeInTheDocument()
      })

      it('should NOT have sidebar drawer on tablet', () => {
        renderWithRouter()

        // No sidebar drawer - modal is used instead
        const sidebar = document.querySelector('aside[aria-label="Channel list"]')
        expect(sidebar).toBeNull()
      })
    })

    describe('mobile (< 768px)', () => {
      beforeEach(() => {
        mockWindowWidth(500)
      })

      it('should show admin button on mobile for admin', () => {
        renderWithRouter()

        // Admin button in header
        expect(screen.getByRole('button', { name: /open admin panel/i })).toBeInTheDocument()
      })

      it('should NOT show FAB - uses admin button in header instead', () => {
        renderWithRouter()

        // No FAB for channel list should exist
        const fabButton = document.querySelector('.fixed.bottom-6.right-6')
        expect(fabButton).toBeNull()
      })
    })

    describe('video container', () => {
      it('should render video player container in main area', () => {
        mockWindowWidth(1200)
        renderWithRouter()

        // Find the video player container (bg-black class in main area)
        const videoContainer = document.querySelector('main .bg-black')
        expect(videoContainer).not.toBeNull()
      })
    })
  })
})
