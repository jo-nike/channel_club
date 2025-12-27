import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
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
      onVolumeChange: vi.fn(),
      volume: 0.5,
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
})
