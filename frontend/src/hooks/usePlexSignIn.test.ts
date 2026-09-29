import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { StrictMode } from 'react'
import { renderHook, act, waitFor } from '@/test/utils'
import { usePlexSignIn, type UsePlexSignInOptions } from './usePlexSignIn'
import * as plexAuth from '@/services/plexAuth'

// The popup flow is faked; the redirect flow runs for real against a faked fetch
vi.mock('@/services/plexAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/plexAuth')>()),
  authenticateWithPlex: vi.fn(),
  openPlexAuthWindow: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

/** Stand-in for the window returned by openPlexAuthWindow. */
const plexWindow = { closed: false, close: vi.fn() } as unknown as Window

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

function makeOptions(overrides: Partial<UsePlexSignInOptions> = {}) {
  return {
    onToken: vi.fn<UsePlexSignInOptions['onToken']>().mockResolvedValue(undefined),
    onError: vi.fn<UsePlexSignInOptions['onError']>(),
    onStart: vi.fn(),
    onBeforeRedirect: vi.fn(),
    ...overrides,
  }
}

/** Behaves like the real popup flow: pending until the signal aborts, then 'cancelled'. */
function pendingUntilAborted() {
  const signals: AbortSignal[] = []
  vi.mocked(plexAuth.authenticateWithPlex).mockImplementationOnce((_popup, signal) => {
    if (signal) signals.push(signal)
    return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        reject(new plexAuth.PlexAuthError('cancelled', 'Authentication cancelled'))
      })
    })
  })
  return signals
}

function pinStatus(authToken: string | null): Response {
  return { ok: true, json: () => Promise.resolve({ authToken }) } as Response
}

