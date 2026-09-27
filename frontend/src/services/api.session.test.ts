import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithAuth } from './api'
import { useAuthStore } from '@/stores/authStore'

afterEach(() => { vi.unstubAllGlobals(); useAuthStore.getState().logout() })
describe('FE-04 request session ownership', () => {
  it.each(['new-token', 'old-token'])('preserves a replacement login using %s', async (replacement) => {
    useAuthStore.getState().setAuth('old-token', 'admin')
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve })))
    const request = fetchWithAuth('/channels')
    useAuthStore.getState().logout()
    useAuthStore.getState().setAuth(replacement, 'viewer')
    finish(new Response(null, { status: 401 }))
    await expect(request).rejects.toThrow('Session expired')
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(localStorage.getItem('token')).toBe(replacement)
  })
  it('expires the session that actually owns the rejected request', async () => {
    useAuthStore.getState().setAuth('current', 'viewer')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    await expect(fetchWithAuth('/channels')).rejects.toThrow('Session expired')
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
  it('sends the in-memory token when site storage is blocked', async () => {
    const realStorage = window.localStorage
    const blocked = () => { throw new DOMException('The operation is insecure.', 'SecurityError') }
    Object.defineProperty(window, 'localStorage', {
      value: { getItem: blocked, setItem: blocked, removeItem: blocked, clear: blocked },
      writable: true,
    })
    try {
      useAuthStore.getState().setAuth('page-only', 'viewer')
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
      vi.stubGlobal('fetch', fetchMock)
      await expect(fetchWithAuth('/channels')).rejects.toThrow('Session expired')
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer page-only')
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
    } finally {
      Object.defineProperty(window, 'localStorage', { value: realStorage, writable: true })
    }
  })
})
