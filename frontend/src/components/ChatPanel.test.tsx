import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@/test/utils'
import { ChatPanel } from './ChatPanel'
import { useChatStore } from '@/stores/chatStore'
import type { ChatMessage } from '@/types'

// Mock useBreakpoint
vi.mock('@/hooks/useBreakpoint', () => ({
  useBreakpoint: vi.fn(() => 'desktop'),
}))

// Mock scrollIntoView
Element.prototype.scrollIntoView = vi.fn()

const createMessage = (
  id: string,
  username: string = 'TestUser'
): ChatMessage => ({
  messageId: id,
  username,
  content: `Message ${id}`,
  timestamp: new Date().toISOString(),
})

describe('ChatPanel', () => {
  const mockOnSendMessage = vi.fn()

  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      isOpen: true,
      unreadCount: 0,
      nickname: 'TestUser', // Set default nickname so chat UI shows
    })
    mockOnSendMessage.mockReset().mockReturnValue('acknowledged')
  })

  it('renders when isOpen is true', () => {
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    expect(screen.getByText('Chat')).toBeInTheDocument()
  })

  it('does not render when isOpen is false', () => {
    useChatStore.setState({ isOpen: false })
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    expect(screen.queryByText('Chat')).not.toBeInTheDocument()
  })

  it('shows empty state when no messages', () => {
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    expect(screen.getByText('No messages yet. Say hello!')).toBeInTheDocument()
  })

  it('renders messages', () => {
    useChatStore.setState({
      messages: [
        createMessage('1', 'User1'),
        createMessage('2', 'User2'),
      ],
      isOpen: true,
    })
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    expect(screen.getByText('Message 1')).toBeInTheDocument()
    expect(screen.getByText('Message 2')).toBeInTheDocument()
  })

  it('sends message on Enter key', () => {
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    const input = screen.getByPlaceholderText('Type a message...')

    fireEvent.change(input, { target: { value: 'Hello world!' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockOnSendMessage).toHaveBeenCalledWith('Hello world!')
  })

  it('sends message on button click', () => {
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    const input = screen.getByPlaceholderText('Type a message...')
    const sendButton = screen.getByRole('button', { name: 'Send message' })

    fireEvent.change(input, { target: { value: 'Hello world!' } })
    fireEvent.click(sendButton)

    expect(mockOnSendMessage).toHaveBeenCalledWith('Hello world!')
  })

  it('clears input after sending', async () => {
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    const input = screen.getByPlaceholderText('Type a message...')

    fireEvent.change(input, { target: { value: 'Hello!' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('does not send empty messages', () => {
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    const input = screen.getByPlaceholderText('Type a message...')

    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockOnSendMessage).not.toHaveBeenCalled()
  })

  it('closes panel when close button is clicked', () => {
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    const closeButton = screen.getByRole('button', { name: 'Close chat' })

    fireEvent.click(closeButton)

    expect(useChatStore.getState().isOpen).toBe(false)
  })

  it('marks own messages correctly', () => {
    useChatStore.setState({
      messages: [
        createMessage('1', 'CurrentUser'),
        createMessage('2', 'OtherUser'),
      ],
      isOpen: true,
      nickname: 'CurrentUser', // Use nickname from store
    })
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)

    // Own message should not show username
    expect(screen.queryByText('CurrentUser')).not.toBeInTheDocument()
    // Other user's message should show username
    expect(screen.getByText('OtherUser')).toBeInTheDocument()
  })

  it('has max length on input', () => {
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    const input = screen.getByPlaceholderText('Type a message...')
    expect(input).toHaveAttribute('maxLength', '500')
  })

  describe('nickname prompt', () => {
    beforeEach(() => {
      useChatStore.setState({ nickname: null, isOpen: true })
    })

    it('shows nickname prompt when no nickname is set', () => {
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.getByPlaceholderText('Enter display name...')).toBeInTheDocument()
      expect(screen.getByText('Choose a display name')).toBeInTheDocument()
    })

    it('does not show chat input when nickname not set', () => {
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.queryByPlaceholderText('Type a message...')).not.toBeInTheDocument()
    })

    it('saves nickname when form is submitted', () => {
      render(
        <ChatPanel
          onSendMessage={mockOnSendMessage}
          onSetNickname={vi.fn()}
        />
      )
      const input = screen.getByPlaceholderText('Enter display name...')
      const saveButton = screen.getByRole('button', { name: 'Save' })

      fireEvent.change(input, { target: { value: 'TestNick' } })
      fireEvent.click(saveButton)

      expect(useChatStore.getState().nickname).toBe('TestNick')
    })

    it('shows chat after nickname is set', () => {
      useChatStore.setState({ nickname: 'TestNick', isOpen: true })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)

      expect(screen.queryByPlaceholderText('Enter display name...')).not.toBeInTheDocument()
      expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument()
    })

    it('uses store nickname for own message detection', () => {
      useChatStore.setState({
        nickname: 'MyNickname',
        messages: [
          createMessage('1', 'MyNickname'),
          createMessage('2', 'OtherUser'),
        ],
        isOpen: true,
      })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)

      // Own message should not show username
      expect(screen.queryByText('MyNickname')).not.toBeInTheDocument()
      // Other user's message should show username
      expect(screen.getByText('OtherUser')).toBeInTheDocument()
    })

    it('calls onSetNickname when nickname is saved', () => {
      const mockSetNickname = vi.fn()
      render(
        <ChatPanel
          onSendMessage={mockOnSendMessage}
          onSetNickname={mockSetNickname}
        />
      )
      const input = screen.getByPlaceholderText('Enter display name...')
      const saveButton = screen.getByRole('button', { name: 'Save' })

      fireEvent.change(input, { target: { value: 'TestNick' } })
      fireEvent.click(saveButton)

      expect(mockSetNickname).toHaveBeenCalledWith('TestNick')
    })

    it('shows edit button when nickname is set', () => {
      useChatStore.setState({ nickname: 'TestNick', isOpen: true })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)

      expect(screen.getByRole('button', { name: 'Edit nickname' })).toBeInTheDocument()
    })

    it('shows nickname prompt when edit button is clicked', () => {
      useChatStore.setState({ nickname: 'TestNick', isOpen: true })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)

      const editButton = screen.getByRole('button', { name: 'Edit nickname' })
      fireEvent.click(editButton)

      expect(screen.getByPlaceholderText('Enter display name...')).toBeInTheDocument()
    })
  })
  it('FE-11 preserves failed drafts and clears only after matching acknowledgement', async () => {
    mockOnSendMessage.mockReturnValueOnce('not-sent').mockReturnValueOnce('acknowledged')
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    const input = screen.getByPlaceholderText('Type a message...')
    fireEvent.change(input, { target: { value: 'Keep this message' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Message not sent'))
    expect(input).toHaveValue('Keep this message')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(input).toHaveValue(''))
    expect(screen.getByRole('status')).toHaveTextContent('Message accepted by server')
    expect(mockOnSendMessage).toHaveBeenCalledTimes(2)
  })
  it('FE-11 keeps the draft pending and preserves new edits when its old send is acknowledged', async () => {
    let finish!: (result: string) => void
    mockOnSendMessage.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    const input = screen.getByPlaceholderText('Type a message...')
    fireEvent.change(input, { target: { value: 'First' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveValue('First')
    expect(screen.getByRole('status')).toHaveTextContent('waiting for server acknowledgement')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockOnSendMessage).toHaveBeenCalledTimes(1)
    fireEvent.change(input, { target: { value: 'New draft' } })
    await act(async () => finish('acknowledged'))
    expect(input).toHaveValue('New draft')
  })
  it('FE-11 retains a draft when delivery becomes uncertain after send', async () => {
    mockOnSendMessage.mockResolvedValue('unconfirmed')
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    const input = screen.getByPlaceholderText('Type a message...')
    fireEvent.change(input, { target: { value: 'Uncertain' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Delivery is unconfirmed'))
    expect(input).toHaveValue('Uncertain')
  })
})
