import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshAuth, startSessionRefresh, stopSessionRefresh } from './useAuth'
import { useAuthStore } from '@/stores/authStore'
import { refreshSession } from '@/services/api'

vi.mock('@/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api')>()),
  refreshSession: vi.fn(),
}))

const HOUR = 60 * 60 * 1000

function tokenExpiringIn(ms: number): string {
  return `header.${btoa(JSON.stringify({ sub: 'viewer', exp: Math.floor((Date.now() + ms) / 1000) }))}.signature`
}

// Let the awaited refresh settle under fake timers
const settle = () => vi.advanceTimersByTimeAsync(0)

describe('session refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(refreshSession).mockReset()
    useAuthStore.setState({ token: null, role: null, username: null, isAuthenticated: false, isInitializing: true })
  })

  afterEach(() => {
    stopSessionRefresh()
    vi.useRealTimers()
    useAuthStore.getState().logout()
  })

  describe('refreshAuth', () => {
    it('replaces the token in place on success', async () => {
      useAuthStore.getState().setAuth('old-token', 'admin')
      const { generation } = useAuthStore.getState()
      vi.mocked(refreshSession).mockResolvedValue({ ok: true, token: 'new-token', role: 'viewer' })

      await expect(refreshAuth()).resolves.toBe('refreshed')

      expect(refreshSession).toHaveBeenCalledWith('old-token')
      expect(useAuthStore.getState()).toMatchObject({ token: 'new-token', role: 'viewer', isAuthenticated: true, generation })
    })

    it('signs out on a 401', async () => {
      useAuthStore.getState().setAuth('old-token', 'viewer')
      vi.mocked(refreshSession).mockResolvedValue({ ok: false, reason: 'expired' })

      await expect(refreshAuth()).resolves.toBe('expired')

      expect(useAuthStore.getState().isAuthenticated).toBe(false)
    })

    it('keeps the current token on a temporary failure', async () => {
      useAuthStore.getState().setAuth('old-token', 'viewer')
      vi.mocked(refreshSession).mockResolvedValue({ ok: false, reason: 'temporary' })

      await expect(refreshAuth()).resolves.toBe('temporary')

      expect(useAuthStore.getState()).toMatchObject({ token: 'old-token', isAuthenticated: true })
    })

    it('does not touch a session that was replaced while it was in flight', async () => {
      useAuthStore.getState().setAuth('old-token', 'viewer')
      let finish!: (value: Awaited<ReturnType<typeof refreshSession>>) => void
      vi.mocked(refreshSession).mockReturnValue(new Promise((resolve) => { finish = resolve }))

      const pending = refreshAuth()
      useAuthStore.getState().setAuth('other-sign-in', 'admin')
      finish({ ok: false, reason: 'expired' })

      await expect(pending).resolves.toBe('superseded')
      expect(useAuthStore.getState()).toMatchObject({ token: 'other-sign-in', isAuthenticated: true })
    })
  })

  describe('schedule', () => {
    function restoreSession(token: string) {
      localStorage.setItem('token', token)
      localStorage.setItem('role', 'viewer')
      useAuthStore.getState().initialize()
    }

    it('refreshes once after a stored session is restored, then every 6 hours', async () => {
      vi.mocked(refreshSession).mockImplementation(async () => ({ ok: true, token: tokenExpiringIn(7 * 24 * HOUR), role: 'viewer' }))
      startSessionRefresh()

      restoreSession(tokenExpiringIn(5 * 24 * HOUR))
      await settle()
      expect(refreshSession).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(6 * HOUR - 1)
      expect(refreshSession).toHaveBeenCalledTimes(1)
      // The next check after 6 hours refreshes again
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
      expect(refreshSession).toHaveBeenCalledTimes(2)
    })

    it('does not refresh a fresh sign-in until it is due', async () => {
      useAuthStore.setState({ isInitializing: false })
      startSessionRefresh()
      useAuthStore.getState().setAuth(tokenExpiringIn(7 * 24 * HOUR), 'viewer')

      await vi.advanceTimersByTimeAsync(5 * HOUR)
      expect(refreshSession).not.toHaveBeenCalled()
    })

    it('refreshes at the next check when less than a day is left', async () => {
      useAuthStore.setState({ isInitializing: false })
      startSessionRefresh()
      useAuthStore.getState().setAuth(tokenExpiringIn(23 * HOUR), 'viewer')
      vi.mocked(refreshSession).mockResolvedValue({ ok: true, token: tokenExpiringIn(7 * 24 * HOUR), role: 'viewer' })

      await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
      expect(refreshSession).toHaveBeenCalledTimes(1)
    })

    it('retries a temporary failure at the next check and keeps the session', async () => {
      vi.mocked(refreshSession).mockResolvedValue({ ok: false, reason: 'temporary' })
      startSessionRefresh()

      const token = tokenExpiringIn(5 * 24 * HOUR)
      restoreSession(token)
      await settle()
      expect(refreshSession).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
      expect(refreshSession).toHaveBeenCalledTimes(2)
      expect(useAuthStore.getState()).toMatchObject({ token, isAuthenticated: true })
    })

    it('stops when asked', async () => {
      useAuthStore.setState({ isInitializing: false })
      startSessionRefresh()
      useAuthStore.getState().setAuth(tokenExpiringIn(HOUR), 'viewer')
      stopSessionRefresh()

      await vi.advanceTimersByTimeAsync(HOUR)
      expect(refreshSession).not.toHaveBeenCalled()
    })
  })
})
