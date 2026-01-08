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
    render(<ChatToggleButton isVisible={true} />)
    expect(screen.getByRole('button', { name: 'Open chat' })).toBeInTheDocument()
  })

  it('does not render when chat is disabled', () => {
    vi.mocked(useChatEnabled).mockReturnValue(false)
    render(<ChatToggleButton isVisible={true} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('toggles chat on click', () => {
    render(<ChatToggleButton isVisible={true} />)
    const button = screen.getByRole('button', { name: 'Open chat' })

    fireEvent.click(button)

    expect(useChatStore.getState().isOpen).toBe(true)
  })

  it('shows unread badge when there are unread messages', () => {
    useChatStore.setState({ unreadCount: 5 })
    render(<ChatToggleButton isVisible={true} />)

    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('shows 9+ when unread count exceeds 9', () => {
    useChatStore.setState({ unreadCount: 15 })
    render(<ChatToggleButton isVisible={true} />)

    expect(screen.getByText('9+')).toBeInTheDocument()
  })

  it('does not show badge when no unread messages', () => {
    useChatStore.setState({ unreadCount: 0 })
    render(<ChatToggleButton isVisible={true} />)

    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('has correct aria label with unread count', () => {
    useChatStore.setState({ unreadCount: 3 })
    render(<ChatToggleButton isVisible={true} />)

    expect(
      screen.getByRole('button', { name: 'Open chat (3 new)' })
    ).toBeInTheDocument()
  })

  it('sets tabIndex based on isVisible', () => {
    const { rerender } = render(<ChatToggleButton isVisible={true} />)
    expect(screen.getByRole('button')).toHaveAttribute('tabIndex', '0')

    rerender(<ChatToggleButton isVisible={false} />)
    expect(screen.getByRole('button')).toHaveAttribute('tabIndex', '-1')
  })
})
