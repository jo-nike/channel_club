import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useAuthStore } from '@/stores/authStore'
import { logger } from '@/lib/logger'
import {
  claimSetup,
  completeSetup,
  getAdminConfig,
  getPlexMembers,
  getSetupStatus,
  linkPlexServer,
  listPlexServers,
  SetupApiError,
  testConnection,
  updateAdminConfig,
} from './setupApi'

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Stand-ins for secrets (spaced or short, so no scanner takes them for real ones)
const PASS = 'correct horse battery'
const PLEX = 'plex sign in'
const APIKEY = 'api key one'
const SESSION = 'jwt-1'

function reply(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => (body === undefined ? Promise.reject(new SyntaxError('Unexpected end of JSON input')) : Promise.resolve(body)),
  } as Response
}

function lastRequest() {
  const [url, init = {}] = vi.mocked(fetch).mock.calls[vi.mocked(fetch).mock.calls.length - 1]
  return {
    url,
    method: init.method ?? 'GET',
    headers: (init.headers ?? {}) as Record<string, string>,
    body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    signal: init.signal,
  }
}

/** What a call throws, for checking its fields. */
async function failure(call: Promise<unknown>): Promise<SetupApiError> {
  const err = await call.then(() => null, (e: unknown) => e)
  expect(err).toBeInstanceOf(SetupApiError)
  return err as SetupApiError
}

