import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@/test/utils'
import { ChatPanel } from './ChatPanel'
import { useChatStore } from '@/stores/chatStore'
import type { ChatMessage } from '@/types'

// Mock useBreakpoint
vi.mock('@/hooks/useBreakpoint', () => ({
  useBreakpoint: vi.fn(() => 'desktop'),
}))

// Stand-in for the GIF picker, which fetches its feature flag; only its disabled state matters here
vi.mock('./GifButton', () => ({
  GifButton: ({ disabled }: { disabled?: boolean }) => (
    <button type="button" aria-label="Send GIF" disabled={disabled} />
  ),
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
      nickname: 'TestUser',
      me: null,
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

  describe('chat identity', () => {
    beforeEach(() => {
      localStorage.clear()
      useChatStore.setState({ nickname: null, me: { username: 'testuser' }, isOpen: true })
    })

    it('goes straight to chat without asking for a display name', () => {
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.queryByText('Choose a display name')).not.toBeInTheDocument()
      expect(screen.queryByPlaceholderText('Enter display name...')).not.toBeInTheDocument()
      expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument()
    })

    it('says you are chatting as your sign-in name', () => {
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.getByText('Chatting as testuser')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Edit nickname' })).toBeInTheDocument()
    })

    it('says you are chatting as your nickname when one is set', () => {
      useChatStore.setState({ nickname: 'TestNick' })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.getByText('Chatting as TestNick')).toBeInTheDocument()
    })

    it('shows no identity line until the server says who you are', () => {
      useChatStore.setState({ me: null })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.queryByText(/Chatting as/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Edit nickname' })).not.toBeInTheDocument()
      expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument()
    })

    it('treats messages under the sign-in name as your own when no nickname is set', () => {
      useChatStore.setState({
        messages: [createMessage('1', 'testuser'), createMessage('2', 'OtherUser')],
      })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)

      // Own message should not show username
      expect(screen.queryByText('testuser')).not.toBeInTheDocument()
      // Other user's message should show username
      expect(screen.getByText('OtherUser')).toBeInTheDocument()
    })

    it('uses store nickname for own message detection', () => {
      useChatStore.setState({
        nickname: 'MyNickname',
        messages: [
          createMessage('1', 'MyNickname'),
          createMessage('2', 'OtherUser'),
        ],
      })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)

      // Own message should not show username
      expect(screen.queryByText('MyNickname')).not.toBeInTheDocument()
      // Other user's message should show username
      expect(screen.getByText('OtherUser')).toBeInTheDocument()
    })

    it('does not disable the GIF button for want of a nickname', () => {
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.getByRole('button', { name: 'Send GIF' })).toBeEnabled()
    })

    it('opens the editor from the pencil and saves a nickname', () => {
      const mockSetNickname = vi.fn()
      render(
        <ChatPanel
          onSendMessage={mockOnSendMessage}
          onSetNickname={mockSetNickname}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Edit nickname' }))
      const input = screen.getByPlaceholderText('Enter display name...')
      fireEvent.change(input, { target: { value: 'TestNick' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockSetNickname).toHaveBeenCalledWith('TestNick')
      expect(useChatStore.getState().nickname).toBe('TestNick')
      expect(localStorage.getItem('chat_nickname:testuser')).toBe('TestNick')
      expect(screen.queryByPlaceholderText('Enter display name...')).not.toBeInTheDocument()
      expect(screen.getByText('Chatting as TestNick')).toBeInTheDocument()
    })

    it('pre-fills the editor with the current nickname', () => {
      useChatStore.setState({ nickname: 'TestNick' })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)

      fireEvent.click(screen.getByRole('button', { name: 'Edit nickname' }))

      expect(screen.getByPlaceholderText('Enter display name...')).toHaveValue('TestNick')
    })

    it('goes back to the sign-in name with an empty set_nickname', () => {
      const mockSetNickname = vi.fn()
      useChatStore.getState().setNickname('TestNick')
      render(
        <ChatPanel
          onSendMessage={mockOnSendMessage}
          onSetNickname={mockSetNickname}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Edit nickname' }))
      fireEvent.click(screen.getByRole('button', { name: 'Use my sign-in name' }))

      expect(mockSetNickname).toHaveBeenCalledWith('')
      expect(useChatStore.getState().nickname).toBeNull()
      expect(localStorage.getItem('chat_nickname:testuser')).toBeNull()
      expect(screen.getByText('Chatting as testuser')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument()
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
