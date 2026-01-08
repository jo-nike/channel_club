import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useChatEnabled } from './useChatEnabled'

describe('useChatEnabled', () => {
  const originalEnv = { ...import.meta.env }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    Object.assign(import.meta.env, originalEnv)
  })

  it('returns true when VITE_CHAT_ENABLED is "true"', async () => {
    import.meta.env.VITE_CHAT_ENABLED = 'true'
    const { useChatEnabled: hook } = await import('./useChatEnabled')
    expect(hook()).toBe(true)
  })

  it('returns false when VITE_CHAT_ENABLED is "false"', async () => {
    import.meta.env.VITE_CHAT_ENABLED = 'false'
    const { useChatEnabled: hook } = await import('./useChatEnabled')
    expect(hook()).toBe(false)
  })

  it('returns false when VITE_CHAT_ENABLED is undefined', async () => {
    delete (import.meta.env as Record<string, string>).VITE_CHAT_ENABLED
    const { useChatEnabled: hook } = await import('./useChatEnabled')
    expect(hook()).toBe(false)
  })
})
