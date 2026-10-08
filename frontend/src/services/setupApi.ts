import { logger } from '@/lib/logger'
import type {
  ConfigPatch,
  ConfigUpdate,
  ConfigView,
  ConnectionTestResult,
  PlexMember,
  PlexServerLink,
  PlexServersResponse,
  SetupAccountRequest,
  SetupFacts,
  SetupStatus,
  TestKind,
  TestValues,
} from '@/types/setup'
import { fetchWithAuth, getAuthToken, type TokenResponse } from './api'
import { API_URL } from './apiBase'

/*
 * The setup wizard's calls and the server settings'. Their bodies carry
 * passwords, API keys and Plex tokens, so no body is ever logged.
 */

const NETWORK_ERROR = "Couldn't reach Channel Club's server."
const SESSION_ENDED = 'Your session has ended. Sign in again.'
/** The server gives each check 5 s; this only stops a test request that hangs. */
const TEST_BACKSTOP_MS = 30_000
/** Pydantic puts this before the message of a ValueError raised in a validator. */
const VALUE_ERROR_PREFIX = 'Value error, '

interface SetupApiErrorDetails {
  code?: string
  fieldErrors?: Partial<Record<string, string>>
  field?: string
  env?: string[]
}

/** A setup or settings request that failed, with what the wizard needs to react to it. */
export class SetupApiError extends Error {
  /** The HTTP status; 0 when the server couldn't be reached or a test hung */
  readonly status: number
  /**
   * The server's code (e.g. 'already_claimed', 'locked', 'self_lockout',
   * 'plex_token'), a 422's first error type, or 'network', 'timeout' and
   * 'session_expired' from here. Undefined when the server sent only a message.
   */
  readonly code: string | undefined
  /** A 422's messages by setting (camelCase), the first for each */
  readonly fieldErrors: Partial<Record<string, string>>
  /** For a 409 'locked': the setting, and the variables that lock it */
  readonly field: string | undefined
  readonly env: string[] | undefined

  constructor(status: number, message: string, details: SetupApiErrorDetails = {}) {
    super(message)
    this.name = 'SetupApiError'
    this.status = status
    this.code = details.code
    this.fieldErrors = details.fieldErrors ?? {}
    this.field = details.field
    this.env = details.env
  }
}

/** The setting a 422 error is about: the last name in its loc after 'body'. */
function issueField(loc: unknown): string | null {
  if (!Array.isArray(loc) || loc[0] !== 'body') return null
  const names = loc.slice(1).filter((part): part is string => typeof part === 'string')
  return names.length > 0 ? names[names.length - 1] : null
}

function issueMessage(msg: unknown): string {
  const text = typeof msg === 'string' && msg ? msg : 'This value is not valid'
  return text.startsWith(VALUE_ERROR_PREFIX) ? text.slice(VALUE_ERROR_PREFIX.length) : text
}

/**
 * Read a failed response's detail: a message, the app's {code, message, ...},
 * or FastAPI's list of validation errors.
 */
async function errorFrom(response: Response, fallback: string): Promise<SetupApiError> {
  const body: unknown = await response.json().catch(() => null)
  const detail = body !== null && typeof body === 'object' && 'detail' in body ? body.detail : undefined

  if (typeof detail === 'string' && detail) {
    return new SetupApiError(response.status, detail)
  }
  if (Array.isArray(detail)) {
    const fieldErrors: Record<string, string> = {}
    let first: { message: string; type: string | undefined } | null = null
    for (const issue of detail) {
      const { loc, msg, type } = issue !== null && typeof issue === 'object'
        ? (issue as Record<string, unknown>)
        : {}
      const message = issueMessage(msg)
      const field = issueField(loc)
      if (field !== null && !(field in fieldErrors)) fieldErrors[field] = message
      first ??= { message, type: typeof type === 'string' ? type : undefined }
    }
    return new SetupApiError(response.status, first?.message ?? fallback, { code: first?.type, fieldErrors })
  }
  if (detail !== null && typeof detail === 'object') {
    const { code, message, field, env } = detail as Record<string, unknown>
    return new SetupApiError(response.status, typeof message === 'string' && message ? message : fallback, {
      code: typeof code === 'string' ? code : undefined,
      field: typeof field === 'string' ? field : undefined,
      env: Array.isArray(env) && env.every((name) => typeof name === 'string') ? env : undefined,
    })
  }
  return new SetupApiError(response.status, fallback)
}

async function failed(response: Response, what: string, fallback: string): Promise<SetupApiError> {
  const error = await errorFrom(response, fallback)
  logger.error('Setup', `${what} failed: ${response.status}`, { code: error.code })
  return error
}

/** A fetch that never reached the server; an abort is the caller's and passes through. */
function unreachable(err: unknown): unknown {
  // By name: an abort is a DOMException, which isn't an Error subclass everywhere
  if (err !== null && typeof err === 'object' && 'name' in err && err.name === 'AbortError') return err
  return new SetupApiError(0, NETWORK_ERROR, { code: 'network' })
}

