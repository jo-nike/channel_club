import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@/test/utils'
import { useSystemStatus } from './useSystemStatus'

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ token: 'synthetic-token' }) }))

/** A status response the test sends when it chooses */
function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((res) => { resolve = res })
  return { promise, resolve }
}

describe('useSystemStatus', () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('skips a poll while the previous status request is still in flight', async () => {
    const slow = deferred()
    fetchMock.mockReturnValueOnce(slow.promise)
    const { result } = renderHook(() => useSystemStatus())
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => { vi.advanceTimersByTime(30_000) })
    await act(async () => { result.current.refetch() })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => { slow.resolve(new Response(JSON.stringify({}), { status: 200 })) })
    fetchMock.mockReturnValueOnce(new Promise(() => {}))
    await act(async () => { vi.advanceTimersByTime(30_000) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
