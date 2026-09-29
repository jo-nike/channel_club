import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@/test/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { isChatEnabled, useChatEnabled } from './useChatEnabled'

describe('useChatEnabled', () => {
  beforeEach(() => {
    useSettingsStore.setState({ serverFeatures: null })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is true with the build flag on before the first connection_ack', () => {
    vi.stubEnv('VITE_CHAT_ENABLED', 'true')
    expect(renderHook(() => useChatEnabled()).result.current).toBe(true)
    expect(isChatEnabled()).toBe(true)
  })

  it('is true with the build flag on when the server says chat is on', () => {
    vi.stubEnv('VITE_CHAT_ENABLED', 'true')
    useSettingsStore.setState({ serverFeatures: { chat: true, gif: false } })
    expect(renderHook(() => useChatEnabled()).result.current).toBe(true)
  })

  it('is false when the server says chat is off, even with the build flag on', () => {
    vi.stubEnv('VITE_CHAT_ENABLED', 'true')
    useSettingsStore.setState({ serverFeatures: { chat: false, gif: true } })
    expect(renderHook(() => useChatEnabled()).result.current).toBe(false)
    expect(isChatEnabled()).toBe(false)
  })

  it.each(['false', ''])('is false when the build flag is %j, whatever the server says', (flag) => {
    vi.stubEnv('VITE_CHAT_ENABLED', flag)
    useSettingsStore.setState({ serverFeatures: { chat: true, gif: true } })
    expect(renderHook(() => useChatEnabled()).result.current).toBe(false)
    expect(isChatEnabled()).toBe(false)
  })

  it('hides chat once an ack says it is off', () => {
    vi.stubEnv('VITE_CHAT_ENABLED', 'true')
    const { result, rerender } = renderHook(() => useChatEnabled())
    expect(result.current).toBe(true)

    act(() => useSettingsStore.getState().setServerFeatures({ chat: false, gif: false }))
    rerender()

    expect(result.current).toBe(false)
  })
})
