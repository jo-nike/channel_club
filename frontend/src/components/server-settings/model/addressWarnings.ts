/*
 * Cautions about addresses the server accepts but that won't work as meant.
 * They never block saving: an admin may know better.
 */

export type WarningKind = 'dispatcharr' | 'ersatztv' | 'zipline'

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host === '[::1]'
    || host === '0.0.0.0'
    || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  )
}

/**
 * What to say about an address, or null. `pageProtocol` is the page's own
 * (window.location.protocol): browsers block http streams only on an https page.
 */
export function addressWarning(kind: WarningKind, text: string, pageProtocol: string): string | null {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  switch (kind) {
    case 'dispatcharr':
      // Browsers play Dispatcharr's streams straight from this address
      if (isLocalHost(url.hostname)) {
        return 'Other devices can\'t reach "localhost". Use the address phones and TVs on your network use.'
      }
      if (url.protocol === 'http:' && pageProtocol === 'https:') {
        return 'This site is on https, so browsers will block streams from an http address. Use Dispatcharr\'s https address.'
      }
      return null
    case 'ersatztv':
      // Only the server reads ErsatzTV, from inside its container
      return isLocalHost(url.hostname)
        ? 'Inside the Channel Club container, "localhost" is the container itself. Use ErsatzTV\'s network address.'
        : null
    case 'zipline':
      return /\/api\/upload\/?$/.test(url.pathname) ? 'Leave off /api/upload. Channel Club adds it.' : null
  }
}