/** A request with no session behind it. */
async function send(endpoint: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${API_URL}${endpoint}`, init)
  } catch (err) {
    throw unreachable(err)
  }
}

/**
 * A setup call that carries the session when there is one but never ends
 * it: a 401 here is about Plex or setup, not this browser's sign-in.
 */
async function setupFetch(endpoint: string, init: RequestInit): Promise<Response> {
  const token = getAuthToken()
  return send(endpoint, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

/** An admin call. On a 401 fetchWithAuth has already signed this browser out. */
async function adminFetch(endpoint: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetchWithAuth(endpoint, init)
  } catch (err) {
    if (err instanceof Error && err.message === 'Session expired') {
      throw new SetupApiError(401, SESSION_ENDED, { code: 'session_expired' })
    }
    throw unreachable(err)
  }
}

/** Whether setup is open, and (while it is unclaimed) which variables the environment sets. Public. */
export async function getSetupStatus(signal?: AbortSignal): Promise<SetupStatus> {
  const response = await send('/setup/status', { signal })
  if (!response.ok) throw await failed(response, 'Setup status', "Couldn't check whether setup is open")
  return response.json()
}

/**
 * The Plex servers a Plex sign-in owns. Anyone may ask while setup is
 * unclaimed; afterwards only an admin. A bad Plex token is a 400
 * ('plex_token'), never a 401.
 */
export async function listPlexServers(authToken: string, signal?: AbortSignal): Promise<PlexServersResponse> {
  const response = await setupFetch('/setup/plex/servers', {
    method: 'POST',
    body: JSON.stringify({ authToken }),
    signal,
  })
  if (!response.ok) throw await failed(response, 'Listing Plex servers', "Couldn't list your Plex servers")
  return response.json()
}

/** Create the first admin account and sign in with it: the first visitor wins. */
export async function claimSetup(request: SetupAccountRequest): Promise<TokenResponse> {
  const response = await send('/setup/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok) throw await failed(response, 'Claiming the club', "Couldn't create your account")
  logger.info('Setup', `Club claimed (${request.method})`)
  return response.json()
}

/** Finish setup; again once finished is fine. Returns the facts the On air screen shows. */
export async function completeSetup(): Promise<SetupFacts> {
  const response = await adminFetch('/setup/complete', { method: 'POST' })
  if (!response.ok) throw await failed(response, 'Finishing setup', "Couldn't finish setting up")
  return response.json()
}

/** Every setting the app can change, what the environment locks, and the defaults. */
export async function getAdminConfig(signal?: AbortSignal): Promise<ConfigView> {
  const response = await adminFetch('/admin/config', { signal })
  if (!response.ok) throw await failed(response, 'Reading settings', "Couldn't load the server settings")
  return response.json()
}

/**
 * Save the settings in `patch` and nothing else. A secret left out keeps its
 * saved value, null removes it, and a string replaces it.
 */
export async function updateAdminConfig(patch: ConfigPatch): Promise<ConfigUpdate> {
  const response = await adminFetch('/admin/config', { method: 'PUT', body: JSON.stringify(patch) })
  if (!response.ok) throw await failed(response, 'Saving settings', "Couldn't save the settings")
  return response.json()
}

/**
 * Check a connection with draft values. Leave a secret out to use the saved
 * one. A failed check is a result ({ok: false, reason}), not an error.
 */
export async function testConnection(
  kind: TestKind,
  values: TestValues,
  signal?: AbortSignal,
): Promise<ConnectionTestResult> {
  const controller = new AbortController()
  let hung = false
  const backstop = setTimeout(() => {
    hung = true
    controller.abort()
  }, TEST_BACKSTOP_MS)
  const abort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const response = await adminFetch('/admin/config/test', {
      method: 'POST',
      body: JSON.stringify({ kind, values }),
      signal: controller.signal,
    })
    if (!response.ok) throw await failed(response, `Testing ${kind}`, "Couldn't run the test")
    return await response.json()
  } catch (err) {
    if (hung) throw new SetupApiError(0, "The test didn't finish. Try again.", { code: 'timeout' })
    throw err
  } finally {
    clearTimeout(backstop)
    signal?.removeEventListener('abort', abort)
  }
}

/** The linked Plex server's members, marked with who is an admin. */
export async function getPlexMembers(signal?: AbortSignal): Promise<PlexMember[]> {
  const response = await adminFetch('/admin/plex/members', { signal })
  if (!response.ok) throw await failed(response, 'Listing Plex members', "Couldn't load the server's members")
  return response.json()
}

/** Link (or link again) one of your own Plex servers; you become one of its admins here. */
export async function linkPlexServer(link: PlexServerLink): Promise<ConfigUpdate> {
  const response = await adminFetch('/admin/plex/server', { method: 'POST', body: JSON.stringify(link) })
  if (!response.ok) throw await failed(response, 'Linking a Plex server', "Couldn't link that Plex server")
  return response.json()
}
