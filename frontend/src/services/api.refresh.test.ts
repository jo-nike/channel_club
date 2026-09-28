import { afterEach, describe, expect, it, vi } from 'vitest'
import { refreshSession } from './api'

afterEach(() => { vi.unstubAllGlobals() })

describe('refreshSession', () => {
  it('posts the current token and returns the new token and role', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ accessToken: 'new-token', tokenType: 'bearer', role: 'viewer' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(refreshSession('old-token')).resolves.toEqual({ ok: true, token: 'new-token', role: 'viewer' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/auth/refresh')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer old-token')
  })

  it('reports a 401 as an expired sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    await expect(refreshSession('old-token')).resolves.toEqual({ ok: false, reason: 'expired' })
  })

  it.each([429, 500, 503])('reports %s as temporary', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })))
    await expect(refreshSession('old-token')).resolves.toEqual({ ok: false, reason: 'temporary' })
  })

  it('reports a network error as temporary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(refreshSession('old-token')).resolves.toEqual({ ok: false, reason: 'temporary' })
  })

  it('reports a malformed success body as temporary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ role: 'viewer' })))
    await expect(refreshSession('old-token')).resolves.toEqual({ ok: false, reason: 'temporary' })
  })
})