describe('setupApi', () => {
  const logout = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
    useAuthStore.setState({ token: null, role: null, isAuthenticated: false, logout })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  function signedIn() {
    localStorage.setItem('token', SESSION)
    useAuthStore.setState({ token: SESSION, role: 'admin', isAuthenticated: true })
  }

  describe('public setup calls', () => {
    it('reads the setup status without a session, even when signed in', async () => {
      signedIn()
      const status = { setupState: 'unclaimed', envLocked: [{ env: 'DISPATCHARR_URL', field: 'dispatcharrUrl' }] }
      vi.mocked(fetch).mockResolvedValueOnce(reply(200, status))

      expect(await getSetupStatus()).toEqual(status)
      const request = lastRequest()
      expect(request.url).toBe('/api/setup/status')
      expect(request.method).toBe('GET')
      expect(request.headers.Authorization).toBeUndefined()
    })

    it('claims with the account request and no session, returning the token', async () => {
      const token = { accessToken: 'jwt-2', tokenType: 'bearer', role: 'admin' }
      vi.mocked(fetch).mockResolvedValueOnce(reply(200, token))

      expect(await claimSetup({ method: 'password', username: 'jon', password: PASS })).toEqual(token)
      const request = lastRequest()
      expect(request.url).toBe('/api/setup/account')
      expect(request.method).toBe('POST')
      expect(request.headers).toEqual({ 'Content-Type': 'application/json' })
      expect(request.body).toEqual({ method: 'password', username: 'jon', password: PASS })
    })

    it('claims with Plex by sending the token and the chosen server', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(reply(200, { accessToken: 'jwt-2', tokenType: 'bearer', role: 'admin' }))

      await claimSetup({ method: 'plex', authToken: PLEX, machineId: 'abc123' })

      expect(lastRequest().body).toEqual({ method: 'plex', authToken: PLEX, machineId: 'abc123' })
    })

    it("gives a lost claim race the server's code", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        reply(409, { detail: { code: 'already_claimed', message: 'Channel Club has already been claimed' } })
      )

      const err = await failure(claimSetup({ method: 'password', username: 'jon', password: PASS }))

      expect(err.status).toBe(409)
      expect(err.code).toBe('already_claimed')
      expect(err.message).toBe('Channel Club has already been claimed')
    })

    it('maps a 422 to the settings named by the last part of each loc', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(reply(422, {
        detail: [
          { loc: ['body', 'password', 'username'], msg: 'String should match pattern', type: 'string_pattern_mismatch' },
          { loc: ['body', 'password', 'password'], msg: 'String should have at least 12 characters', type: 'string_too_short' },
          { loc: ['body', 'password', 'password'], msg: 'A second message for the same setting', type: 'x' },
        ],
      }))

      const err = await failure(claimSetup({ method: 'password', username: ' jon', password: 'short' }))

      expect(err.status).toBe(422)
      expect(err.fieldErrors).toEqual({
        username: 'String should match pattern',
        password: 'String should have at least 12 characters',
      })
      expect(err.code).toBe('string_pattern_mismatch')
      expect(err.message).toBe('String should match pattern')
    })

    it('lists Plex servers with the Plex token, and no session when signed out', async () => {
      const servers = { account: { username: 'jon' }, servers: [{ machineId: 'abc123', name: 'Home', online: true }] }
      vi.mocked(fetch).mockResolvedValueOnce(reply(200, servers))

      expect(await listPlexServers(PLEX)).toEqual(servers)
      const request = lastRequest()
      expect(request.url).toBe('/api/setup/plex/servers')
      expect(request.method).toBe('POST')
      expect(request.body).toEqual({ authToken: PLEX })
      expect(request.headers.Authorization).toBeUndefined()
    })

    it('lists Plex servers with the session once signed in (an admin linking Plex later)', async () => {
      signedIn()
      vi.mocked(fetch).mockResolvedValueOnce(reply(200, { account: { username: 'jon' }, servers: [] }))

      await listPlexServers(PLEX)

      expect(lastRequest().headers.Authorization).toBe(`Bearer ${SESSION}`)
    })

    it('reports a Plex token Plex refused as plex_token', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        reply(400, { detail: { code: 'plex_token', message: "Plex didn't accept that sign-in" } })
      )

      const err = await failure(listPlexServers(PLEX))

      expect(err.status).toBe(400)
      expect(err.code).toBe('plex_token')
    })

    it('never signs this browser out on a 401 from a setup call', async () => {
      signedIn()
      vi.mocked(fetch).mockResolvedValueOnce(reply(401, { detail: 'Not authenticated' }))

      const err = await failure(listPlexServers(PLEX))

      expect(err.status).toBe(401)
      expect(err.message).toBe('Not authenticated')
      expect(logout).not.toHaveBeenCalled()
    })
  })

  describe('admin calls', () => {
    beforeEach(signedIn)

    it.each([
      ['getAdminConfig', () => getAdminConfig(), '/api/admin/config', 'GET', undefined],
      ['updateAdminConfig', () => updateAdminConfig({ chatEnabled: true, dispatcharrApiKey: null }),
        '/api/admin/config', 'PUT', { chatEnabled: true, dispatcharrApiKey: null }],
      ['testConnection', () => testConnection('dispatcharr', { dispatcharrUrl: 'http://tv.lan:9191' }),
        '/api/admin/config/test', 'POST', { kind: 'dispatcharr', values: { dispatcharrUrl: 'http://tv.lan:9191' } }],
      ['getPlexMembers', () => getPlexMembers(), '/api/admin/plex/members', 'GET', undefined],
      ['linkPlexServer', () => linkPlexServer({ authToken: PLEX, machineId: 'abc123' }),
        '/api/admin/plex/server', 'POST', { authToken: PLEX, machineId: 'abc123' }],
      ['completeSetup', () => completeSetup(), '/api/setup/complete', 'POST', undefined],
    ] as const)('%s sends its request with the session', async (_name, call, url, method, body) => {
      vi.mocked(fetch).mockResolvedValueOnce(reply(200, { ok: true }))

      expect(await call()).toEqual({ ok: true })
      const request = lastRequest()
      expect(request.url).toBe(url)
      expect(request.method).toBe(method)
      expect(request.body).toEqual(body)
      expect(request.headers.Authorization).toBe(`Bearer ${SESSION}`)
    })

    it.each([
      ['getAdminConfig', () => getAdminConfig()],
      ['updateAdminConfig', () => updateAdminConfig({ chatEnabled: true })],
      ['completeSetup', () => completeSetup()],
    ] as const)('%s signs this browser out on a 401 and says the session ended', async (_name, call) => {
      vi.mocked(fetch).mockResolvedValueOnce(reply(401, { detail: 'Could not validate credentials' }))

      const err = await failure(call())

      expect(logout).toHaveBeenCalledTimes(1)
      expect(err.status).toBe(401)
      expect(err.code).toBe('session_expired')
    })

    it('passes a plain detail on as the message (a viewer asking)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(reply(403, { detail: 'Admin access required' }))

      const err = await failure(getAdminConfig())

      expect(err.status).toBe(403)
      expect(err.code).toBeUndefined()
      expect(err.message).toBe('Admin access required')
    })

    it('reports a setting the environment locks with the setting and its variables', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(reply(409, {
        detail: {
          code: 'locked',
          message: "Set by DISPATCHARR_URL in the server's environment",
          field: 'dispatcharrUrl',
          env: ['DISPATCHARR_URL'],
        },
      }))

      const err = await failure(updateAdminConfig({ dispatcharrUrl: 'http://tv.lan' }))

      expect(err.code).toBe('locked')
      expect(err.field).toBe('dispatcharrUrl')
      expect(err.env).toEqual(['DISPATCHARR_URL'])
    })

    it("maps the server's own 422 codes to their setting, without Pydantic's prefix", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(reply(422, {
        detail: [
          { loc: ['body', 'dispatcharrApiKey'], msg: 'Enter it again for the new address', type: 'secret_required' },
          { loc: ['body', 'ziplineUrl'], msg: 'Value error, Use an http:// or https:// address', type: 'value_error' },
          { loc: ['body', 'plexAdminIds', 0], msg: 'String should match pattern', type: 'string_pattern_mismatch' },
        ],
      }))

      const err = await failure(updateAdminConfig({ dispatcharrUrl: 'http://new.lan' }))

      expect(err.code).toBe('secret_required')
      expect(err.fieldErrors).toEqual({
        dispatcharrApiKey: 'Enter it again for the new address',
        ziplineUrl: 'Use an http:// or https:// address',
        plexAdminIds: 'String should match pattern',
      })
    })

    it('keeps a 422 with no setting as the message only', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        reply(422, { detail: [{ loc: ['body'], msg: 'JSON decode error', type: 'json_invalid' }] })
      )

      const err = await failure(updateAdminConfig({ chatEnabled: true }))

      expect(err.fieldErrors).toEqual({})
      expect(err.message).toBe('JSON decode error')
    })

    it('falls back to its own message when the body is not JSON', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(reply(502))

      const err = await failure(updateAdminConfig({ chatEnabled: true }))

      expect(err.status).toBe(502)
      expect(err.message).toBe("Couldn't save the settings")
    })

    it('returns a failed test as a result, not an error', async () => {
      const result = { ok: false, reason: 'auth', counts: {} }
      vi.mocked(fetch).mockResolvedValueOnce(reply(200, result))

      expect(await testConnection('dispatcharr', { dispatcharrApiKey: APIKEY })).toEqual(result)
    })

    it('gives up on a test that hangs for 30 s with a timeout error', async () => {
      vi.useFakeTimers()
      vi.mocked(fetch).mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      }))

      const outcome = testConnection('ersatztv', {}).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(30_000)

      const err = await outcome
      expect(err).toBeInstanceOf(SetupApiError)
      expect(err).toMatchObject({ status: 0, code: 'timeout' })
    })

    it("passes the caller's abort through as an AbortError", async () => {
      vi.mocked(fetch).mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      }))
      const controller = new AbortController()

      const outcome = testConnection('ersatztv', {}, controller.signal).catch((e: unknown) => e)
      controller.abort()

      expect(await outcome).toMatchObject({ name: 'AbortError' })
    })
  })

  it("says it couldn't reach the server when the request never got there", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const err = await failure(getSetupStatus())

    expect(err.status).toBe(0)
    expect(err.code).toBe('network')
    expect(err.message).toBe("Couldn't reach Channel Club's server.")
  })

  it('never logs a password, key or token, whether the call works or fails', async () => {
    signedIn()
    const calls = [
      () => claimSetup({ method: 'password', username: 'jon', password: PASS }),
      () => claimSetup({ method: 'plex', authToken: PLEX, machineId: 'abc123' }),
      () => listPlexServers(PLEX),
      () => updateAdminConfig({ dispatcharrApiKey: APIKEY, adminPassword: PASS }),
      () => testConnection('dispatcharr', { dispatcharrApiKey: APIKEY }),
      () => linkPlexServer({ authToken: PLEX, machineId: 'abc123' }),
    ]
    for (const status of [200, 400, 422, 500]) {
      for (const call of calls) {
        vi.mocked(fetch).mockResolvedValueOnce(reply(status, status === 200 ? { ok: true } : { detail: 'Refused' }))
        await call().catch(() => {})
      }
    }

    const logged = JSON.stringify(Object.values(vi.mocked(logger)).flatMap((fn) => vi.mocked(fn).mock.calls))
    expect(logged).not.toContain(PASS)
    expect(logged).not.toContain(PLEX)
    expect(logged).not.toContain(APIKEY)
    expect(logged).not.toContain(SESSION)
  })
})
