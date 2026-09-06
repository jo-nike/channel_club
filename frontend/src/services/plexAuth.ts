/**
 * Plex OAuth PIN-based authentication service.
 *
 * Implements Plex's PIN-based OAuth flow:
 * 1. Request PIN from Plex API
 * 2. Open auth URL in popup with the PIN code
 * 3. Poll PIN status until user authenticates
 * 4. Return auth token for use with our backend
 */

import { logger } from '@/lib/logger'

export const PLEX_CLIENT_ID = 'iptv-viewer-2'
export const PLEX_PRODUCT = 'Channel Club'

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
      throw new Error('Too many requests. Please wait a minute and try again.')
    }
    throw new Error('Failed to create Plex PIN')
  }

  const pin = await response.json()
  logger.debug('Plex', `PIN created: ${pin.id}`)
  return pin
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
      throw new Error('Too many requests. Please wait a minute and try again.')
    }
    throw new Error('Failed to check Plex PIN')
  }

  const data = await response.json()
  if (data.authToken) {
    logger.debug('Plex', 'PIN authenticated')
  }
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
  logger.debug('Plex', 'Starting Plex OAuth flow')

  // 1. Create PIN
  const pin = await createPlexPin()

  // 2. Open popup with auth URL
  const authUrl = getPlexAuthUrl(pin)
  logger.debug('Plex', 'Opening auth popup')
  const popup = window.open(authUrl, 'PlexAuth', 'width=600,height=700')

  if (!popup) {
    logger.error('Plex', 'Failed to open Plex authentication popup')
    throw new Error('Failed to open Plex authentication popup')
  }

  // 3. Poll for auth token
  return new Promise((resolve, reject) => {
    const pollInterval = setInterval(async () => {
      // Check if popup was closed
      if (popup.closed) {
        clearInterval(pollInterval)
        logger.info('Plex', 'Authentication cancelled by user')
        reject(new Error('Authentication cancelled'))
        return
      }

      try {
        const authToken = await checkPlexPin(pin.id)
        if (authToken) {
          clearInterval(pollInterval)
          popup.close()
          logger.info('Plex', 'OAuth token acquired successfully')
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
      logger.error('Plex', 'Authentication timed out after 5 minutes')
      reject(new Error('Authentication timed out'))
    }, 5 * 60 * 1000)
  })
}
