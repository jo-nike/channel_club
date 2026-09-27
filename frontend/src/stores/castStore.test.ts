import { describe, it, expect, beforeEach, vi } from 'vitest'
import { INITIAL_CAST_STATE, useCastStore } from './castStore'

describe('castStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useCastStore.setState(INITIAL_CAST_STATE)
  })

  it('starts loading, with nothing connected, cast or failed', () => {
    expect(useCastStore.getState()).toMatchObject({
      isLoading: true,
      isAvailable: false,
      isConnected: false,
      isCasting: false,
      deviceName: null,
      playerState: null,
      lastError: null,
    })
  })

  it('reportError records the message and when it happened', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1234)
    useCastStore.getState().reportError('Failed to connect to Chromecast')
    expect(useCastStore.getState().lastError).toEqual({ message: 'Failed to connect to Chromecast', at: 1234 })
    now.mockRestore()
  })

  it('the same message reported twice is a new error each time', () => {
    useCastStore.getState().reportError('Failed to connect to Chromecast')
    const first = useCastStore.getState().lastError
    useCastStore.getState().reportError('Failed to connect to Chromecast')
    expect(useCastStore.getState().lastError).not.toBe(first)
  })

  it('is never saved', () => {
    vi.mocked(localStorage.setItem).mockClear()
    useCastStore.setState({ isCasting: true, deviceName: 'Living Room' })
    useCastStore.getState().reportError('Failed to connect to Chromecast')
    expect(localStorage.setItem).not.toHaveBeenCalled()
  })
})
