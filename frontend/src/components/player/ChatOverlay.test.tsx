import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@/test/utils'
import { ChatOverlay, CHAT_OVERLAY_FADE_MS, CHAT_OVERLAY_SHOW_MS } from './ChatOverlay'
import { PlayerShellContext, type PlayerShell } from './PlayerShellContext'
import { useChatStore, type ChatSender } from '@/stores/chatStore'
import { mockViewport } from '@/test/viewport'
import { useUIStore } from '@/stores/uiStore'
import type { ChatMessage } from '@/types'

// Chat is a build-time flag, on here unless a test turns it off
const chatFlag = vi.hoisted(() => ({ enabled: true }))
vi.mock('@/hooks/useChatEnabled', () => ({ useChatEnabled: () => chatFlag.enabled }))

const makeShell = (overrides: Partial<PlayerShell> = {}): PlayerShell => ({
  containerRef: { current: null },
  isFullscreen: false,
  toggleFullscreen: vi.fn(),
  isTheaterMode: true,
  toggleTheaterMode: vi.fn(),
  controlsVisible: true,
  setPlaying: vi.fn(),
  setHoveringControls: vi.fn(),
  isInfoRailVisible: false,
  setInfoRailVisible: vi.fn(),
  behindLive: null,
  setBehindLive: vi.fn(),
  isLivePaused: false,
  setLivePaused: vi.fn(),
  isAutoplayNoticeShown: false,
  setAutoplayNoticeShown: vi.fn(),
  reload: vi.fn(),
  reloadKey: 0,
  ...overrides,
})

interface Composer {
  composerRequest?: number | null
  onComposerClose?: () => void
}

const renderOverlay = (shell: Partial<PlayerShell> = {}, composer: Composer = {}) => {
  const value = makeShell(shell)
  const view = render(
    <PlayerShellContext value={value}>
      <ChatOverlay {...composer} />
    </PlayerShellContext>
  )
  return {
    ...view,
    shell: value,
    update: (next: Partial<PlayerShell>, nextComposer: Composer = composer) =>
      view.rerender(
        <PlayerShellContext value={makeShell(next)}>
          <ChatOverlay {...nextComposer} />
        </PlayerShellContext>
      ),
  }
}

let sequence = 0
const message = (content: string, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  messageId: `m${++sequence}`,
  username: 'maya',
  userId: 'u_maya',
  content,
  timestamp: new Date().toISOString(),
  ...overrides,
})
const arrive = (...messages: ChatMessage[]) =>
  act(() => {
    for (const m of messages) useChatStore.getState().addMessage(m)
  })
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })

const overlay = () => screen.queryByTestId('chat-overlay')
const shown = () => screen.queryAllByTestId('chat-overlay-message')
const shownText = () => shown().map((element) => element.textContent)

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  chatFlag.enabled = true
  useChatStore.setState({ messages: [], isOpen: false, unreadCount: 0, nickname: null, me: null, lastReadAt: 0 })
  useUIStore.setState({ chatPreviews: true })
})

const setupMatchMedia = window.matchMedia
afterEach(() => {
  vi.useRealTimers()
  window.matchMedia = setupMatchMedia
})

