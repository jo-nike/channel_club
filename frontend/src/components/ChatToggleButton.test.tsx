import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
import { ChatToggleButton } from './ChatToggleButton'
import { useChatStore } from '@/stores/chatStore'
import { useChatEnabled } from '@/hooks/useChatEnabled'

vi.mock('@/hooks/useChatEnabled', () => ({
  useChatEnabled: vi.fn(),
}))

describe('ChatToggleButton', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      isOpen: false,
      unreadCount: 0,
    })
    vi.mocked(useChatEnabled).mockReturnValue(true)
  })

  it('renders when chat is enabled', () => {
    render(<ChatToggleButton />)
    expect(screen.getByRole('button', { name: 'Open chat' })).toBeInTheDocument()
  })

  it('does not render when chat is disabled', () => {
    vi.mocked(useChatEnabled).mockReturnValue(false)
    render(<ChatToggleButton />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('toggles chat on click', () => {
    render(<ChatToggleButton />)
    const button = screen.getByRole('button', { name: 'Open chat' })

    fireEvent.click(button)

    expect(useChatStore.getState().isOpen).toBe(true)
  })

  it('is a disclosure for the chat panel, not a pressed toggle', () => {
    render(<ChatToggleButton />)
    const button = screen.getByRole('button', { name: 'Open chat' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveAttribute('aria-controls', 'chat-panel')
    expect(button).not.toHaveAttribute('aria-pressed')

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
  })

  it('is the filled primary header action, labelled Chat from lg', () => {
    render(<ChatToggleButton />)
    const button = screen.getByRole('button', { name: 'Open chat' })
    expect(button).toHaveClass('bg-primary', 'text-primary-foreground')
    expect(button).toHaveAttribute('data-size', 'toolbar')
    expect(screen.getByText('Chat')).toHaveClass('hidden', 'lg:inline')
  })

  it('shows unread badge when there are unread messages', () => {
    useChatStore.setState({ unreadCount: 5 })
    render(<ChatToggleButton />)

    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('keeps the unread badge on destructive, dimmed in dark themes so white text passes', () => {
    useChatStore.setState({ unreadCount: 5 })
    render(<ChatToggleButton />)

    expect(screen.getByText('5')).toHaveClass(
      'bg-destructive',
      'text-destructive-foreground',
      'dark:bg-destructive/60'
    )
  })

  it('shows 9+ when unread count exceeds 9', () => {
    useChatStore.setState({ unreadCount: 15 })
    render(<ChatToggleButton />)

    expect(screen.getByText('9+')).toBeInTheDocument()
  })

  it('does not show badge when no unread messages', () => {
    useChatStore.setState({ unreadCount: 0 })
    render(<ChatToggleButton />)

    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('has correct aria label with unread count', () => {
    useChatStore.setState({ unreadCount: 3 })
    render(<ChatToggleButton />)

    expect(
      screen.getByRole('button', { name: 'Open chat (3 new)' })
    ).toBeInTheDocument()
  })
})
