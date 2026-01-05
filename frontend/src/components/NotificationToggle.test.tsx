import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NotificationToggle } from './NotificationToggle'
import { useUIStore } from '@/stores/uiStore'

describe('NotificationToggle', () => {
  beforeEach(() => {
    // Reset store to initial state
    useUIStore.setState({
      notificationsEnabled: false,
    })
  })

  describe('rendering', () => {
    it('should render the notification toggle button', () => {
      render(<NotificationToggle />)

      const button = screen.getByRole('button', { name: /notifications/i })
      expect(button).toBeInTheDocument()
    })

    it('should have accessible label when disabled', () => {
      render(<NotificationToggle />)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-label', 'Enable live channel notifications')
      expect(button).toHaveAttribute('aria-pressed', 'false')
    })

    it('should have accessible label when enabled', () => {
      useUIStore.setState({ notificationsEnabled: true })
      render(<NotificationToggle />)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-label', 'Disable live channel notifications')
      expect(button).toHaveAttribute('aria-pressed', 'true')
    })
  })

  describe('toggle interaction', () => {
    it('should toggle notifications from disabled to enabled on click', () => {
      render(<NotificationToggle />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(useUIStore.getState().notificationsEnabled).toBe(true)
    })

    it('should toggle notifications from enabled to disabled on click', () => {
      useUIStore.setState({ notificationsEnabled: true })
      render(<NotificationToggle />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(useUIStore.getState().notificationsEnabled).toBe(false)
    })
  })

  describe('styling', () => {
    it('should have secondary styling when notifications disabled', () => {
      render(<NotificationToggle />)

      const button = screen.getByRole('button')
      expect(button.className).toContain('bg-secondary')
    })

    it('should have primary styling when notifications enabled', () => {
      useUIStore.setState({ notificationsEnabled: true })
      render(<NotificationToggle />)

      const button = screen.getByRole('button')
      expect(button.className).toContain('bg-primary')
    })
  })
})
