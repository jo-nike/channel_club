import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { OfflineFallback } from './OfflineFallback'

describe('OfflineFallback', () => {
  const originalNavigator = window.navigator

  beforeEach(() => {
    // Reset navigator.onLine mock
    Object.defineProperty(window, 'navigator', {
      value: { ...originalNavigator, onLine: true },
      writable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'navigator', {
      value: originalNavigator,
      writable: true,
    })
  })

  it('should not render when online', () => {
    Object.defineProperty(window.navigator, 'onLine', {
      value: true,
      writable: true,
    })

    const { container } = render(<OfflineFallback />)
    expect(container.firstChild).toBeNull()
  })

  it('should render offline message when offline', () => {
    Object.defineProperty(window.navigator, 'onLine', {
      value: false,
      writable: true,
    })

    render(<OfflineFallback />)

    expect(screen.getByText('Network Unavailable')).toBeInTheDocument()
    expect(screen.getByText('Please check your connection')).toBeInTheDocument()
  })

  it('should render retry button when offline', () => {
    Object.defineProperty(window.navigator, 'onLine', {
      value: false,
      writable: true,
    })

    render(<OfflineFallback />)

    const retryButton = screen.getByRole('button', { name: /retry/i })
    expect(retryButton).toBeInTheDocument()
  })

  it('should reload page when retry button is clicked', () => {
    Object.defineProperty(window.navigator, 'onLine', {
      value: false,
      writable: true,
    })

    const reloadMock = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { reload: reloadMock },
      writable: true,
    })

    render(<OfflineFallback />)

    const retryButton = screen.getByRole('button', { name: /retry/i })
    fireEvent.click(retryButton)

    expect(reloadMock).toHaveBeenCalled()
  })

  it('should show component when going offline', async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      value: true,
      writable: true,
    })

    const { container } = render(<OfflineFallback />)
    expect(container.firstChild).toBeNull()

    // Simulate going offline
    Object.defineProperty(window.navigator, 'onLine', {
      value: false,
      writable: true,
    })

    await act(async () => {
      window.dispatchEvent(new Event('offline'))
    })

    // Component should now be visible
    expect(screen.getByText('Network Unavailable')).toBeInTheDocument()
  })

  it('should hide component when going online', async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      value: false,
      writable: true,
    })

    render(<OfflineFallback />)
    expect(screen.getByText('Network Unavailable')).toBeInTheDocument()

    // Simulate going online
    Object.defineProperty(window.navigator, 'onLine', {
      value: true,
      writable: true,
    })

    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })

    // Wait for state update - component should disappear
    await waitFor(() => {
      expect(screen.queryByText('Network Unavailable')).not.toBeInTheDocument()
    })
  })
})
