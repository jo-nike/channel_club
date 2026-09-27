/**
 * Client-side JWT payload reading.
 *
 * The payload is base64url (RFC 7515): it uses '-' and '_' instead of '+'
 * and '/', and drops the '=' padding, so plain atob() throws on it. Names
 * in the payload can be non-ASCII, so the decoded bytes are read as UTF-8.
 * Nothing here verifies the signature; the server does that.
 */

/** Decode a JWT's payload, or return null when the token is malformed. */
export function decodeTokenPayload(token: string): Record<string, unknown> | null {
  const segment = token.split('.')[1]
  if (!segment) return null
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
    return payload as Record<string, unknown>
  } catch {
    return null
  }
}

/** The token's subject (the server uses the username), or null when absent or malformed. */
export function getTokenSubject(token: string): string | null {
  const sub = decodeTokenPayload(token)?.sub
  return typeof sub === 'string' && sub !== '' ? sub : null
}
