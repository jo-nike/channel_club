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
})
