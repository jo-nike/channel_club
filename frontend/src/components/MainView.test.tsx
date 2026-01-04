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

    it('should show AdminControls for admin users', () => {
      renderWithRouter()

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

    it('should still show video player area for viewers', () => {
      renderWithRouter()

      // VideoPlayer shows placeholder when no channel selected
      // Note: "No channel selected" appears in both header and video player area
      expect(screen.getAllByText(/no channel selected/i).length).toBeGreaterThanOrEqual(1)
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

      it('should show hamburger menu button on desktop for admin (AC: #1)', () => {
        renderWithRouter()

        // Menu button should be visible on desktop for admin
        expect(screen.getByRole('button', { name: /open channel list/i })).toBeInTheDocument()
      })

      it('should NOT show pinned sidebar on desktop (AC: #2)', () => {
        renderWithRouter()

        // No pinned sidebar in main content area - video takes full width
        const mainContent = document.querySelector('main')
        expect(mainContent).not.toBeNull()

        // No inline aside in main (sidebar is now only rendered as overlay)
        const inlineSidebar = mainContent!.querySelector('aside')
        expect(inlineSidebar).toBeNull()
      })

      it('should show drawer when hamburger menu clicked on desktop (AC: #3)', () => {
        renderWithRouter()

        const menuButton = screen.getByRole('button', { name: /open channel list/i })
        fireEvent.click(menuButton)

        // Sidebar drawer should be visible (translated to 0)
        const sidebar = document.querySelector('aside[aria-label="Channel list"]')
        expect(sidebar).not.toBeNull()
        expect(sidebar!.className).toContain('translate-x-0')
      })

      it('should show drawer with fixed width on desktop', () => {
        useUIStore.setState({ isSidebarOpen: true })
        renderWithRouter()

        const sidebar = document.querySelector('aside[aria-label="Channel list"]')
        expect(sidebar).not.toBeNull()
        // Desktop uses w-80 (not full width like mobile)
        expect(sidebar!.className).toContain('w-80')
        expect(sidebar!.className).not.toContain('w-full')
      })

      it('should show Channel Selection heading in sidebar drawer', () => {
        useUIStore.setState({ isSidebarOpen: true })
        renderWithRouter()

        expect(screen.getByRole('heading', { name: /channel selection/i })).toBeInTheDocument()
      })
    })

    describe('tablet (768px - 1023px)', () => {
      beforeEach(() => {
        mockWindowWidth(900)
      })

      it('should show menu button on tablet', () => {
        renderWithRouter()

        expect(screen.getByRole('button', { name: /open channel list/i })).toBeInTheDocument()
      })

      it('should hide inline sidebar on tablet', () => {
        renderWithRouter()

        // The inline sidebar should not be visible (drawer is hidden by default)
        // The sidebar drawer exists but is translated off-screen
        const sidebar = document.querySelector('aside[aria-label="Channel list"]')
        expect(sidebar).not.toBeNull()
        expect(sidebar!.className).toContain('translate-x-full')
      })

      it('should open sidebar drawer when menu button clicked', () => {
        renderWithRouter()

        const menuButton = screen.getByRole('button', { name: /open channel list/i })
        fireEvent.click(menuButton)

        // Sidebar should now be visible (translated to 0)
        const sidebar = document.querySelector('aside[aria-label="Channel list"]')
        expect(sidebar).not.toBeNull()
        expect(sidebar!.className).toContain('translate-x-0')
      })

      it('should close sidebar when close button clicked', () => {
        useUIStore.setState({ isSidebarOpen: true })
        renderWithRouter()

        const closeButton = screen.getByRole('button', { name: /close channel list/i })
        fireEvent.click(closeButton)

        const sidebar = document.querySelector('aside[aria-label="Channel list"]')
        expect(sidebar).not.toBeNull()
        expect(sidebar!.className).toContain('translate-x-full')
      })
    })

    describe('mobile (< 768px)', () => {
      beforeEach(() => {
        mockWindowWidth(500)
      })

      it('should show menu button on mobile', () => {
        renderWithRouter()

        // On mobile, there should be at least one menu button (header or FAB)
        const menuButtons = screen.getAllByRole('button', { name: /open channel list/i })
        expect(menuButtons.length).toBeGreaterThanOrEqual(1)
      })

      it('should show FAB (floating action button) on mobile when sidebar closed', () => {
        renderWithRouter()

        // FAB should be visible - it's a different button than the header menu button
        const fabButtons = screen.getAllByRole('button', { name: /open channel list/i })
        expect(fabButtons.length).toBe(2) // Header menu button + FAB
      })

      it('should hide FAB when sidebar is open', () => {
        useUIStore.setState({ isSidebarOpen: true })
        renderWithRouter()

        // FAB should be hidden when sidebar is open, but header menu button remains
        // Header has menu button, but FAB should not render
        const openButtons = screen.queryAllByRole('button', { name: /open channel list/i })
        // Only header menu button should remain, not the FAB (FAB is hidden when sidebar open)
        expect(openButtons.length).toBe(1)
      })

      it('should show full-width sidebar drawer on mobile', () => {
        useUIStore.setState({ isSidebarOpen: true })
        renderWithRouter()

        const sidebar = document.querySelector('aside[aria-label="Channel list"]')
        expect(sidebar).not.toBeNull()
        expect(sidebar!.className).toContain('w-full')
      })

      it('should show Channel Selection heading in full-width drawer on mobile', () => {
        useUIStore.setState({ isSidebarOpen: true })
        renderWithRouter()

        // The sidebar drawer heading should be visible when drawer is open
        const heading = screen.getByRole('heading', { name: /channel selection/i })
        expect(heading).toBeInTheDocument()
      })
    })

    describe('sidebar interactions', () => {
      beforeEach(() => {
        mockWindowWidth(900) // Tablet
      })

      it('should close sidebar when Escape key is pressed', () => {
        useUIStore.setState({ isSidebarOpen: true })
        renderWithRouter()

        fireEvent.keyDown(window, { key: 'Escape' })

        const sidebar = document.querySelector('aside[aria-label="Channel list"]')
        expect(sidebar).not.toBeNull()
        expect(sidebar!.className).toContain('translate-x-full')
      })

      it('should close sidebar when backdrop is clicked', () => {
        useUIStore.setState({ isSidebarOpen: true })
        renderWithRouter()

        // Click the backdrop (the div with bg-black/50 class that's not the emoji)
        const backdrop = document.querySelector('.bg-black\\/50')
        expect(backdrop).not.toBeNull()
        fireEvent.click(backdrop!)

        const sidebar = document.querySelector('aside[aria-label="Channel list"]')
        expect(sidebar).not.toBeNull()
        expect(sidebar!.className).toContain('translate-x-full')
      })
    })

    describe('video aspect ratio', () => {
      it('should maintain aspect-video class for proper 16:9 ratio', () => {
        mockWindowWidth(1200)
        renderWithRouter()

        // Find the aspect-video container
        const aspectContainer = document.querySelector('.aspect-video')
        expect(aspectContainer).not.toBeNull()
      })
    })
  })
})
