import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@/test/utils'
import { useHighlightStatus } from './useHighlightStatus'
import type { HighlightStatusResponse } from '@/services/api'

const api = vi.hoisted(() => ({
  getHighlightStatus: vi.fn<(channelId: string, signal?: AbortSignal) => Promise<HighlightStatusResponse>>(),
}))
vi.mock('@/services/api', () => ({ getHighlightStatus: api.getHighlightStatus }))

const recording: HighlightStatusResponse = {
  enabled: true, recording: true, ready: true, bufferSeconds: 42, maxBufferSeconds: 60,
}

/** A status request the test answers when it chooses */
function deferred() {
  let resolve!: (status: HighlightStatusResponse) => void
  let reject!: (error: Error) => void
  const promise = new Promise<HighlightStatusResponse>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useHighlightStatus', () => {
  beforeEach(() => {
    api.getHighlightStatus.mockReset()
  })

  it('is not loaded until the first poll answers', () => {
    api.getHighlightStatus.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useHighlightStatus('7'))

    expect(result.current.loaded).toBe(false)
    expect(result.current.status.recording).toBe(false)
  })

  it('is loaded with the server status once the poll succeeds', async () => {
    const request = deferred()
    api.getHighlightStatus.mockReturnValue(request.promise)
    const { result } = renderHook(() => useHighlightStatus('7'))

    await act(async () => request.resolve(recording))

    expect(result.current).toEqual({ status: recording, loaded: true })
  })

  it('is loaded, as not recording, once the poll fails', async () => {
    const request = deferred()
    api.getHighlightStatus.mockReturnValue(request.promise)
    const { result } = renderHook(() => useHighlightStatus('7'))

    await act(async () => request.reject(new Error('offline')))

    expect(result.current.loaded).toBe(true)
    expect(result.current.status.recording).toBe(false)
  })

  it('is not loaded again after a channel switch until the new channel answers', async () => {
    const first = deferred()
    const second = deferred()
    api.getHighlightStatus.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result, rerender } = renderHook(({ channel }) => useHighlightStatus(channel), {
      initialProps: { channel: '7' },
    })
    await act(async () => first.resolve(recording))
    expect(result.current.loaded).toBe(true)

    rerender({ channel: '8' })

    expect(result.current.loaded).toBe(false)
    await act(async () => second.resolve({ ...recording, bufferSeconds: 5 }))
    expect(result.current).toEqual({ status: { ...recording, bufferSeconds: 5 }, loaded: true })
  })

  it('does not poll, and is not loaded, without a channel', () => {
    const { result } = renderHook(() => useHighlightStatus(undefined))

    expect(result.current.loaded).toBe(false)
    expect(api.getHighlightStatus).not.toHaveBeenCalled()
  })
})
