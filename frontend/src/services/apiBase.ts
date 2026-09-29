// Same origin: Vite proxies /api in development and the backend serves it from
// the application origin in production (including LAN clients).
export const API_URL = '/api'

/**
 * Accept a backend-issued "/api/..." path (e.g. Channel.logoUrl) as ours.
 * Anything else is not ours and resolves to null.
 */
export function apiAssetUrl(path: string): string | null {
  return path.startsWith('/api/') ? `${API_URL}${path.slice('/api'.length)}` : null
}
