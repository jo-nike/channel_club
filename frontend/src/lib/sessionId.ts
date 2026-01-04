/**
 * Session ID management for presence tracking.
 *
 * Generates a unique session ID per browser tab that persists across
 * view switches (Live TV ↔ ErsatzTV) but is unique per tab.
 * This prevents duplicate user entries when switching views.
 */

const SESSION_ID_KEY = 'iptv_session_id'

function generateSessionId(): string {
  // Generate a random 8-character hex string (matches server's uuid[:8] format)
  const array = new Uint8Array(4)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Get or create a session ID for this browser tab.
 * Uses sessionStorage so each tab gets its own ID, but it persists
 * across navigation within the tab.
 */
export function getSessionId(): string {
  let sessionId = sessionStorage.getItem(SESSION_ID_KEY)
  if (!sessionId) {
    sessionId = generateSessionId()
    sessionStorage.setItem(SESSION_ID_KEY, sessionId)
  }
  return sessionId
}
