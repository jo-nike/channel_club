import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useClipStore } from './clipStore'

describe('clipStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useClipStore.setState({ session: null })
  })

  it('starts with no session', () => {
    expect(useClipStore.getState().session).toBeNull()
  })

  it('open records the channel the capture comes from', () => {
    useClipStore.getState().open('42', 'Sportsnet')
    expect(useClipStore.getState().session).toEqual({ channelId: '42', channelName: 'Sportsnet' })
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

  it('is never saved', () => {
    vi.mocked(localStorage.setItem).mockClear()
    useClipStore.getState().open('42', 'Sportsnet')
    expect(localStorage.setItem).not.toHaveBeenCalled()
  })
})
