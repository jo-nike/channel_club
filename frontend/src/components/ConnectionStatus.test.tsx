import { render, screen, fireEvent } from '@/test/utils'
import { describe, test, expect } from 'vitest'
import { ConnectionStatus } from './ConnectionStatus'

describe('ConnectionStatus', () => {
  test('shows Connected with green indicator', () => {
    render(<ConnectionStatus status="connected" />)

    // Status is shown via aria-label on the button
    expect(screen.getByRole('status', { name: /connected/i })).toBeInTheDocument()

    // Check for green indicator (bg-green-500)
    const indicator = document.querySelector('.bg-green-500')
    expect(indicator).toBeInTheDocument()
  })

  test('shows Connecting with yellow pulsing indicator', () => {
    render(<ConnectionStatus status="connecting" />)

    // Status is shown via aria-label on the button
    expect(screen.getByRole('status', { name: /connecting/i })).toBeInTheDocument()

    // Check for yellow indicator
    const indicator = document.querySelector('.bg-yellow-500')
    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveClass('animate-pulse')
  })

  test('shows Reconnecting with yellow pulsing indicator', () => {
    render(<ConnectionStatus status="reconnecting" />)

    // Status is shown via aria-label on the button
    expect(screen.getByRole('status', { name: /reconnecting/i })).toBeInTheDocument()

    // Check for yellow indicator with pulse
    const indicator = document.querySelector('.bg-yellow-500')
    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveClass('animate-pulse')
  })

  test('shows Disconnected with red indicator', () => {
    render(<ConnectionStatus status="disconnected" />)

    // Status is shown via aria-label on the button
    expect(screen.getByRole('status', { name: /disconnected/i })).toBeInTheDocument()

    // Check for red indicator (no pulse)
    const indicator = document.querySelector('.bg-red-500')
    expect(indicator).toBeInTheDocument()
    expect(indicator).not.toHaveClass('animate-pulse')
  })

  test('clicking hides indicator by changing to background color', () => {
    render(<ConnectionStatus status="connected" />)

    const button = screen.getByRole('status')

    // Initially shows green
    expect(button).toHaveClass('bg-green-500')
    expect(button).not.toHaveClass('bg-background')

    // Click to hide
    fireEvent.click(button)

    // Now shows background color
    expect(button).toHaveClass('bg-background')
    expect(button).not.toHaveClass('bg-green-500')
  })

  test('clicking twice restores indicator color', () => {
    render(<ConnectionStatus status="connected" />)

    const button = screen.getByRole('status')

    // Click to hide
    fireEvent.click(button)
    expect(button).toHaveClass('bg-background')

    // Click to show again
    fireEvent.click(button)
    expect(button).toHaveClass('bg-green-500')
  })

  test('hiding stops pulse animation', () => {
    render(<ConnectionStatus status="connecting" />)

    const button = screen.getByRole('status')

    // Initially pulsing
    expect(button).toHaveClass('animate-pulse')

    // Click to hide
    fireEvent.click(button)

    // No longer pulsing
    expect(button).not.toHaveClass('animate-pulse')
  })

  test('aria-label updates when hidden', () => {
    render(<ConnectionStatus status="connected" />)

    const button = screen.getByRole('status')

    // Initially shows "click to hide"
    expect(button).toHaveAttribute('aria-label', 'Connected (click to hide)')

    // Click to hide
    fireEvent.click(button)

    // Now shows "click to show"
    expect(button).toHaveAttribute('aria-label', 'Connected (hidden - click to show)')
  })
})

it('FE-10 exposes a visible reconnect action while disconnected', () => {
  const reconnect = vi.fn()
  render(<ConnectionStatus status="disconnected" onReconnect={reconnect} />)
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
  expect(reconnect).toHaveBeenCalledTimes(1)
})
