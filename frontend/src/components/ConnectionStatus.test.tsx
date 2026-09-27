import { render, screen, fireEvent, act, within } from '@/test/utils'
import { describe, test, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ConnectionStatus } from './ConnectionStatus'

type Status = 'connected' | 'connecting' | 'reconnecting' | 'disconnected'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
// The live region is always mounted; "shows nothing" means it's empty
const region = () => screen.getByRole('status')

describe('ConnectionStatus', () => {
  test('shows nothing while connected, however long it lasts', () => {
    render(<ConnectionStatus status="connected" onReconnect={vi.fn()} />)
    advance(10_000)
    expect(region()).toBeEmptyDOMElement()
    // Kept out of the layout, so the header has no gap for it
    expect(region()).toHaveClass('sr-only')
  })

  test.each<Status>(['connecting', 'reconnecting', 'disconnected'])('shows nothing for the first 3s of %s', (status) => {
    render(<ConnectionStatus status={status} onReconnect={vi.fn()} />)
    advance(2999)
    expect(region()).toBeEmptyDOMElement()
    advance(1)
    expect(region()).not.toBeEmptyDOMElement()
    expect(region()).not.toHaveClass('sr-only')
  })

  test('keeps one live region mounted, so the message is announced when it goes in', () => {
    const { rerender } = render(<ConnectionStatus status="connected" onReconnect={vi.fn()} />)
    const live = region()
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live).toBeEmptyDOMElement()

    rerender(<ConnectionStatus status="disconnected" onReconnect={vi.fn()} />)
    advance(3000)
    // The same element, now holding the message
    expect(region()).toBe(live)
    expect(live).toHaveTextContent('Chat offline')

    rerender(<ConnectionStatus status="connected" onReconnect={vi.fn()} />)
    expect(region()).toBe(live)
    expect(live).toBeEmptyDOMElement()
  })

  test('shows an amber Reconnecting pill once a reconnect has lasted 3s', () => {
    render(<ConnectionStatus status="reconnecting" onReconnect={vi.fn()} />)
    advance(3000)

    const pill = screen.getByText('Reconnecting...')
    expect(pill).toHaveClass('bg-warning/15', 'text-warning')
    // Pulses only when motion is allowed
    const dot = screen.getByTestId('connection-dot')
    expect(dot).toHaveClass('bg-warning', 'motion-safe:animate-pulse')
    expect(dot).not.toHaveClass('animate-pulse')
    // No Retry while it's still trying on its own
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  test('a blip that recovers within 3s never shows anything', () => {
    const { rerender } = render(<ConnectionStatus status="connected" />)
    rerender(<ConnectionStatus status="reconnecting" />)
    advance(2500)
    rerender(<ConnectionStatus status="connected" />)
    advance(10_000)
    expect(region()).toBeEmptyDOMElement()
  })

  test('the first connect after load reads as connecting, never as offline', () => {
    // useWebSocket starts at 'disconnected' and moves to 'connecting' in an effect
    const { rerender } = render(<ConnectionStatus status="disconnected" onReconnect={vi.fn()} />)
    rerender(<ConnectionStatus status="connecting" onReconnect={vi.fn()} />)
    advance(2999)
    expect(region()).toBeEmptyDOMElement()
    advance(1)
    expect(screen.getByText('Connecting...')).toHaveClass('text-warning')
    expect(screen.queryByText('Chat offline')).toBeNull()
  })

  test('moving between degraded states neither restarts the delay nor hides the pill', () => {
    const { rerender } = render(<ConnectionStatus status="connected" />)
    rerender(<ConnectionStatus status="reconnecting" />)
    advance(2000)
    rerender(<ConnectionStatus status="connecting" />)
    advance(1000)
    expect(screen.getByRole('status')).toHaveTextContent('Connecting...')
    rerender(<ConnectionStatus status="reconnecting" />)
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting...')
  })

  test('disconnected shows a red Chat offline pill with a Retry that reconnects', () => {
    const reconnect = vi.fn()
    render(<ConnectionStatus status="disconnected" onReconnect={reconnect} />)
    advance(3000)

    expect(screen.getByText('Chat offline')).toHaveClass('bg-destructive/15', 'text-destructive')
    expect(screen.getByTestId('connection-dot')).not.toHaveClass('motion-safe:animate-pulse')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(reconnect).toHaveBeenCalledTimes(1)
  })

  test('role=status sits on a wrapper, not on the Retry button', () => {
    render(<ConnectionStatus status="disconnected" onReconnect={vi.fn()} />)
    advance(3000)

    const region = screen.getByRole('status')
    expect(region.tagName).toBe('SPAN')
    expect(region).toHaveAttribute('aria-live', 'polite')
    const retry = within(region).getByRole('button', { name: 'Retry' })
    expect(retry).not.toHaveAttribute('role')
  })

  test('stays offline with Retry through slow reconnect attempts until connected', () => {
    const reconnect = vi.fn()
    const { rerender } = render(<ConnectionStatus status="connected" onReconnect={reconnect} />)
    // Fast retries, then the socket gives up
    rerender(<ConnectionStatus status="reconnecting" onReconnect={reconnect} />)
    advance(3000)
    rerender(<ConnectionStatus status="disconnected" onReconnect={reconnect} />)
    expect(screen.getByText('Chat offline')).toBeInTheDocument()

    // A slow attempt passes through 'reconnecting' and fails again
    rerender(<ConnectionStatus status="reconnecting" onReconnect={reconnect} />)
    expect(screen.getByText('Chat offline')).toBeInTheDocument()
    expect(screen.queryByText('Reconnecting...')).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    // The dot says an attempt is under way
    expect(screen.getByTestId('connection-dot')).toHaveClass('motion-safe:animate-pulse')
    rerender(<ConnectionStatus status="disconnected" onReconnect={reconnect} />)
    expect(screen.getByText('Chat offline')).toBeInTheDocument()

    // Back: gone at once, and a later drop starts amber again
    rerender(<ConnectionStatus status="connected" onReconnect={reconnect} />)
    expect(region()).toBeEmptyDOMElement()
    rerender(<ConnectionStatus status="reconnecting" onReconnect={reconnect} />)
    advance(3000)
    expect(screen.getByText('Reconnecting...')).toBeInTheDocument()
  })

  test('explains that only chat and live-channel sync are affected', async () => {
    render(<ConnectionStatus status="reconnecting" />)
    advance(3000)

    await act(async () => { screen.getByText('Reconnecting...').focus() })

    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Chat and live-channel sync are reconnecting. Video is not affected.'
    )
  })
})

it('FE-10 exposes a visible reconnect action while disconnected', () => {
  const reconnect = vi.fn()
  render(<ConnectionStatus status="disconnected" onReconnect={reconnect} />)
  advance(3000)
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(reconnect).toHaveBeenCalledTimes(1)
})
