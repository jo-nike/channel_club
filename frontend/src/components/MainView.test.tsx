import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MainView } from './MainView'
import { useAuthStore } from '@/stores/authStore'

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

    it('should render video player placeholder', () => {
      render(<MainView />)

      expect(screen.getByText(/video player/i)).toBeInTheDocument()
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

    it('should NOT show AdminControls for viewer users', () => {
      render(<MainView />)

      expect(screen.queryByText(/channel selection/i)).not.toBeInTheDocument()
    })

    it('should still show video player area for viewers', () => {
      render(<MainView />)

      expect(screen.getByText(/video player/i)).toBeInTheDocument()
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
