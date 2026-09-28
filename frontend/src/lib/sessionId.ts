/**
 * Session ID management for the WebSocket connection's logs.
 *
 * Generates a session ID per browser tab that persists across view switches
 * (Live TV ↔ ErsatzTV). The server only logs it: presence is keyed by an id
 * the server generates for each connection.
 */

const SESSION_ID_KEY = 'iptv_session_id'

function generateSessionId(): string {
  // Generate a random 8-character hex string (the only shape the server logs)
  const array = new Uint8Array(4)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Get or create a session ID for this browser tab.
 * Uses sessionStorage so each tab gets its own ID, but it persists
 * across navigation within the tab.
 */
let memorySessionId: string | null = null

export function getSessionId(): string {
  try {
    let sessionId = sessionStorage.getItem(SESSION_ID_KEY)
    if (!sessionId) {
      sessionId = generateSessionId()
      sessionStorage.setItem(SESSION_ID_KEY, sessionId)
    }
    return sessionId
  } catch {
    // Storage blocked (a locked-down TV browser): keep one id for the page's lifetime
    memorySessionId ??= generateSessionId()
    return memorySessionId
  }
}
