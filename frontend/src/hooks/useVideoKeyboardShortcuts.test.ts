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

  it('ignores a focused button outside the player', () => {
    const button = document.createElement('button')
    document.body.appendChild(button)
    button.focus()
    renderHook(() => useVideoKeyboardShortcuts(mockProps))

    for (const key of ['m', 'ArrowUp', 'ArrowLeft']) {
      button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    }
    expect(mockProps.onMuteToggle).not.toHaveBeenCalled()
    expect(mockProps.onVolumeChange).not.toHaveBeenCalled()

    document.body.removeChild(button)
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

  it('FE-09 respects an already handled player-surface event', () => {
    renderHook(() => useVideoKeyboardShortcuts(mockProps))
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    event.preventDefault()
    window.dispatchEvent(event)
    expect(mockProps.onPlayPause).not.toHaveBeenCalled()
  })

})
