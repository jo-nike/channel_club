/**
 * Client-side id for a chat send. The server acknowledges a send by this id,
 * and a retry that reuses it is confirmed again instead of posted twice.
 */
export function createClientMessageId(): string {
  // getRandomValues also works on the supported HTTP LAN development origin.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
