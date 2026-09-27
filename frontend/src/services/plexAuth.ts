/**
 * Plex OAuth PIN-based authentication service.
 *
 * Implements Plex's PIN-based OAuth flow:
 * 1. Request PIN from Plex API
 * 2. Open auth URL in popup with the PIN code
 * 3. Poll PIN status until user authenticates
 * 4. Return auth token for use with our backend
 *
 * iPhones, iPads and installed apps use the redirect variant instead: the
 * whole page goes to Plex, which forwards it back here, and the sign-in
 * finishes on return with the PIN id kept in sessionStorage.
 */

import { logger } from '@/lib/logger'

export const PLEX_CLIENT_ID = 'iptv-viewer-2'
export const PLEX_PRODUCT = 'Channel Club'

const PLEX_API_HEADERS = {
  Accept: 'application/json',
  'X-Plex-Product': PLEX_PRODUCT,
  'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
}

export type PlexAuthErrorCode =
  | 'popup_blocked'
  | 'cancelled'
  | 'timeout'
  | 'rate_limited'
  | 'pin_failed'

/**
 * A Plex sign-in failure with a stable code, so callers can branch on what
 * went wrong instead of matching message text.
 */
export class PlexAuthError extends Error {
  readonly code: PlexAuthErrorCode

  constructor(code: PlexAuthErrorCode, message: string) {
    super(message)
    this.name = 'PlexAuthError'
    this.code = code
  }
}

export interface PlexPin {
  id: number
  code: string
  authToken: string | null
}

/**
 * Request a new PIN from Plex API.
 * @param strong - If true, generates a long cryptographic code for auth URLs.
 *                 If false, generates a short 4-char code for manual entry at plex.tv/link.
 */
export async function createPlexPin(strong = true): Promise<PlexPin> {
  logger.debug('Plex', `Creating Plex PIN (strong=${strong})`)

  // Only include strong parameter when true - Plex expects strong=true or no parameter
  const body = strong ? new URLSearchParams({ strong: 'true' }) : undefined

  const response = await fetch('https://plex.tv/api/v2/pins', {
    method: 'POST',
    headers: PLEX_API_HEADERS,
    body,
  })

  if (!response.ok) {
    logger.error('Plex', `Failed to create Plex PIN: ${response.status}`)
    if (response.status === 429) {
      throw new PlexAuthError('rate_limited', 'Too many requests. Please wait a minute and try again.')
    }
    throw new PlexAuthError('pin_failed', 'Failed to create Plex PIN')
  }

  const pin = await response.json()
  logger.debug('Plex', `PIN created: ${pin.id}`)
  return pin
}

/**
 * Get the Plex auth URL for a given PIN.
 * @param forwardUrl - Where Plex sends the page once the user has signed in
 *                     (the redirect flow). Without it, Plex stays put (the popup flow).
 */
export function getPlexAuthUrl(pin: PlexPin, forwardUrl?: string): string {
  const params = new URLSearchParams({
    clientID: PLEX_CLIENT_ID,
    code: pin.code,
    ...(forwardUrl ? { forwardUrl } : {}),
    'context[device][product]': PLEX_PRODUCT,
  })
  return `https://app.plex.tv/auth#?${params}`
}

/**
 * Check if PIN has been authenticated.
 * @returns authToken if authenticated, null otherwise
 */
export async function checkPlexPin(pinId: number): Promise<string | null> {
  logger.debug('Plex', `Checking PIN status: ${pinId}`)

  const response = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
    headers: {
      Accept: 'application/json',
      'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
    },
  })

  if (!response.ok) {
    logger.error('Plex', `Failed to check Plex PIN: ${response.status}`)
    if (response.status === 429) {
      throw new PlexAuthError('rate_limited', 'Too many requests. Please wait a minute and try again.')
    }
    throw new PlexAuthError('pin_failed', 'Failed to check Plex PIN')
  }

  const data = await response.json()
  if (data.authToken) {
    logger.debug('Plex', 'PIN authenticated')
  }
  return data.authToken || null
}

/**
 * Open the (blank) window the Plex sign-in page will load into.
 *
 * Call this synchronously from the click handler, before any await: Safari,
 * iOS home-screen apps and strict popup blockers only allow window.open while
 * the click's user activation is still current. Returns null when blocked.
 */
export function openPlexAuthWindow(): Window | null {
  logger.debug('Plex', 'Opening auth popup')
  return window.open('about:blank', 'PlexAuth', 'width=600,height=700')
}

/**
 * Full Plex authentication flow in a window opened by openPlexAuthWindow().
 *
 * Creates a PIN, points the window at the Plex auth page, polls for
 * authentication and returns the auth token when the user completes login.
 *
 * Aborting `signal` closes the window and rejects with 'cancelled'.
 *
 * @throws PlexAuthError if the PIN can't be created (the window is closed),
 *         the user closes the window or aborts, or it times out after 5 minutes
 */
