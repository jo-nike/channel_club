import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MainView } from './MainView'
import { useAuthStore } from '@/stores/authStore'
import { useChannelStore } from '@/stores/channelStore'
import { useUIStore } from '@/stores/uiStore'
import * as api from '@/services/api'

vi.mock('@/services/api', () => ({
  fetchChannels: vi.fn(),
}))

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

    it('should apply tv-mode class to body on large screens', () => {
      mockWindowWidth(1400) // Large screen triggers TV mode
      render(<MainView />)

      expect(document.body.classList.contains('tv-mode')).toBe(true)
    })

    it('should not apply tv-mode class to body on small screens', () => {
      mockWindowWidth(1000) // Small screen
      render(<MainView />)

      expect(document.body.classList.contains('tv-mode')).toBe(false)
    })

    it('should remove tv-mode class from body on component unmount', () => {
      mockWindowWidth(1400) // Large screen triggers TV mode
      const { unmount } = render(<MainView />)

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

      it('should show sidebar on desktop without menu button', () => {
        render(<MainView />)

        // Sidebar should be visible
        expect(screen.getByRole('heading', { name: /channel selection/i })).toBeInTheDocument()

        // Menu button should NOT be visible on desktop
        expect(screen.queryByRole('button', { name: /open channel list/i })).not.toBeInTheDocument()
      })

      it('should show full IPTV Viewer heading text on desktop', () => {
        render(<MainView />)

        expect(screen.getByRole('heading', { name: /iptv viewer/i })).toBeInTheDocument()
      })
    })

    describe('tablet (768px - 1023px)', () => {
      beforeEach(() => {
        mockWindowWidth(900)
      })

      it('should show menu button on tablet', () => {
        render(<MainView />)

        expect(screen.getByRole('button', { name: /open channel list/i })).toBeInTheDocument()
      })

      it('should hide inline sidebar on tablet', () => {
        render(<MainView />)

        // The inline sidebar should not be visible (drawer is hidden by default)
        // The sidebar drawer exists but is translated off-screen
        const sidebar = document.querySelector('aside[aria-label="Channel list"]')
        expect(sidebar).not.toBeNull()
        expect(sidebar!.className).toContain('translate-x-full')
      })

      it('should open sidebar drawer when menu button clicked', () => {
        render(<MainView />)

        const menuButton = screen.getByRole('button', { name: /open channel list/i })
        fireEvent.click(menuButton)

        // Sidebar should now be visible (translated to 0)
        const sidebar = document.querySelector('aside[aria-label="Channel list"]')
        expect(sidebar).not.toBeNull()
        expect(sidebar!.className).toContain('translate-x-0')
      })

      it('should close sidebar when close button clicked', () => {
        useUIStore.setState({ isSidebarOpen: true })
        render(<MainView />)

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
        render(<MainView />)

        // On mobile, there should be at least one menu button (header or FAB)
        const menuButtons = screen.getAllByRole('button', { name: /open channel list/i })
        expect(menuButtons.length).toBeGreaterThanOrEqual(1)
      })

      it('should show FAB (floating action button) on mobile when sidebar closed', () => {
        render(<MainView />)

        // FAB should be visible - it's a different button than the header menu button
        const fabButtons = screen.getAllByRole('button', { name: /open channel list/i })
        expect(fabButtons.length).toBe(2) // Header menu button + FAB
      })

      it('should hide FAB when sidebar is open', () => {
        useUIStore.setState({ isSidebarOpen: true })
        render(<MainView />)

        // FAB should be hidden when sidebar is open, but header menu button remains
        // Header has menu button, but FAB should not render
        const openButtons = screen.queryAllByRole('button', { name: /open channel list/i })
        // Only header menu button should remain, not the FAB (FAB is hidden when sidebar open)
        expect(openButtons.length).toBe(1)
      })

      it('should show full-width sidebar drawer on mobile', () => {
        useUIStore.setState({ isSidebarOpen: true })
        render(<MainView />)

        const sidebar = document.querySelector('aside[aria-label="Channel list"]')
        expect(sidebar).not.toBeNull()
        expect(sidebar!.className).toContain('w-full')
      })

      it('should have visually hidden heading text with md:block class on mobile', () => {
        render(<MainView />)

        // The h1 heading exists but should have hidden class on mobile (md:block means visible from md up)
        const heading = screen.getByRole('heading', { name: /iptv viewer/i })
        expect(heading.className).toContain('hidden')
        expect(heading.className).toContain('md:block')
      })
    })

    describe('sidebar interactions', () => {
      beforeEach(() => {
        mockWindowWidth(900) // Tablet
      })

      it('should close sidebar when Escape key is pressed', () => {
        useUIStore.setState({ isSidebarOpen: true })
        render(<MainView />)

        fireEvent.keyDown(window, { key: 'Escape' })

        const sidebar = document.querySelector('aside[aria-label="Channel list"]')
        expect(sidebar).not.toBeNull()
        expect(sidebar!.className).toContain('translate-x-full')
      })

      it('should close sidebar when backdrop is clicked', () => {
        useUIStore.setState({ isSidebarOpen: true })
        render(<MainView />)

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
        render(<MainView />)

        // Find the aspect-video container
        const aspectContainer = document.querySelector('.aspect-video')
        expect(aspectContainer).not.toBeNull()
      })
    })
  })
})
