import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useClipStore } from './clipStore'

describe('clipStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useClipStore.setState({ session: null, clipping: false })
  })

  it('starts with no session', () => {
    expect(useClipStore.getState().session).toBeNull()
  })

  it('open records the channel the capture comes from', () => {
    useClipStore.getState().open('42', 'Sportsnet')
    expect(useClipStore.getState().session).toEqual({ channelId: '42', channelName: 'Sportsnet' })
  })

  it('open can hand the editor a capture already taken', () => {
    const capture = { id: 'capture-1', duration: 60, bytes: 17, expiresAt: 0, pressedAt: 1_000, endsAt: 1_000 }
    useClipStore.getState().open('42', 'Sportsnet', capture)
    expect(useClipStore.getState().session).toEqual({ channelId: '42', channelName: 'Sportsnet', capture })
  })

  it('close ends the session', () => {
    useClipStore.getState().open('42', 'Sportsnet')
    useClipStore.getState().close()
    expect(useClipStore.getState().session).toBeNull()
  })

  it('opening again starts a session on the new channel', () => {
    useClipStore.getState().open('42', 'Sportsnet')
    useClipStore.getState().open('7', 'TSN')
    expect(useClipStore.getState().session).toEqual({ channelId: '7', channelName: 'TSN' })
  })

  it('records a Clip that under way until it is done', () => {
    expect(useClipStore.getState().clipping).toBe(false)
    useClipStore.getState().setClipping(true)
    expect(useClipStore.getState().clipping).toBe(true)
    useClipStore.getState().setClipping(false)
    expect(useClipStore.getState().clipping).toBe(false)
  })

  it('is never saved', () => {
    vi.mocked(localStorage.setItem).mockClear()
    useClipStore.getState().open('42', 'Sportsnet')
    expect(localStorage.setItem).not.toHaveBeenCalled()
  })
})
