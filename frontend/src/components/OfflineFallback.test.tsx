import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@/test/utils'
import { OfflineFallback } from './OfflineFallback'

const MESSAGE = "You're offline. Chat and the guide will catch up when you reconnect."

describe('OfflineFallback', () => {
  const originalNavigator = window.navigator

  const setOnline = (onLine: boolean) => {
    Object.defineProperty(window.navigator, 'onLine', { value: onLine, writable: true })
  }

  beforeEach(() => {
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

  it('renders nothing when online', () => {
    setOnline(true)
    const { container } = render(<OfflineFallback />)
    expect(container.firstChild).toBeNull()
  })

  it('shows a slim status bar across the top when offline', () => {
    setOnline(false)
    render(<OfflineFallback />)

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent(MESSAGE)
    // A bar pinned to the top, clear of the status bar, not a full-screen blocker
    expect(banner).toHaveClass('fixed', 'inset-x-0', 'top-0', 'pt-safe')
    expect(banner).not.toHaveClass('inset-0')
    expect(banner.firstElementChild).toHaveClass('min-h-8')
  })

  it("has no reload button: the app catches up by itself", () => {
    setOnline(false)
    render(<OfflineFallback />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('appears when the browser goes offline', async () => {
    setOnline(true)
    const { container } = render(<OfflineFallback />)
    expect(container.firstChild).toBeNull()

    setOnline(false)
    await act(async () => {
      window.dispatchEvent(new Event('offline'))
    })

    expect(screen.getByRole('status')).toHaveTextContent(MESSAGE)
  })

  it('hides when the browser comes back online', async () => {
    setOnline(false)
    render(<OfflineFallback />)
    expect(screen.getByRole('status')).toBeInTheDocument()

    setOnline(true)
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(MESSAGE)).toBeNull()
  })
})