describe('ChatOverlay', () => {
  it.each([
    ['theater', { isTheaterMode: true, isFullscreen: false }],
    ['fullscreen', { isTheaterMode: false, isFullscreen: true }],
  ])('shows new messages over the video in %s', (_mode, shell) => {
    renderOverlay(shell)
    arrive(message('switch to TSN, OT!'))

    expect(shownText()).toEqual(['maya switch to TSN, OT!'])
  })

  it('is not drawn outside theater and fullscreen', () => {
    renderOverlay({ isTheaterMode: false, isFullscreen: false })
    arrive(message('hello'))

    expect(overlay()).not.toBeInTheDocument()
  })

  it('shows only the last 4 messages', () => {
    renderOverlay()
    arrive(message('one'), message('two'), message('three'), message('four'), message('five'))

    expect(shownText()).toEqual(['maya two', 'maya three', 'maya four', 'maya five'])
  })

  it('fades each message after 12s and then drops it', () => {
    renderOverlay()
    arrive(message('first'))
    advance(5_000)
    arrive(message('second'))

    advance(CHAT_OVERLAY_SHOW_MS - 5_000 - 1)
    expect(shown()[0]).toHaveClass('opacity-100')

    // The first has had its 12s: it fades (opacity and transform only), then goes
    advance(1)
    expect(shown()[0]).toHaveClass('opacity-0', 'translate-y-1')
    expect(shown()[1]).toHaveClass('opacity-100')
    advance(CHAT_OVERLAY_FADE_MS)
    expect(shownText()).toEqual(['maya second'])

    // The second, 5s later
    advance(5_000)
    advance(CHAT_OVERLAY_FADE_MS)
    expect(shown()).toHaveLength(0)
  })

  it('takes no pointer except its Open chat target, which opens the panel', () => {
    renderOverlay()
    arrive(message('hello'))

    expect(overlay()).toHaveClass('pointer-events-none')
    const open = screen.getByRole('button', { name: 'Open chat' })
    expect(open).toHaveClass('pointer-events-auto')
    fireEvent.click(open)
    expect(useChatStore.getState().isOpen).toBe(true)
    // The panel shows the messages now
    expect(overlay()).not.toBeInTheDocument()
  })

  // It is gone from under the pointer, which fires no mouseleave: without
  // letting go, the control bar would never hide again
  it('lets go of the control bar when its target is clicked away', () => {
    const { shell } = renderOverlay()
    arrive(message('hello'))

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Open chat' }))
    expect(shell.setHoveringControls).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))

    expect(shell.setHoveringControls).toHaveBeenLastCalledWith(false)
  })

  it('lets go of the control bar when the last message fades from under the pointer', () => {
    const { shell } = renderOverlay()
    arrive(message('hello'))

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Open chat' }))
    advance(CHAT_OVERLAY_SHOW_MS)
    advance(CHAT_OVERLAY_FADE_MS)

    expect(screen.queryByRole('button', { name: 'Open chat' })).not.toBeInTheDocument()
    expect(shell.setHoveringControls).toHaveBeenLastCalledWith(false)
  })

  it('leaves the control bar alone when its target goes without the pointer on it', () => {
    const { shell } = renderOverlay()
    arrive(message('hello'))

    advance(CHAT_OVERLAY_SHOW_MS)
    advance(CHAT_OVERLAY_FADE_MS)

    expect(screen.queryByRole('button', { name: 'Open chat' })).not.toBeInTheDocument()
    expect(shell.setHoveringControls).not.toHaveBeenCalled()
  })

  it('has no Open chat target while no message shows', () => {
    renderOverlay()
    expect(screen.queryByRole('button', { name: 'Open chat' })).not.toBeInTheDocument()
  })

  it('is hidden while the chat panel is open', () => {
    useChatStore.setState({ isOpen: true })
    renderOverlay()
    arrive(message('hello'))

    expect(overlay()).not.toBeInTheDocument()
  })

  it('is hidden without chat', () => {
    chatFlag.enabled = false
    renderOverlay()
    arrive(message('hello'))

    expect(overlay()).not.toBeInTheDocument()
  })

  it("is hidden once the viewer turns off 'Show chat over the video'", () => {
    useUIStore.setState({ chatPreviews: false })
    renderOverlay()
    arrive(message('hello'))

    expect(overlay()).not.toBeInTheDocument()
  })

  it('is hidden on the TV layout', () => {
    localStorage.setItem('tv-mode', 'true')
    renderOverlay({ isFullscreen: true })
    arrive(message('hello'))

    expect(overlay()).not.toBeInTheDocument()
  })

  it('shows only what arrives while it is up, not messages from before theater', () => {
    const { update } = renderOverlay({ isTheaterMode: false })
    arrive(message('before theater'))

    update({ isTheaterMode: true })
    expect(shown()).toHaveLength(0)
    arrive(message('in theater'))
    expect(shownText()).toEqual(['maya in theater'])
  })

  it('does not replay a history (the first load, a reconnect replacing the list)', () => {
    renderOverlay()
    act(() => useChatStore.getState().setMessages([message('old one'), message('old two')]))

    expect(shown()).toHaveLength(0)
  })

  it("shows what a reconnect's history brings that was missed", () => {
    const earlier = message('earlier')
    useChatStore.setState({ messages: [earlier] })
    renderOverlay()

    act(() => useChatStore.getState().setMessages([earlier, message('missed while away')]))

    expect(shownText()).toEqual(['maya missed while away'])
  })

  it('says a GIF rather than its address, and shows system lines as they are', () => {
    renderOverlay()
    arrive(
      message('lol https://media.giphy.com/media/abc/giphy.gif'),
      message('dev changed Live to TSN 5', { kind: 'system', username: 'Live TV', userId: '' })
    )

    expect(shownText()).toEqual(['maya lol GIF', 'dev changed Live to TSN 5'])
  })

  it('reads new messages out politely, as the closed panel would have', () => {
    renderOverlay()
    arrive(message('hello'))

    const log = screen.getByRole('log', { name: 'Latest chat messages' })
    expect(log).toHaveAttribute('aria-live', 'polite')
    expect(log).toHaveTextContent('maya hello')
  })
})

