// Relative by default: Vite proxies /api in development and the backend serves
// it from the application origin in production (including LAN clients).
export const API_URL = import.meta.env.VITE_API_URL || '/api'

/**
 * Resolve a backend-issued "/api/..." path (e.g. Channel.logoUrl) against
 * API_URL, which may point at another origin. Anything else is not ours and
 * resolves to null.
 */
export function apiAssetUrl(path: string): string | null {
  return path.startsWith('/api/') ? `${API_URL}${path.slice('/api'.length)}` : null
}
