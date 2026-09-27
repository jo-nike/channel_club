import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/utils'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppErrorScreen } from './AppErrorScreen'
import { useAuthStore } from '@/stores/authStore'
import { useThemeStore } from '@/stores/themeStore'
import { logger } from '@/lib/logger'

const originalLocation = window.location
const originalLogout = useAuthStore.getState().logout

function Boom(): never {
  const error = new Error('EPG entry exploded')
  error.stack = 'Error: EPG entry exploded\n    at SecretComponent (src/components/SecretFile.tsx:12:7)'
  throw error
}

function renderThrowingRoute() {
  const router = createMemoryRouter(
    [{ path: '/', element: <Boom />, errorElement: <AppErrorScreen /> }],
    { initialEntries: ['/'] }
  )
  return render(<RouterProvider router={router} />)
}

describe('AppErrorScreen', () => {
  let reload: ReturnType<typeof vi.fn>
  let assign: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // React reports render errors to console.error; keep the output quiet.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    reload = vi.fn()
    assign = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, reload, assign },
      writable: true,
      configurable: true,
    })
    useThemeStore.setState(useThemeStore.getInitialState())
    document.documentElement.classList.remove('dark')
    document.documentElement.style.cssText = ''
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    })
    useAuthStore.setState({ logout: originalLogout })
    vi.restoreAllMocks()
  })

  it('shows a themed heading and the error message, never the stack', () => {
    renderThrowingRoute()

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.getByText('Channel Club hit an error. Reloading usually fixes it.')).toBeInTheDocument()
    expect(screen.getByText('EPG entry exploded')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('SecretFile.tsx')
    expect(document.body.textContent).not.toContain('Unexpected Application Error')
    // Themed even though App never mounted
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--background')).toContain('oklch')
  })

  it('shows the app icon as a rounded tile so its square background never shows hard corners', () => {
    const { container } = renderThrowingRoute()

    const logo = container.querySelector('img[src="/favicon.svg"]')
    expect(logo).not.toBeNull()
    expect(logo).toHaveAttribute('alt', '')
    expect(logo).toHaveClass('rounded-xl')
  })

  it('logs the error through the logger', () => {
    const logError = vi.spyOn(logger, 'error')

    renderThrowingRoute()

    expect(logError).toHaveBeenCalledWith(
      'App',
      'Unhandled route error',
      expect.objectContaining({ message: 'EPG entry exploded' })
    )
  })

  it('shows status and status text for a route error response', () => {
    const router = createMemoryRouter(
      [{ path: '/', element: <div />, errorElement: <AppErrorScreen /> }],
      { initialEntries: ['/missing'] }
    )
    render(<RouterProvider router={router} />)

    expect(screen.getByText('404 Not Found')).toBeInTheDocument()
  })

  it('focuses Reload and reloads the page when pressed', () => {
    renderThrowingRoute()

    const reloadButton = screen.getByRole('button', { name: 'Reload' })
    expect(reloadButton).toHaveFocus()
    fireEvent.click(reloadButton)

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('signs out and returns to the root when Sign out is pressed', () => {
    const logout = vi.fn()
    useAuthStore.setState({ logout })

    renderThrowingRoute()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(logout).toHaveBeenCalledTimes(1)
    expect(assign).toHaveBeenCalledWith('/')
  })
})
