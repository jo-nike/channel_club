import { render, screen, fireEvent } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import { ConnectionStatus } from './ConnectionStatus'

describe('ConnectionStatus', () => {
  test('shows Connected with green indicator', () => {
    render(<ConnectionStatus status="connected" />)

    // Status is shown via aria-label on the indicator
    expect(screen.getByRole('status', { name: 'Connected' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reconnect/i })).not.toBeInTheDocument()

    // Check for green indicator (bg-green-500)
    const indicator = document.querySelector('.bg-green-500')
    expect(indicator).toBeInTheDocument()
  })

  test('shows Connecting with yellow pulsing indicator', () => {
    render(<ConnectionStatus status="connecting" />)

    // Status is shown via aria-label on the indicator
    expect(screen.getByRole('status', { name: 'Connecting...' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reconnect/i })).not.toBeInTheDocument()

    // Check for yellow indicator
    const indicator = document.querySelector('.bg-yellow-500')
    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveClass('animate-pulse')
  })

  test('shows Reconnecting with yellow pulsing indicator', () => {
    render(<ConnectionStatus status="reconnecting" />)

    // Status is shown via aria-label on the indicator
    expect(screen.getByRole('status', { name: 'Reconnecting...' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reconnect/i })).not.toBeInTheDocument()

    // Check for yellow indicator with pulse
    const indicator = document.querySelector('.bg-yellow-500')
    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveClass('animate-pulse')
  })

  test('shows Disconnected with red indicator and reconnect button', () => {
    const onReconnect = vi.fn()
    render(<ConnectionStatus status="disconnected" onReconnect={onReconnect} />)

    // Status is shown via aria-label on the indicator
    expect(screen.getByRole('status', { name: 'Disconnected' })).toBeInTheDocument()

    // Check for red indicator (no pulse)
    const indicator = document.querySelector('.bg-red-500')
    expect(indicator).toBeInTheDocument()
    expect(indicator).not.toHaveClass('animate-pulse')

    // Check for reconnect button
    const button = screen.getByRole('button', { name: /reconnect/i })
    expect(button).toBeInTheDocument()
  })

  test('calls onReconnect when button is clicked', () => {
    const onReconnect = vi.fn()
    render(<ConnectionStatus status="disconnected" onReconnect={onReconnect} />)

    const button = screen.getByRole('button', { name: /reconnect/i })
    fireEvent.click(button)

    expect(onReconnect).toHaveBeenCalledTimes(1)
  })

  test('does not show reconnect button when no onReconnect provided', () => {
    render(<ConnectionStatus status="disconnected" />)

    // Status is shown via aria-label on the indicator
    expect(screen.getByRole('status', { name: 'Disconnected' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reconnect/i })).not.toBeInTheDocument()
  })

  test('does not show reconnect button for non-disconnected states', () => {
    const onReconnect = vi.fn()

    const { rerender } = render(<ConnectionStatus status="connected" onReconnect={onReconnect} />)
    expect(screen.queryByRole('button', { name: /reconnect/i })).not.toBeInTheDocument()

    rerender(<ConnectionStatus status="connecting" onReconnect={onReconnect} />)
    expect(screen.queryByRole('button', { name: /reconnect/i })).not.toBeInTheDocument()

    rerender(<ConnectionStatus status="reconnecting" onReconnect={onReconnect} />)
    expect(screen.queryByRole('button', { name: /reconnect/i })).not.toBeInTheDocument()
  })
})
