import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@/test/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { isChatEnabled, useChatEnabled } from './useChatEnabled'

describe('useChatEnabled', () => {
  beforeEach(() => {
    useSettingsStore.setState({ serverFeatures: null })
  })

  it('is false before the first connection_ack', () => {
    expect(renderHook(() => useChatEnabled()).result.current).toBe(false)
    expect(isChatEnabled()).toBe(false)
  })

  it('is true when the server says chat is on', () => {
    useSettingsStore.setState({ serverFeatures: { chat: true, gif: false } })
    expect(renderHook(() => useChatEnabled()).result.current).toBe(true)
    expect(isChatEnabled()).toBe(true)
  })

  it('is false when the server says chat is off', () => {
    useSettingsStore.setState({ serverFeatures: { chat: false, gif: true } })
    expect(renderHook(() => useChatEnabled()).result.current).toBe(false)
    expect(isChatEnabled()).toBe(false)
  })

  it('follows the server when an ack changes its answer', () => {
    const { result, rerender } = renderHook(() => useChatEnabled())
    expect(result.current).toBe(false)

    act(() => useSettingsStore.getState().setServerFeatures({ chat: true, gif: false }))
    rerender()
    expect(result.current).toBe(true)

    act(() => useSettingsStore.getState().setServerFeatures({ chat: false, gif: false }))
    rerender()
    expect(result.current).toBe(false)
  })
})