describe('usePlexSignIn', () => {
  const originalLocation = window.location
  let assign: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(plexAuth.openPlexAuthWindow).mockReturnValue(plexWindow)
    assign = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, origin: 'https://club.example', assign },
      writable: true,
      configurable: true,
    })
    vi.stubGlobal('fetch', vi.fn())
    sessionStorage.clear()
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    })
    Reflect.deleteProperty(navigator, 'userAgent')
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  describe('popup sign-in', () => {
    it('opens the Plex window inside start(), before anything is awaited', () => {
      vi.mocked(plexAuth.authenticateWithPlex).mockReturnValueOnce(new Promise(() => {}))
      const { result } = renderHook(() => usePlexSignIn(makeOptions()))

      act(() => {
        void result.current.start()
      })

      expect(plexAuth.openPlexAuthWindow).toHaveBeenCalledTimes(1)
      expect(plexAuth.authenticateWithPlex).toHaveBeenCalledWith(plexWindow, expect.any(AbortSignal))
      expect(result.current.waiting).toBe(true)
    })

    it('hands the token and a live signal to onToken, then stops waiting', async () => {
      vi.mocked(plexAuth.authenticateWithPlex).mockResolvedValueOnce('plex-token')
      const options = makeOptions()
      const { result } = renderHook(() => usePlexSignIn(options))

      await act(() => result.current.start())

      expect(options.onStart).toHaveBeenCalledTimes(1)
      expect(options.onToken).toHaveBeenCalledWith('plex-token', expect.any(AbortSignal))
      expect(options.onToken.mock.calls[0][1].aborted).toBe(false)
      expect(options.onError).not.toHaveBeenCalled()
      expect(result.current.waiting).toBe(false)
    })

    it('reports a blocked window as popup_blocked, after onStart, and starts no flow', async () => {
      vi.mocked(plexAuth.openPlexAuthWindow).mockReturnValueOnce(null)
      const options = makeOptions()
      const { result } = renderHook(() => usePlexSignIn(options))

      await act(() => result.current.start())

      expect(options.onError).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'PlexAuthError', code: 'popup_blocked' })
      )
      // onStart clears old errors, so it must not run after this one
      expect(options.onStart.mock.invocationCallOrder[0]).toBeLessThan(
        options.onError.mock.invocationCallOrder[0]
      )
      expect(plexAuth.authenticateWithPlex).not.toHaveBeenCalled()
      expect(result.current.waiting).toBe(false)
    })

    it('passes a Plex failure on as the PlexAuthError itself', async () => {
      const failure = new plexAuth.PlexAuthError('timeout', 'Authentication timed out')
      vi.mocked(plexAuth.authenticateWithPlex).mockRejectedValueOnce(failure)
      const options = makeOptions()
      const { result } = renderHook(() => usePlexSignIn(options))

      await act(() => result.current.start())

      expect(options.onError).toHaveBeenCalledWith(failure)
      expect(result.current.waiting).toBe(false)
    })

    it('reports a failure thrown by onToken by its message', async () => {
      vi.mocked(plexAuth.authenticateWithPlex).mockResolvedValueOnce('plex-token')
      const options = makeOptions({
        onToken: vi.fn().mockRejectedValue(new Error('No access to Plex server')),
      })
      const { result } = renderHook(() => usePlexSignIn(options))

      await act(() => result.current.start())

      expect(options.onError).toHaveBeenCalledWith('No access to Plex server')
      expect(result.current.waiting).toBe(false)
    })

    it('treats a closed Plex window as no error', async () => {
      vi.mocked(plexAuth.authenticateWithPlex).mockRejectedValueOnce(
        new plexAuth.PlexAuthError('cancelled', 'Authentication cancelled')
      )
      const options = makeOptions()
      const { result } = renderHook(() => usePlexSignIn(options))

      await act(() => result.current.start())

      expect(options.onError).not.toHaveBeenCalled()
      expect(options.onToken).not.toHaveBeenCalled()
      expect(result.current.waiting).toBe(false)
    })

    it('Cancel aborts the flow and stops waiting, with no error', async () => {
      const signals = pendingUntilAborted()
      const options = makeOptions()
      const { result } = renderHook(() => usePlexSignIn(options))
      act(() => {
        void result.current.start()
      })

      act(() => result.current.cancel())
      // Let the cancelled flow settle
      await act(async () => {})

      expect(signals[0].aborted).toBe(true)
      expect(result.current.waiting).toBe(false)
      expect(options.onError).not.toHaveBeenCalled()
    })

    it('aborts the signal onToken holds when Cancel is pressed during it', async () => {
      vi.mocked(plexAuth.authenticateWithPlex).mockResolvedValueOnce('plex-token')
      let finish!: () => void
      const options = makeOptions({
        onToken: vi.fn(() => new Promise<void>((done) => { finish = done })),
      })
      const { result } = renderHook(() => usePlexSignIn(options))
      act(() => {
        void result.current.start()
      })
      await waitFor(() => expect(options.onToken).toHaveBeenCalled())

      act(() => result.current.cancel())
      await act(async () => finish())

      expect(options.onToken.mock.calls[0][1].aborted).toBe(true)
      expect(result.current.waiting).toBe(false)
      expect(options.onError).not.toHaveBeenCalled()
    })

    it('reports nothing when onToken fails after Cancel (its request was aborted)', async () => {
      vi.mocked(plexAuth.authenticateWithPlex).mockResolvedValueOnce('plex-token')
      let fail!: (err: Error) => void
      const options = makeOptions({
        onToken: vi.fn(() => new Promise<void>((_done, reject) => { fail = reject })),
      })
      const { result } = renderHook(() => usePlexSignIn(options))
      act(() => {
        void result.current.start()
      })
      await waitFor(() => expect(options.onToken).toHaveBeenCalled())

      act(() => result.current.cancel())
      await act(async () => fail(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })))

      expect(options.onError).not.toHaveBeenCalled()
      expect(result.current.waiting).toBe(false)
    })

    it('aborts the flow in progress on unmount', () => {
      const signals = pendingUntilAborted()
      const { result, unmount } = renderHook(() => usePlexSignIn(makeOptions()))
      act(() => {
        void result.current.start()
      })

      unmount()

      expect(signals[0].aborted).toBe(true)
    })
  })

  describe('redirect sign-in on iPhones, iPads and installed apps', () => {
    beforeEach(() => {
      Object.defineProperty(navigator, 'userAgent', { value: IPHONE, configurable: true })
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 42, code: 'PINCODE', authToken: null }),
      } as Response)
    })

    function forwardUrl() {
      const url = new URL(assign.mock.calls[0][0] as string)
      return new URLSearchParams(url.hash.slice(2)).get('forwardUrl')
    }

    it('calls onBeforeRedirect, then sends the page to Plex with forwardUrl back to returnPath', async () => {
      const options = makeOptions({ returnPath: '/setup' })
      const { result } = renderHook(() => usePlexSignIn(options))

      await act(() => result.current.start())

      expect(options.onStart).toHaveBeenCalledTimes(1)
      expect(options.onBeforeRedirect).toHaveBeenCalledTimes(1)
      expect(assign).toHaveBeenCalledTimes(1)
      expect(options.onBeforeRedirect.mock.invocationCallOrder[0]).toBeLessThan(assign.mock.invocationCallOrder[0])
      expect(forwardUrl()).toBe('https://club.example/setup')
      expect(sessionStorage.getItem(plexAuth.PLEX_PENDING_PIN_KEY)).toBe('42')
      expect(plexAuth.openPlexAuthWindow).not.toHaveBeenCalled()
      // Stays waiting while the page leaves
      expect(result.current.waiting).toBe(true)
    })

    it('sends the page back to the app root without a returnPath', async () => {
      const { result } = renderHook(() => usePlexSignIn(makeOptions()))

      await act(() => result.current.start())

      expect(forwardUrl()).toBe('https://club.example/')
    })

    it('reports a refused PIN and stays on the page', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 429 } as Response)
      const options = makeOptions()
      const { result } = renderHook(() => usePlexSignIn(options))

      await act(() => result.current.start())

      expect(options.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'rate_limited' }))
      expect(assign).not.toHaveBeenCalled()
      expect(result.current.waiting).toBe(false)
    })
  })

  describe('coming back from the redirect', () => {
    beforeEach(() => {
      vi.mocked(fetch).mockResolvedValue(pinStatus('plex-token'))
    })

    it('starts waiting, takes the pending PIN and hands its token to onToken', async () => {
      sessionStorage.setItem(plexAuth.PLEX_PENDING_PIN_KEY, '42')
      const options = makeOptions()
      const { result } = renderHook(() => usePlexSignIn(options))

      expect(result.current.waiting).toBe(true)
      expect(sessionStorage.getItem(plexAuth.PLEX_PENDING_PIN_KEY)).toBeNull()
      await waitFor(() => expect(result.current.waiting).toBe(false))
      expect(fetch).toHaveBeenCalledWith('https://plex.tv/api/v2/pins/42', expect.anything())
      expect(options.onToken).toHaveBeenCalledWith('plex-token', expect.any(AbortSignal))
      expect(options.onError).not.toHaveBeenCalled()
    })

    it('hands the token over once under StrictMode, whose re-run finds the key already gone', async () => {
      sessionStorage.setItem(plexAuth.PLEX_PENDING_PIN_KEY, '42')
      const options = makeOptions()

      renderHook(() => usePlexSignIn(options), { wrapper: StrictMode })

      await waitFor(() => expect(options.onToken).toHaveBeenCalled())
      // Let StrictMode's aborted first run settle before counting
      await act(() => new Promise((done) => setTimeout(done, 0)))
      expect(options.onToken).toHaveBeenCalledTimes(1)
      expect(options.onError).not.toHaveBeenCalled()
    })

    it('does nothing on mount without a pending PIN', () => {
      const options = makeOptions()
      const { result } = renderHook(() => usePlexSignIn(options))

      expect(result.current.waiting).toBe(false)
      expect(fetch).not.toHaveBeenCalled()
    })

    it('finishes a PIN left pending when the browser restores the page, calling onStart first', async () => {
      const options = makeOptions()
      const { result } = renderHook(() => usePlexSignIn(options))
      sessionStorage.setItem(plexAuth.PLEX_PENDING_PIN_KEY, '42')

      act(() => {
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
      })

      expect(options.onStart).toHaveBeenCalledTimes(1)
      expect(result.current.waiting).toBe(true)
      await waitFor(() => expect(options.onToken).toHaveBeenCalledWith('plex-token', expect.any(AbortSignal)))
      await waitFor(() => expect(result.current.waiting).toBe(false))
      expect(sessionStorage.getItem(plexAuth.PLEX_PENDING_PIN_KEY)).toBeNull()
    })
  })
})
