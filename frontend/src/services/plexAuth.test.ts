import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  authenticateWithPlex,
  openPlexAuthWindow,
  createPlexPin,
  getPlexAuthUrl,
  checkPlexPin,
  PLEX_CLIENT_ID,
  PLEX_PRODUCT,
  PlexAuthError,
} from './plexAuth'

/** Stand-in for the window returned by window.open. */
function fakePopup() {
  const popup = {
    closed: false,
    location: { href: 'about:blank' },
    close: vi.fn(() => {
      popup.closed = true
    }),
  }
  return popup
}

const PIN = { id: 42, code: 'PINCODE', authToken: null }

function pinResponse(): Response {
  return { ok: true, json: () => Promise.resolve(PIN) } as Response
}

function tokenResponse(authToken: string | null): Response {
  return { ok: true, json: () => Promise.resolve({ authToken }) } as Response
}

describe('plexAuth', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createPlexPin', () => {
    it('creates a PIN by calling Plex API', async () => {
      const mockPin = {
        id: 123456,
        code: 'ABC123',
        authToken: null,
      }

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPin),
      } as Response)

      const pin = await createPlexPin()

      expect(fetch).toHaveBeenCalledWith(
        'https://plex.tv/api/v2/pins',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Accept: 'application/json',
            'X-Plex-Product': PLEX_PRODUCT,
            'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
          }),
        })
      )
      expect(pin).toEqual(mockPin)
    })

    it('throws error when API call fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response)

      await expect(createPlexPin()).rejects.toThrow('Failed to create Plex PIN')
    })

    it('throws a pin_failed PlexAuthError when Plex refuses the PIN', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500 } as Response)

      const err = await createPlexPin().catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PlexAuthError)
      expect(err).toHaveProperty('code', 'pin_failed')
    })

    it('throws a rate_limited PlexAuthError on 429', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 429 } as Response)

      const err = await createPlexPin().catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PlexAuthError)
      expect(err).toHaveProperty('code', 'rate_limited')
    })
  })

  describe('getPlexAuthUrl', () => {
    it('returns correct Plex auth URL with PIN code', () => {
      const pin = {
        id: 123456,
        code: 'ABC123',
        authToken: null,
      }

      const url = getPlexAuthUrl(pin)

      expect(url).toContain('https://app.plex.tv/auth#?')
      expect(url).toContain(`clientID=${PLEX_CLIENT_ID}`)
      expect(url).toContain('code=ABC123')
      // URLSearchParams encodes spaces as + not %20
      expect(url).toContain('context%5Bdevice%5D%5Bproduct%5D=Channel+Club')
    })
  })

  describe('checkPlexPin', () => {
    it('returns authToken when PIN is authenticated', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ authToken: 'plex-auth-token-123' }),
      } as Response)

      const token = await checkPlexPin(123456)

      expect(fetch).toHaveBeenCalledWith(
        'https://plex.tv/api/v2/pins/123456',
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'application/json',
            'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
          }),
        })
      )
      expect(token).toBe('plex-auth-token-123')
    })

    it('returns null when PIN is not yet authenticated', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ authToken: null }),
      } as Response)

      const token = await checkPlexPin(123456)

      expect(token).toBeNull()
    })

    it('throws error when API call fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response)

      await expect(checkPlexPin(123456)).rejects.toThrow('Failed to check Plex PIN')
    })

    it('throws PlexAuthError codes: pin_failed on failure, rate_limited on 429', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      await expect(checkPlexPin(1)).rejects.toMatchObject({ name: 'PlexAuthError', code: 'pin_failed' })

      vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 429 } as Response)
      await expect(checkPlexPin(1)).rejects.toMatchObject({ name: 'PlexAuthError', code: 'rate_limited' })
    })
  })
  describe('openPlexAuthWindow', () => {
    it('opens a blank PlexAuth window synchronously and returns it', () => {
      const win = {} as Window
      const open = vi.spyOn(window, 'open').mockReturnValue(win)

      const result = openPlexAuthWindow()

      // No await above: the call happened inside the same task as the click
      expect(open).toHaveBeenCalledWith('about:blank', 'PlexAuth', 'width=600,height=700')
      expect(result).toBe(win)
    })

    it('returns null when the browser blocks the window', () => {
      vi.spyOn(window, 'open').mockReturnValue(null)
      expect(openPlexAuthWindow()).toBeNull()
    })
  })

  describe('authenticateWithPlex', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('points the window at the Plex auth page only after the PIN resolves', async () => {
      vi.useFakeTimers()
      let respond!: (r: Response) => void
      vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((done) => { respond = done }))
      const popup = fakePopup()

      const outcome = authenticateWithPlex(popup as unknown as Window).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(0)
      expect(popup.location.href).toBe('about:blank')

      respond(pinResponse())
      await vi.advanceTimersByTimeAsync(0)
      expect(popup.location.href).toBe(getPlexAuthUrl(PIN))

      popup.close()
      await vi.advanceTimersByTimeAsync(2000)
      expect(await outcome).toMatchObject({ code: 'cancelled' })
    })

    it('resolves with the token and closes the window once Plex authorises the PIN', async () => {
      vi.useFakeTimers()
      vi.mocked(fetch)
        .mockResolvedValueOnce(pinResponse())
        .mockResolvedValueOnce(tokenResponse(null))
        .mockResolvedValueOnce(tokenResponse('plex-token'))
      const popup = fakePopup()

      const flow = authenticateWithPlex(popup as unknown as Window)
      await vi.advanceTimersByTimeAsync(4000)

      await expect(flow).resolves.toBe('plex-token')
      expect(popup.close).toHaveBeenCalled()
    })

    it('closes the window and rejects pin_failed when the PIN cannot be created', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      const popup = fakePopup()

      await expect(authenticateWithPlex(popup as unknown as Window)).rejects.toMatchObject({
        code: 'pin_failed',
      })
      expect(popup.close).toHaveBeenCalled()
      expect(popup.location.href).toBe('about:blank')
    })

    it('closes the window and rejects rate_limited on a 429', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 429 } as Response)
      const popup = fakePopup()

      const err = await authenticateWithPlex(popup as unknown as Window).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PlexAuthError)
      expect(err).toHaveProperty('code', 'rate_limited')
      expect(popup.close).toHaveBeenCalled()
    })

    it('rejects cancelled when the user closes the window', async () => {
      vi.useFakeTimers()
      vi.mocked(fetch).mockResolvedValueOnce(pinResponse()).mockResolvedValue(tokenResponse(null))
      const popup = fakePopup()

      const flow = authenticateWithPlex(popup as unknown as Window)
      const outcome = flow.catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(2000)
      popup.closed = true
      await vi.advanceTimersByTimeAsync(2000)

      expect(await outcome).toMatchObject({ name: 'PlexAuthError', code: 'cancelled' })
    })

    it('rejects cancelled and closes the window when the signal aborts', async () => {
      vi.useFakeTimers()
      vi.mocked(fetch).mockResolvedValueOnce(pinResponse()).mockResolvedValue(tokenResponse(null))
      const popup = fakePopup()
      const controller = new AbortController()

      const outcome = authenticateWithPlex(popup as unknown as Window, controller.signal)
        .catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(2000)
      expect(popup.close).not.toHaveBeenCalled()

      controller.abort()

      // Rejected straight away, without waiting for the next poll
      expect(await outcome).toMatchObject({ name: 'PlexAuthError', code: 'cancelled' })
      expect(popup.close).toHaveBeenCalled()
      const polls = vi.mocked(fetch).mock.calls.length
      await vi.advanceTimersByTimeAsync(10_000)
      expect(vi.mocked(fetch).mock.calls.length).toBe(polls)
    })

    it('rejects cancelled without loading Plex when aborted while the PIN is created', async () => {
      let respond!: (r: Response) => void
      vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((done) => { respond = done }))
      const popup = fakePopup()
      const controller = new AbortController()

      const outcome = authenticateWithPlex(popup as unknown as Window, controller.signal)
        .catch((e: unknown) => e)
      controller.abort()
      respond(pinResponse())

      expect(await outcome).toMatchObject({ name: 'PlexAuthError', code: 'cancelled' })
      expect(popup.close).toHaveBeenCalled()
      expect(popup.location.href).toBe('about:blank')
    })

    it('rejects timeout and closes the window after 5 minutes', async () => {
      vi.useFakeTimers()
      vi.mocked(fetch).mockResolvedValueOnce(pinResponse()).mockResolvedValue(tokenResponse(null))
      const popup = fakePopup()

      const flow = authenticateWithPlex(popup as unknown as Window)
      const outcome = flow.catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1)
      expect(popup.close).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)

      expect(await outcome).toMatchObject({ name: 'PlexAuthError', code: 'timeout' })
      expect(popup.close).toHaveBeenCalled()
    })
  })
})