describe('ChatOverlay composer', () => {
  let unregister: () => void = () => {}
  afterEach(() => unregister())

  const input = () => screen.queryByRole('textbox', { name: 'Message the club' })
  const registerSender = (result: Awaited<ReturnType<ChatSender>> = 'acknowledged') => {
    const sender = vi.fn<ChatSender>(() => Promise.resolve(result))
    unregister = useChatStore.getState().registerSender(sender)
    return sender
  }

  it('opens focused when C asks for it, in theater and fullscreen', () => {
    renderOverlay({ isFullscreen: true, isTheaterMode: false }, { composerRequest: 1, onComposerClose: vi.fn() })
    expect(input()).toHaveFocus()
  })

  it('is closed until asked for', () => {
    renderOverlay()
    expect(input()).not.toBeInTheDocument()
  })

  it('takes focus again on another C press while open', () => {
    const onComposerClose = vi.fn()
    const { update } = renderOverlay({}, { composerRequest: 1, onComposerClose })
    fireEvent.change(input()!, { target: { value: 'half' } })
    screen.getByRole('button', { name: 'Send message' }).focus()

    update({ isTheaterMode: true }, { composerRequest: 2, onComposerClose })
    expect(input()).toHaveFocus()
    expect(input()).toHaveValue('half')
  })

  it('Enter sends through the registered sender, then closes', async () => {
    const sender = registerSender()
    const onComposerClose = vi.fn()
    renderOverlay({}, { composerRequest: 1, onComposerClose })

    fireEvent.change(input()!, { target: { value: '  what a save  ' } })
    // Enter in the field submits its form
    await act(async () => {
      fireEvent.submit(input()!)
    })

    expect(sender).toHaveBeenCalledWith('what a save', expect.any(String))
    expect(onComposerClose).toHaveBeenCalledTimes(1)
  })

  it('sends nothing empty', async () => {
    const sender = registerSender()
    renderOverlay({}, { composerRequest: 1, onComposerClose: vi.fn() })

    fireEvent.change(input()!, { target: { value: '   ' } })
    await act(async () => {
      fireEvent.submit(input()!)
    })

    expect(sender).not.toHaveBeenCalled()
  })

  // It closes under the pointer, which fires no mouseleave: without letting
  // go, the control bar would never hide again
  it('lets go of the control bar when it closes under the pointer after a send', async () => {
    registerSender()
    const shell = makeShell()
    function Host() {
      const [request, setRequest] = useState<number | null>(1)
      return (
        <PlayerShellContext value={shell}>
          <ChatOverlay composerRequest={request} onComposerClose={() => setRequest(null)} />
        </PlayerShellContext>
      )
    }
    render(<Host />)

    fireEvent.mouseEnter(input()!.closest('form')!)
    expect(shell.setHoveringControls).toHaveBeenLastCalledWith(true)
    fireEvent.change(input()!, { target: { value: 'what a save' } })
    await act(async () => {
      fireEvent.submit(input()!)
    })

    expect(input()).not.toBeInTheDocument()
    expect(shell.setHoveringControls).toHaveBeenLastCalledWith(false)
  })

  it('keeps the words after a failed send and retries under the same id', async () => {
    const sender = registerSender('not-sent')
    const onComposerClose = vi.fn()
    renderOverlay({}, { composerRequest: 1, onComposerClose })

    fireEvent.change(input()!, { target: { value: 'offside' } })
    await act(async () => {
      fireEvent.submit(input()!)
    })

    expect(screen.getByRole('alert')).toHaveTextContent("Not sent. You're offline or reconnecting.")
    expect(input()).toHaveValue('offside')
    expect(onComposerClose).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.submit(input()!)
    })
    expect(sender).toHaveBeenCalledTimes(2)
    expect(sender.mock.calls[1][1]).toBe(sender.mock.calls[0][1])
  })

  it('Escape closes it and nothing else: the event is marked handled', () => {
    const onComposerClose = vi.fn()
    renderOverlay({}, { composerRequest: 1, onComposerClose })

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    input()!.dispatchEvent(escape)

    expect(onComposerClose).toHaveBeenCalledTimes(1)
    expect(escape.defaultPrevented).toBe(true)
  })

  it('closes when focus leaves it empty, but keeps a draft', () => {
    const onComposerClose = vi.fn()
    renderOverlay({}, { composerRequest: 1, onComposerClose })

    fireEvent.change(input()!, { target: { value: 'draft' } })
    fireEvent.blur(input()!)
    expect(onComposerClose).not.toHaveBeenCalled()

    fireEvent.change(input()!, { target: { value: '' } })
    fireEvent.blur(input()!)
    expect(onComposerClose).toHaveBeenCalledTimes(1)
  })

  describe('on a touch screen', () => {
    beforeEach(() => {
      mockViewport({ width: 1024, height: 768, pointer: 'coarse' })
    })

    it('is read-only: no composer, even when asked for', () => {
      renderOverlay({ isFullscreen: true }, { composerRequest: 1, onComposerClose: vi.fn() })
      arrive(message('hello'))

      expect(shownText()).toEqual(['maya hello'])
      expect(input()).not.toBeInTheDocument()
    })

    it("offers 'Exit fullscreen to reply', which leaves fullscreen for the chat panel", () => {
      const { shell } = renderOverlay({ isFullscreen: true, isTheaterMode: false })
      arrive(message('hello'))

      fireEvent.click(screen.getByRole('button', { name: 'Exit fullscreen to reply' }))

      expect(shell.toggleFullscreen).toHaveBeenCalledTimes(1)
      expect(useChatStore.getState().isOpen).toBe(true)
    })

    it('in theater its target just opens chat', () => {
      const { shell } = renderOverlay({ isTheaterMode: true })
      arrive(message('hello'))

      fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))

      expect(shell.toggleFullscreen).not.toHaveBeenCalled()
      expect(useChatStore.getState().isOpen).toBe(true)
    })
  })
})