export async function authenticateWithPlex(popup: Window, signal?: AbortSignal): Promise<string> {
  logger.debug('Plex', 'Starting Plex OAuth flow')

  // 1. Create PIN. On failure, don't leave the blank window behind.
  let pin: PlexPin
  try {
    pin = await createPlexPin()
  } catch (err) {
    popup.close()
    throw err
  }

  if (popup.closed || signal?.aborted) {
    popup.close()
    logger.info('Plex', 'Authentication cancelled by user')
    throw new PlexAuthError('cancelled', 'Authentication cancelled')
  }

  // 2. Send the window to the Plex auth page
  popup.location.href = getPlexAuthUrl(pin)

  // 3. Poll for auth token
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = () => {
      settled = true
      clearInterval(pollInterval)
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    }

    const onAbort = () => {
      finish()
      popup.close()
      logger.info('Plex', 'Authentication cancelled by user')
      reject(new PlexAuthError('cancelled', 'Authentication cancelled'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    const pollInterval = setInterval(async () => {
      // Check if popup was closed
      if (popup.closed) {
        finish()
        logger.info('Plex', 'Authentication cancelled by user')
        reject(new PlexAuthError('cancelled', 'Authentication cancelled'))
        return
      }

      try {
        const authToken = await checkPlexPin(pin.id)
        if (authToken && !settled) {
          finish()
          popup.close()
          logger.info('Plex', 'OAuth token acquired successfully')
          resolve(authToken)
        }
      } catch {
        // Continue polling on error
      }
    }, 2000) // Poll every 2 seconds

    // Timeout after 5 minutes
    const timeout = setTimeout(() => {
      finish()
      popup.close()
      logger.error('Plex', 'Authentication timed out after 5 minutes')
      reject(new PlexAuthError('timeout', 'Authentication timed out'))
    }, 5 * 60 * 1000)
  })
}

/** sessionStorage key holding the PIN id while the page is away at Plex. */
export const PLEX_PENDING_PIN_KEY = 'plex-pending-pin'

/** How many times the returning page checks the PIN, and how far apart. */
const REDIRECT_PIN_CHECKS = 5
const REDIRECT_PIN_CHECK_INTERVAL_MS = 1000

/**
 * Redirect sign-in for iPhones, iPads and installed apps, where a popup is
 * unreliable: creates a PIN, remembers its id for this tab and sends the whole
 * page to Plex, which forwards it back to the app root once the user signs in.
 *
 * The id lives in sessionStorage rather than a query parameter so the router
 * never sees it. The returned promise settles once navigation has started.
 *
 * @throws PlexAuthError if the PIN can't be created or remembered (storage
 *         blocked: 'pin_failed', and the page stays), or 'cancelled' if
 *         `signal` aborts first (nothing is stored and the page stays)
 */
export async function authenticateWithPlexRedirect(signal?: AbortSignal): Promise<void> {
  logger.debug('Plex', 'Starting Plex redirect flow')
  const pin = await createPlexPin()

  if (signal?.aborted) {
    logger.info('Plex', 'Authentication cancelled by user')
    throw new PlexAuthError('cancelled', 'Authentication cancelled')
  }

  try {
    sessionStorage.setItem(PLEX_PENDING_PIN_KEY, String(pin.id))
  } catch {
    // Storage blocked: the return couldn't finish sign-in, so don't leave
    throw new PlexAuthError('pin_failed', 'Cannot remember the Plex PIN: storage is blocked')
  }
  window.location.assign(getPlexAuthUrl(pin, `${window.location.origin}/`))
}

/** The stored PIN id, or null when there is none or it isn't a PIN id. */
function readPendingPlexPin(): number | null {
  let stored: string | null = null
  try {
    stored = sessionStorage.getItem(PLEX_PENDING_PIN_KEY)
  } catch {
    // Storage blocked: nothing can have been stored
  }
  const pinId = Number(stored)
  return stored !== null && Number.isSafeInteger(pinId) && pinId > 0 ? pinId : null
}

/** True when this tab left for Plex's redirect sign-in and hasn't finished it. */
export function hasPendingPlexPin(): boolean {
  return readPendingPlexPin() !== null
}

/**
 * Take (read and remove) the PIN id left by authenticateWithPlexRedirect(),
 * so a reload never retries it. Null when there is none.
 */
export function takePendingPlexPin(): number | null {
  const pinId = readPendingPlexPin()
  try {
    sessionStorage.removeItem(PLEX_PENDING_PIN_KEY)
  } catch {
    // Storage blocked: nothing to remove
  }
  return pinId
}

/**
 * Finish the redirect sign-in after Plex forwards the page back: check the PIN
 * a few times (Plex may take a moment to mark it authorised) and return the
 * auth token.
 *
 * @throws PlexAuthError 'cancelled' if the PIN never got a token (the user came
 *         back without signing in) or `signal` aborts; the error itself
 *         (e.g. 'rate_limited') when the last check failed
 */
export async function finishPlexRedirect(pinId: number, signal?: AbortSignal): Promise<string> {
  let lastError: unknown = null
  for (let check = 0; check < REDIRECT_PIN_CHECKS; check++) {
    if (check > 0) await abortableDelay(REDIRECT_PIN_CHECK_INTERVAL_MS, signal)
    if (signal?.aborted) break
    try {
      const authToken = await checkPlexPin(pinId)
      lastError = null
      if (signal?.aborted) break
      if (authToken) {
        logger.info('Plex', 'OAuth token acquired after redirect')
        return authToken
      }
    } catch (err) {
      lastError = err
    }
  }
  if (lastError && !signal?.aborted) throw lastError
  logger.info('Plex', 'Plex redirect returned without a sign-in')
  throw new PlexAuthError('cancelled', 'Authentication cancelled')
}

/** Resolves after `ms`, or straight away when `signal` aborts. */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}
