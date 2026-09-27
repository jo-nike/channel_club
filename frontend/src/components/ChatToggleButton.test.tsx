import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@/test/utils'
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
    expect(screen.getByRole('button', { name: 'Chat' })).toBeInTheDocument()
  })

  it('does not render when chat is disabled', () => {
    vi.mocked(useChatEnabled).mockReturnValue(false)
    render(<ChatToggleButton />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('toggles chat on click', () => {
    render(<ChatToggleButton />)
    const button = screen.getByRole('button', { name: 'Chat' })

    fireEvent.click(button)

    expect(useChatStore.getState().isOpen).toBe(true)
  })

  it('is a disclosure for the chat panel, not a pressed toggle', () => {
    render(<ChatToggleButton />)
    const button = screen.getByRole('button', { name: 'Chat' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveAttribute('aria-controls', 'chat-panel')
    expect(button).not.toHaveAttribute('aria-pressed')

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
  })

  it('is the filled primary header action, labelled Chat from lg', () => {
    render(<ChatToggleButton />)
    const button = screen.getByRole('button', { name: 'Chat' })
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

    const badge = screen.getByText('5')
    expect(badge).toHaveClass(
      'bg-destructive',
      'text-destructive-foreground',
      'dark:bg-[color-mix(in_oklab,var(--destructive)_60%,var(--background))]',
      'ring-2',
      'ring-background'
    )
    // Opaque: a translucent fill would composite with the amber button under it
    expect(badge.className).not.toMatch(/bg-destructive\//)
  })

  it('shows a ring while chat is open, so open and closed look different', () => {
    render(<ChatToggleButton />)
    const button = screen.getByRole('button', { name: 'Chat' })
    // The ring keys on aria-expanded, so it is only drawn in the open state
    expect(button).toHaveClass(
      'aria-expanded:ring-2',
      'aria-expanded:ring-primary',
      'aria-expanded:ring-offset-2',
      'aria-expanded:ring-offset-background'
    )
    expect(button).toHaveAttribute('aria-expanded', 'false')

    act(() => {
      useChatStore.setState({ isOpen: true })
    })
    expect(button).toHaveAttribute('aria-expanded', 'true')
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

  it('puts the unread count in its name', () => {
    useChatStore.setState({ unreadCount: 3 })
    render(<ChatToggleButton />)

    expect(
      screen.getByRole('button', { name: 'Chat, 3 new' })
    ).toBeInTheDocument()
  })

  it('keeps the name Chat while open, so it reads "Chat, expanded"', () => {
    render(<ChatToggleButton />)
    const button = screen.getByRole('button', { name: 'Chat' })

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).toHaveAccessibleName('Chat')
    expect(screen.queryByRole('button', { name: /open|close/i })).not.toBeInTheDocument()
  })

  it('gives its C shortcut in the tooltip and to assistive tech, like the player', async () => {
    useChatStore.setState({ unreadCount: 2 })
    render(<ChatToggleButton />)
    const button = screen.getByRole('button', { name: 'Chat, 2 new' })
    expect(button).toHaveAttribute('aria-keyshortcuts', 'C')

    await act(async () => {
      button.focus()
    })
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Chat, 2 new (C)')
    // The key hint is in the tooltip only, not the name
    expect(button).toHaveAccessibleName('Chat, 2 new')
  })
})
