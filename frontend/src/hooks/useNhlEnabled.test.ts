import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@/test/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { isNhlEnabled, useNhlEnabled, useNhlOverlayVisible } from './useNhlEnabled'

describe('useNhlEnabled', () => {
  beforeEach(() => {
    useSettingsStore.setState({ serverFeatures: null })
    useUIStore.setState({ isNHLOverlayVisible: false })
  })

  it('is false before the first connection_ack', () => {
    expect(renderHook(() => useNhlEnabled()).result.current).toBe(false)
    expect(isNhlEnabled()).toBe(false)
  })

  it('follows the server: on, then off', () => {
    const { result, rerender } = renderHook(() => useNhlEnabled())

    act(() => useSettingsStore.getState().setServerFeatures({ chat: false, gif: false, nhl: true }))
    rerender()
    expect(result.current).toBe(true)
    expect(isNhlEnabled()).toBe(true)

    act(() => useSettingsStore.getState().setServerFeatures({ chat: true, gif: true, nhl: false }))
    rerender()
    expect(result.current).toBe(false)
    expect(isNhlEnabled()).toBe(false)
  })
})

describe('useNhlOverlayVisible', () => {
  beforeEach(() => {
    useSettingsStore.setState({ serverFeatures: { chat: false, gif: false, nhl: true } })
    useUIStore.setState({ isNHLOverlayVisible: false })
  })

  it('shows the overlay while it is open and NHL scores are on', () => {
    const { result, rerender } = renderHook(() => useNhlOverlayVisible())
    expect(result.current).toBe(false)

    act(() => useUIStore.getState().setNHLOverlayVisible(true))
    rerender()
    expect(result.current).toBe(true)
  })

  it('hides an open overlay when the server switches NHL scores off', () => {
    useUIStore.setState({ isNHLOverlayVisible: true })
    const { result, rerender } = renderHook(() => useNhlOverlayVisible())
    expect(result.current).toBe(true)

    act(() => useSettingsStore.getState().setServerFeatures({ chat: false, gif: false, nhl: false }))
    rerender()
    expect(result.current).toBe(false)
  })
})
