/**
 * Plex OAuth PIN-based authentication service.
 *
 * Implements Plex's PIN-based OAuth flow:
 * 1. Request PIN from Plex API
 * 2. Open auth URL in popup with the PIN code
 * 3. Poll PIN status until user authenticates
 * 4. Return auth token for use with our backend
 */

export const PLEX_CLIENT_ID = 'iptv-viewer-2'
export const PLEX_PRODUCT = 'IPTV Viewer'

const PLEX_API_HEADERS = {
  Accept: 'application/json',
  'X-Plex-Product': PLEX_PRODUCT,
  'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
}

export interface PlexPin {
  id: number
  code: string
  authToken: string | null
}

/**
 * Request a new PIN from Plex API.
 */
export async function createPlexPin(): Promise<PlexPin> {
  const response = await fetch('https://plex.tv/api/v2/pins', {
    method: 'POST',
    headers: PLEX_API_HEADERS,
    body: new URLSearchParams({ strong: 'true' }),
  })

  if (!response.ok) {
    throw new Error('Failed to create Plex PIN')
  }

  return response.json()
}

/**
 * Get the Plex auth URL for a given PIN.
 */
export function getPlexAuthUrl(pin: PlexPin): string {
  const params = new URLSearchParams({
    clientID: PLEX_CLIENT_ID,
    code: pin.code,
    'context[device][product]': PLEX_PRODUCT,
  })
  return `https://app.plex.tv/auth#?${params}`
}

/**
 * Check if PIN has been authenticated.
 * @returns authToken if authenticated, null otherwise
 */
export async function checkPlexPin(pinId: number): Promise<string | null> {
  const response = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
    headers: {
      Accept: 'application/json',
      'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
    },
  })

  if (!response.ok) {
    throw new Error('Failed to check Plex PIN')
  }

  const data = await response.json()
  return data.authToken || null
}

/**
 * Full Plex authentication flow using popup.
 *
 * Opens Plex auth page in popup, polls for authentication,
 * and returns the auth token when user completes login.
 *
 * @throws Error if popup blocked, user cancels, or timeout
 */
export async function authenticateWithPlex(): Promise<string> {
  // 1. Create PIN
  const pin = await createPlexPin()

  // 2. Open popup with auth URL
  const authUrl = getPlexAuthUrl(pin)
  const popup = window.open(authUrl, 'PlexAuth', 'width=600,height=700')

  if (!popup) {
    throw new Error('Failed to open Plex authentication popup')
  }

  // 3. Poll for auth token
  return new Promise((resolve, reject) => {
    const pollInterval = setInterval(async () => {
      // Check if popup was closed
      if (popup.closed) {
        clearInterval(pollInterval)
        reject(new Error('Authentication cancelled'))
        return
      }

      try {
        const authToken = await checkPlexPin(pin.id)
        if (authToken) {
          clearInterval(pollInterval)
          popup.close()
          resolve(authToken)
        }
      } catch {
        // Continue polling on error
      }
    }, 2000) // Poll every 2 seconds

    // Timeout after 5 minutes
    setTimeout(() => {
      clearInterval(pollInterval)
      popup.close()
      reject(new Error('Authentication timed out'))
    }, 5 * 60 * 1000)
  })
}
