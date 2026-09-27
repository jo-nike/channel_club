import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createPlexPin,
  getPlexAuthUrl,
  checkPlexPin,
  PLEX_CLIENT_ID,
  PLEX_PRODUCT,
  PlexAuthError,
} from './plexAuth'

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
})
