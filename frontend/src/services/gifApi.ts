import { fetchWithAuth } from './api'
import { logger } from '@/lib/logger'

export interface GifItem {
  id: string
  url: string
  previewUrl: string
  width: number
  height: number
  title: string
}

export interface GifPagination {
  totalCount: number
  count: number
  offset: number
}

export interface GifResponse {
  gifs: GifItem[]
  pagination: GifPagination
}

/**
 * Fetch trending GIFs.
 */
export async function fetchTrending(limit: number = 25): Promise<GifResponse> {
  logger.debug('GIF', `Fetching trending GIFs (limit=${limit})`)

  const response = await fetchWithAuth(`/gif/trending?limit=${limit}`)

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to fetch trending GIFs' }))
    logger.error('GIF', `Failed to fetch trending GIFs: ${response.status}`, { detail: error.detail })
    throw new Error(errorMessage(error.detail, 'Failed to fetch trending GIFs'))
  }

  const data: GifResponse = await response.json()
  logger.debug('GIF', `Fetched ${data.gifs.length} trending GIFs`)
  return data
}

/** The server's message, or the fallback: a 422's detail is a list of validation errors. */
function errorMessage(detail: unknown, fallback: string): string {
  return typeof detail === 'string' && detail ? detail : fallback
}

/**
 * Search for GIFs.
 */
export async function searchGifs(
  query: string,
  offset: number = 0,
  limit: number = 25
): Promise<GifResponse> {
  logger.debug('GIF', `Searching GIFs: "${query}" (offset=${offset}, limit=${limit})`)

  const params = new URLSearchParams({
    q: query,
    offset: String(offset),
    limit: String(limit),
  })

  const response = await fetchWithAuth(`/gif/search?${params}`)

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to search GIFs' }))
    logger.error('GIF', `Failed to search GIFs: ${response.status}`, { detail: error.detail })
    throw new Error(errorMessage(error.detail, 'Failed to search GIFs'))
  }

  const data: GifResponse = await response.json()
  logger.debug('GIF', `Search returned ${data.gifs.length} GIFs`)
  return data
}
