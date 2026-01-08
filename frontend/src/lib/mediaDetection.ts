/**
 * Media URL detection utility for chat messages
 * Detects GIFs, videos, and images in text content
 */

export type MediaType = 'gif' | 'video' | 'image'

export interface MediaMatch {
  type: MediaType
  url: string
  originalUrl: string
  startIndex: number
  endIndex: number
}

/**
 * Media extension patterns grouped by type
 */
const MEDIA_EXTENSIONS: Record<MediaType, string[]> = {
  gif: ['gif'],
  video: ['gifv', 'webm', 'mp4'],
  image: ['png', 'jpg', 'jpeg', 'webp'],
}

/**
 * Build regex pattern for all supported media extensions
 * Note: Order matters - longer extensions (gifv) must come before shorter ones (gif)
 */
function buildMediaPattern(): RegExp {
  const allExtensions = Object.values(MEDIA_EXTENSIONS).flat()
  // Sort by length descending so "gifv" is matched before "gif"
  const sortedExtensions = allExtensions.sort((a, b) => b.length - a.length)
  const extensionPattern = sortedExtensions.join('|')
  // Match URLs ending with supported extensions, optionally followed by query params
  return new RegExp(
    `https?://[^\\s]+\\.(${extensionPattern})(\\?[^\\s]*)?`,
    'gi'
  )
}

const MEDIA_URL_PATTERN = buildMediaPattern()

/**
 * Determine the media type based on file extension
 */
function getMediaType(url: string): MediaType {
  const lowerUrl = url.toLowerCase()
  // Remove query params for extension detection
  const pathOnly = lowerUrl.split('?')[0]

  for (const [type, extensions] of Object.entries(MEDIA_EXTENSIONS)) {
    for (const ext of extensions) {
      if (pathOnly.endsWith(`.${ext}`)) {
        return type as MediaType
      }
    }
  }

  // Default to image if we somehow don't match (shouldn't happen with our regex)
  return 'image'
}

/**
 * Normalize special media URL formats for better compatibility
 *
 * - Imgur .gifv → .mp4 (gifv is HTML page, mp4 is direct video)
 */
export function normalizeMediaUrl(url: string): string {
  // Convert Imgur .gifv to .mp4 for direct video playback
  if (url.includes('imgur.com') && url.toLowerCase().endsWith('.gifv')) {
    return url.slice(0, -5) + '.mp4'
  }

  return url
}

/**
 * Detect all media URLs in a text string
 *
 * @param text - The text content to scan for media URLs
 * @returns Array of MediaMatch objects with type, URL, and position info
 */
export function detectMediaUrls(text: string): MediaMatch[] {
  if (!text) {
    return []
  }

  const matches: MediaMatch[] = []
  // Reset regex state (important since we use global flag)
  MEDIA_URL_PATTERN.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = MEDIA_URL_PATTERN.exec(text)) !== null) {
    const originalUrl = match[0]
    const mediaType = getMediaType(originalUrl)
    const normalizedUrl = normalizeMediaUrl(originalUrl)

    matches.push({
      type: mediaType,
      url: normalizedUrl,
      originalUrl,
      startIndex: match.index,
      endIndex: match.index + originalUrl.length,
    })
  }

  return matches
}
