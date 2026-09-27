import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@/test/utils'
import { useVideoKeyboardShortcuts } from './useVideoKeyboardShortcuts'

describe('useVideoKeyboardShortcuts', () => {
  let mockProps: Parameters<typeof useVideoKeyboardShortcuts>[0]
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)

    mockProps = {
      containerRef: { current: container },
      onPlayPause: vi.fn(),
      onMuteToggle: vi.fn(),
      onFullscreenToggle: vi.fn(),
      onTheaterModeToggle: vi.fn(),
      onRetry: vi.fn(),
      onVolumeChange: vi.fn(),
      onUnmute: vi.fn(),
      volume: 0.5,
      isMuted: false,
    }
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  const fireKeyEvent = (key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true })
    window.dispatchEvent(event)
  }

  it('calls onPlayPause when Space is pressed', () => {
    renderHook(() => useVideoKeyboardShortcuts(mockProps))

    fireKeyEvent(' ')

    expect(mockProps.onPlayPause).toHaveBeenCalledTimes(1)
  })

  it('calls onMuteToggle when M is pressed', () => {
    renderHook(() => useVideoKeyboardShortcuts(mockProps))

    fireKeyEvent('m')

    expect(mockProps.onMuteToggle).toHaveBeenCalledTimes(1)
  })

  it('calls onMuteToggle when Shift+M is pressed', () => {
    renderHook(() => useVideoKeyboardShortcuts(mockProps))

    fireKeyEvent('M')

    expect(mockProps.onMuteToggle).toHaveBeenCalledTimes(1)
  })

  it('calls onFullscreenToggle when F is pressed', () => {
    renderHook(() => useVideoKeyboardShortcuts(mockProps))

    fireKeyEvent('f')

    expect(mockProps.onFullscreenToggle).toHaveBeenCalledTimes(1)
  })

  it('calls onTheaterModeToggle when T is pressed', () => {
    renderHook(() => useVideoKeyboardShortcuts(mockProps))

    fireKeyEvent('t')

    expect(mockProps.onTheaterModeToggle).toHaveBeenCalledTimes(1)
  })

  it.each(['r', 'R'])('calls onRetry when %s is pressed', (key) => {
    renderHook(() => useVideoKeyboardShortcuts(mockProps))

    fireKeyEvent(key)

    expect(mockProps.onRetry).toHaveBeenCalledTimes(1)
  })

  it('leaves R to a focused text field', () => {
    renderHook(() => useVideoKeyboardShortcuts(mockProps))
    const input = document.createElement('input')
    container.appendChild(input)
    input.focus()

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }))

    expect(mockProps.onRetry).not.toHaveBeenCalled()
  })

  it('leaves Ctrl+R (the browser reload) alone', () => {
    renderHook(() => useVideoKeyboardShortcuts(mockProps))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, bubbles: true }))

    expect(mockProps.onRetry).not.toHaveBeenCalled()
  })

  it('increases volume when ArrowRight is pressed', () => {
    renderHook(() => useVideoKeyboardShortcuts(mockProps))

    fireKeyEvent('ArrowRight')

    expect(mockProps.onVolumeChange).toHaveBeenCalledWith(0.6)
  })

  it('decreases volume when ArrowLeft is pressed', () => {
    renderHook(() => useVideoKeyboardShortcuts(mockProps))

    fireKeyEvent('ArrowLeft')

    expect(mockProps.onVolumeChange).toHaveBeenCalledWith(0.4)
  })

  it('increases volume when ArrowUp is pressed', () => {
    renderHook(() => useVideoKeyboardShortcuts(mockProps))

    fireKeyEvent('ArrowUp')

    expect(mockProps.onVolumeChange).toHaveBeenCalledWith(0.6)
  })

  it('decreases volume when ArrowDown is pressed', () => {
    renderHook(() => useVideoKeyboardShortcuts(mockProps))

    fireKeyEvent('ArrowDown')

    expect(mockProps.onVolumeChange).toHaveBeenCalledWith(0.4)
  })

  it.each(['ArrowUp', 'ArrowRight'])('%s while muted unmutes at the saved level instead of stepping from zero', (key) => {
    renderHook(() => useVideoKeyboardShortcuts({ ...mockProps, isMuted: true }))

    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(mockProps.onUnmute).toHaveBeenCalledTimes(1)
    expect(mockProps.onVolumeChange).not.toHaveBeenCalled()
  })

  it.each(['ArrowDown', 'ArrowLeft'])('%s while muted leaves the mute and the level alone', (key) => {
    renderHook(() => useVideoKeyboardShortcuts({ ...mockProps, isMuted: true }))

    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(mockProps.onVolumeChange).not.toHaveBeenCalled()
    expect(mockProps.onUnmute).not.toHaveBeenCalled()
  })

  it('volume keys never unmute while unmuted', () => {
    renderHook(() => useVideoKeyboardShortcuts(mockProps))

    for (const key of ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft']) fireKeyEvent(key)

    expect(mockProps.onUnmute).not.toHaveBeenCalled()
    expect(mockProps.onVolumeChange).toHaveBeenCalledTimes(4)
  })

  it('leaves ArrowUp/ArrowDown alone when ignoreVerticalArrows is set (TV mode)', () => {
    renderHook(() => useVideoKeyboardShortcuts({ ...mockProps, ignoreVerticalArrows: true }))

    for (const key of ['ArrowUp', 'ArrowDown']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      window.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(mockProps.onVolumeChange).not.toHaveBeenCalled()

    fireKeyEvent('ArrowLeft')
    expect(mockProps.onVolumeChange).toHaveBeenCalledWith(0.4)
  })

  it('does not exceed volume of 1', () => {
    mockProps.volume = 0.95
    renderHook(() => useVideoKeyboardShortcuts(mockProps))

    fireKeyEvent('ArrowRight')

    expect(mockProps.onVolumeChange).toHaveBeenCalledWith(1)
  })

  it('does not go below volume of 0', () => {
    mockProps.volume = 0.05
    renderHook(() => useVideoKeyboardShortcuts(mockProps))

    fireKeyEvent('ArrowLeft')

    expect(mockProps.onVolumeChange).toHaveBeenCalledWith(0)
  })

  it('ignores shortcuts when input is focused', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    renderHook(() => useVideoKeyboardShortcuts(mockProps))

    fireKeyEvent(' ')

    expect(mockProps.onPlayPause).not.toHaveBeenCalled()

    document.body.removeChild(input)
  })
  it.each(['slider', 'range input', 'menuitem', 'option', 'tab', 'switch', 'editable', 'link'])('FE-09 preserves focused %s native keyboard handling', (kind) => {
    const element = document.createElement(kind === 'link' ? 'a' : kind === 'range input' ? 'input' : 'div')
    element.tabIndex = 0
    if (kind === 'editable') element.setAttribute('contenteditable', 'true')
    else if (kind === 'link') element.setAttribute('href', '#')
    else if (kind === 'range input') element.setAttribute('type', 'range')
    else element.setAttribute('role', kind)
    container.append(element)
    element.focus()
    renderHook(() => useVideoKeyboardShortcuts(mockProps))
    for (const key of [' ', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'm', 'f']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      element.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(mockProps.onPlayPause).not.toHaveBeenCalled()
    expect(mockProps.onVolumeChange).not.toHaveBeenCalled()
    expect(mockProps.onMuteToggle).not.toHaveBeenCalled()
  })
  it('handles non-activation keys on a button inside the player but keeps Space/Enter native', () => {
    const button = document.createElement('button')
    container.append(button)
    button.focus()
    renderHook(() => useVideoKeyboardShortcuts(mockProps))

    for (const key of [' ', 'Enter']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      button.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(mockProps.onPlayPause).not.toHaveBeenCalled()

    for (const key of ['m', 'f', 't', 'ArrowUp', 'ArrowLeft']) {
      button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    }
    expect(mockProps.onMuteToggle).toHaveBeenCalledTimes(1)
    expect(mockProps.onFullscreenToggle).toHaveBeenCalledTimes(1)
    expect(mockProps.onTheaterModeToggle).toHaveBeenCalledTimes(1)
    expect(mockProps.onVolumeChange).toHaveBeenNthCalledWith(1, 0.6)
    expect(mockProps.onVolumeChange).toHaveBeenNthCalledWith(2, 0.4)
  })

  it('letters work with focus on a button outside the player (a sidebar channel just clicked); Space and arrows do not', () => {
    const sidebar = document.createElement('ul')
    const button = document.createElement('button')
    sidebar.append(button)
    document.body.appendChild(sidebar)
    button.focus()
    renderHook(() => useVideoKeyboardShortcuts(mockProps))

    for (const key of ['m', 'f', 't', 'r']) {
      button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    }
    expect(mockProps.onMuteToggle).toHaveBeenCalledTimes(1)
    expect(mockProps.onFullscreenToggle).toHaveBeenCalledTimes(1)
    expect(mockProps.onTheaterModeToggle).toHaveBeenCalledTimes(1)
    expect(mockProps.onRetry).toHaveBeenCalledTimes(1)

    for (const key of [' ', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      button.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(mockProps.onPlayPause).not.toHaveBeenCalled()
    expect(mockProps.onVolumeChange).not.toHaveBeenCalled()

    document.body.removeChild(sidebar)
  })

  it('letters work with focus on any other non-text element outside the player', () => {
    const panel = document.createElement('div')
    panel.tabIndex = 0
    document.body.appendChild(panel)
    panel.focus()
    renderHook(() => useVideoKeyboardShortcuts(mockProps))

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }))
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))

    expect(mockProps.onMuteToggle).toHaveBeenCalledTimes(1)
    expect(mockProps.onVolumeChange).not.toHaveBeenCalled()

    document.body.removeChild(panel)
  })

  it.each(['grid', 'listbox', 'menu', 'tablist', 'tree'])('leaves every key to a focused %s (composite widgets move focus with keys)', (role) => {
    const widget = document.createElement('div')
    widget.setAttribute('role', role)
    const item = document.createElement('div')
    item.tabIndex = 0
    widget.append(item)
    document.body.appendChild(widget)
    item.focus()
    renderHook(() => useVideoKeyboardShortcuts(mockProps))

    for (const key of ['m', 'f', 't', 'r']) {
      item.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    }
    expect(mockProps.onMuteToggle).not.toHaveBeenCalled()
    expect(mockProps.onFullscreenToggle).not.toHaveBeenCalled()
    expect(mockProps.onTheaterModeToggle).not.toHaveBeenCalled()
    expect(mockProps.onRetry).not.toHaveBeenCalled()

    document.body.removeChild(widget)
  })

  it('ignores letters in a text field outside the player', () => {
    const input = document.createElement('textarea')
    document.body.appendChild(input)
    input.focus()
    renderHook(() => useVideoKeyboardShortcuts(mockProps))

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }))

    expect(mockProps.onMuteToggle).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })

  it('ignores letters in a dialog outside the player', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const button = document.createElement('button')
    dialog.append(button)
    document.body.appendChild(dialog)
    button.focus()
    renderHook(() => useVideoKeyboardShortcuts(mockProps))

    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }))

    expect(mockProps.onFullscreenToggle).not.toHaveBeenCalled()
    document.body.removeChild(dialog)
  })

  it('ignores keys from inside a dialog, even within the player', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const button = document.createElement('button')
    dialog.append(button)
    container.append(dialog)
    button.focus()
    renderHook(() => useVideoKeyboardShortcuts(mockProps))

    for (const key of ['m', 'f', 'ArrowUp', 'ArrowLeft']) {
      button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    }
    expect(mockProps.onMuteToggle).not.toHaveBeenCalled()
    expect(mockProps.onFullscreenToggle).not.toHaveBeenCalled()
    expect(mockProps.onVolumeChange).not.toHaveBeenCalled()
  })

  describe('channel keys', () => {
    const press = (target: EventTarget, key: string, init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
      target.dispatchEvent(event)
      return event
    }

    it.each([
      ['PageUp', 1],
      [']', 1],
      ['PageDown', -1],
      ['[', -1],
    ] as const)('%s steps the channel by %i without scrolling the page', (key, dir) => {
      const onChannelStep = vi.fn()
      renderHook(() => useVideoKeyboardShortcuts({ ...mockProps, onChannelStep }))

      const event = press(window, key)

      expect(onChannelStep).toHaveBeenCalledTimes(1)
      expect(onChannelStep).toHaveBeenCalledWith(dir)
      expect(event.defaultPrevented).toBe(true)
    })

    it.each(['l', 'L'])('%s goes back to the last channel', (key) => {
      const onLastChannel = vi.fn()
      renderHook(() => useVideoKeyboardShortcuts({ ...mockProps, onLastChannel }))

      press(window, key)

      expect(onLastChannel).toHaveBeenCalledTimes(1)
    })

    it('work with focus on a sidebar channel button outside the player', () => {
      const onChannelStep = vi.fn()
      const onLastChannel = vi.fn()
      const button = document.createElement('button')
      document.body.appendChild(button)
      button.focus()
      renderHook(() => useVideoKeyboardShortcuts({ ...mockProps, onChannelStep, onLastChannel }))

      for (const key of ['PageDown', ']', 'l']) press(button, key)

      expect(onChannelStep.mock.calls).toEqual([[-1], [1]])
      expect(onLastChannel).toHaveBeenCalledTimes(1)
      document.body.removeChild(button)
    })

    it('still work in TV mode, where only Up/Down step aside', () => {
      const onChannelStep = vi.fn()
      renderHook(() => useVideoKeyboardShortcuts({ ...mockProps, onChannelStep, ignoreVerticalArrows: true }))

      press(window, 'ArrowUp')
      press(window, 'PageDown')

      expect(onChannelStep).toHaveBeenCalledTimes(1)
      expect(onChannelStep).toHaveBeenCalledWith(-1)
      expect(mockProps.onVolumeChange).not.toHaveBeenCalled()
    })

    it('are left to text fields and dialogs', () => {
      const onChannelStep = vi.fn()
      const onLastChannel = vi.fn()
      const input = document.createElement('input')
      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      const inDialog = document.createElement('button')
      dialog.append(inDialog)
      document.body.append(input, dialog)
      renderHook(() => useVideoKeyboardShortcuts({ ...mockProps, onChannelStep, onLastChannel }))

      for (const target of [input, inDialog]) {
        target.focus()
        for (const key of ['PageUp', '[', 'l']) {
          expect(press(target, key).defaultPrevented).toBe(false)
        }
      }

      expect(onChannelStep).not.toHaveBeenCalled()
      expect(onLastChannel).not.toHaveBeenCalled()
      document.body.removeChild(input)
      document.body.removeChild(dialog)
    })

    it('ignore modifiers (Ctrl+PageUp switches browser tabs)', () => {
      const onChannelStep = vi.fn()
      renderHook(() => useVideoKeyboardShortcuts({ ...mockProps, onChannelStep }))

      press(window, 'PageUp', { ctrlKey: true })
      press(window, 'PageDown', { altKey: true })
      press(window, ']', { metaKey: true })

      expect(onChannelStep).not.toHaveBeenCalled()
    })

    it('leaves keys with no action alone, so two instances can split the map', () => {
      renderHook(() => useVideoKeyboardShortcuts(mockProps))
      const onChannelStep = vi.fn()
      renderHook(() => useVideoKeyboardShortcuts({ containerRef: { current: container }, onChannelStep }))

      expect(press(window, 'PageUp').defaultPrevented).toBe(true)
      expect(press(window, ' ').defaultPrevented).toBe(true)
      press(window, 'ArrowUp')

      expect(onChannelStep).toHaveBeenCalledTimes(1)
      expect(mockProps.onPlayPause).toHaveBeenCalledTimes(1)
      expect(mockProps.onVolumeChange).toHaveBeenCalledTimes(1)
    })

    it.each(['0', '1', '5', '9'])('digit %s is part of a channel number', (key) => {
      const onDigit = vi.fn()
      renderHook(() => useVideoKeyboardShortcuts({ ...mockProps, onDigit }))

      press(window, key)

      expect(onDigit).toHaveBeenCalledTimes(1)
      expect(onDigit).toHaveBeenCalledWith(key)
    })

    it('digits work with focus on a sidebar button, but not in a text field or dialog', () => {
      const onDigit = vi.fn()
      const button = document.createElement('button')
      const input = document.createElement('input')
      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      const inDialog = document.createElement('button')
      dialog.append(inDialog)
      document.body.append(button, input, dialog)
      renderHook(() => useVideoKeyboardShortcuts({ ...mockProps, onDigit }))

      button.focus()
      press(button, '1')
      input.focus()
      press(input, '2')
      inDialog.focus()
      press(inDialog, '3')

      expect(onDigit.mock.calls).toEqual([['1']])
      document.body.removeChild(button)
      document.body.removeChild(input)
      document.body.removeChild(dialog)
    })

    it('Enter commits the number being typed, and only then takes the key', () => {
      const onDigitCommit = vi.fn(() => true)
      renderHook(() => useVideoKeyboardShortcuts({ ...mockProps, onDigitCommit }))

      expect(press(window, 'Enter').defaultPrevented).toBe(true)
      expect(onDigitCommit).toHaveBeenCalledTimes(1)

      onDigitCommit.mockReturnValue(false)
      expect(press(window, 'Enter').defaultPrevented).toBe(false)
    })

    it('Enter on a focused button stays with the button', () => {
      const onDigitCommit = vi.fn(() => true)
      const button = document.createElement('button')
      document.body.appendChild(button)
      button.focus()
      renderHook(() => useVideoKeyboardShortcuts({ ...mockProps, onDigitCommit }))

      expect(press(button, 'Enter').defaultPrevented).toBe(false)
      expect(onDigitCommit).not.toHaveBeenCalled()
      document.body.removeChild(button)
    })

    it('an instance without channel actions leaves PageUp to the page', () => {
      renderHook(() => useVideoKeyboardShortcuts(mockProps))

      expect(press(window, 'PageUp').defaultPrevented).toBe(false)
    })
  })

  describe('panel keys', () => {
    const press = (target: EventTarget, key: string, init: KeyboardEventInit = {}) => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
    }
    const panelActions = () => ({ onShortcutSheet: vi.fn(), onChatToggle: vi.fn(), onNHLToggle: vi.fn() })

    it('? opens the shortcut sheet', () => {
      const actions = panelActions()
      renderHook(() => useVideoKeyboardShortcuts({ ...mockProps, ...actions }))

      // Shift+/ on a US layout
      press(window, '?', { shiftKey: true })

      expect(actions.onShortcutSheet).toHaveBeenCalledTimes(1)
      expect(actions.onChatToggle).not.toHaveBeenCalled()
      expect(actions.onNHLToggle).not.toHaveBeenCalled()
    })

    it.each(['c', 'C'])('%s toggles chat', (key) => {
      const actions = panelActions()
      renderHook(() => useVideoKeyboardShortcuts({ ...mockProps, ...actions }))

      press(window, key)

      expect(actions.onChatToggle).toHaveBeenCalledTimes(1)
      expect(actions.onNHLToggle).not.toHaveBeenCalled()
    })

    it.each(['n', 'N'])('%s toggles the NHL scores', (key) => {
      const actions = panelActions()
      renderHook(() => useVideoKeyboardShortcuts({ ...mockProps, ...actions }))

      press(window, key)

      expect(actions.onNHLToggle).toHaveBeenCalledTimes(1)
      expect(actions.onChatToggle).not.toHaveBeenCalled()
    })

    it('work with focus on a sidebar channel button outside the player', () => {
      const actions = panelActions()
      const button = document.createElement('button')
      document.body.appendChild(button)
      button.focus()
      renderHook(() => useVideoKeyboardShortcuts({ ...mockProps, ...actions }))

      for (const key of ['?', 'c', 'n']) press(button, key)

      expect(actions.onShortcutSheet).toHaveBeenCalledTimes(1)
      expect(actions.onChatToggle).toHaveBeenCalledTimes(1)
      expect(actions.onNHLToggle).toHaveBeenCalledTimes(1)
      document.body.removeChild(button)
    })

    it('are left to text fields (the chat composer) and dialogs (the sheet itself)', () => {
      const actions = panelActions()
      const input = document.createElement('textarea')
      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      const inDialog = document.createElement('button')
      dialog.append(inDialog)
      document.body.append(input, dialog)
      renderHook(() => useVideoKeyboardShortcuts({ ...mockProps, ...actions }))

      for (const target of [input, inDialog]) {
        target.focus()
        for (const key of ['?', 'c', 'n']) press(target, key)
      }

      expect(actions.onShortcutSheet).not.toHaveBeenCalled()
      expect(actions.onChatToggle).not.toHaveBeenCalled()
      expect(actions.onNHLToggle).not.toHaveBeenCalled()
      document.body.removeChild(input)
      document.body.removeChild(dialog)
    })

    it('ignore modifiers (Ctrl+C copies, Ctrl+N opens a window)', () => {
      const actions = panelActions()
      renderHook(() => useVideoKeyboardShortcuts({ ...mockProps, ...actions }))

      press(window, 'c', { ctrlKey: true })
      press(window, 'n', { metaKey: true })
      press(window, '?', { altKey: true })

      expect(actions.onShortcutSheet).not.toHaveBeenCalled()
      expect(actions.onChatToggle).not.toHaveBeenCalled()
      expect(actions.onNHLToggle).not.toHaveBeenCalled()
    })
  })

  it('FE-09 respects an already handled player-surface event', () => {
    renderHook(() => useVideoKeyboardShortcuts(mockProps))
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    event.preventDefault()
    window.dispatchEvent(event)
    expect(mockProps.onPlayPause).not.toHaveBeenCalled()
  })

})
