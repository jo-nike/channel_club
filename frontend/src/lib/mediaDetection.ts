/**
 * Media URL detection utility for chat messages
 * Detects GIFs, videos, and images in text content
 */

export type MediaType = 'gif' | 'video' | 'image'

/** 'embed' loads the media inline; 'link' only offers it to click open. */
export type MediaKind = 'embed' | 'link'

export interface MediaMatch {
  type: MediaType
  kind: MediaKind
  url: string
  originalUrl: string
  startIndex: number
  endIndex: number
}

/**
 * Media extension patterns grouped by type
 * Note: webp from giphy.com can be animated, so we treat all webp as potentially animated
 */
const MEDIA_EXTENSIONS: Record<MediaType, string[]> = {
  gif: ['gif', 'webp'], // webp can be animated (especially from Giphy)
  video: ['gifv', 'webm', 'mp4'],
  image: ['png', 'jpg', 'jpeg'],
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
 * Chat embeds only come from Giphy's media hosts (media.giphy.com,
 * media0.giphy.com, i.giphy.com, ...): the GIF picker's only source, and
 * what the document CSP's img-src and media-src allow.
 */
const EMBED_HOST_SUFFIX = '.giphy.com'

/** At most this many embeds per message; later ones are links */
export const MAX_EMBEDS_PER_MESSAGE = 3

/**
 * The media type from the extension that ends the URL's path (never the
 * query or fragment), or null when the path has none
 */
function getMediaType(url: URL): MediaType | null {
  const path = url.pathname.toLowerCase()

  for (const [type, extensions] of Object.entries(MEDIA_EXTENSIONS)) {
    for (const ext of extensions) {
      if (path.endsWith(`.${ext}`)) {
        return type as MediaType
      }
    }
  }

  return null
}

function parseUrl(candidate: string): URL | null {
  try {
    return new URL(candidate)
  } catch {
    return null
  }
}

/** An https URL on Giphy's media hosts, with no credentials or custom port */
function isEmbeddable(url: URL): boolean {
  return (
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    url.hostname.endsWith(EMBED_HOST_SUFFIX)
  )
}

/**
 * Detect all media URLs in a text string
 *
 * Only https URLs whose path ends in a media extension count. Up to
 * MAX_EMBEDS_PER_MESSAGE of those on Giphy's media hosts embed; the rest are
 * links. Anything else (http, LAN addresses, an extension only in the query)
 * stays plain text and is left out.
 *
 * @param text - The text content to scan for media URLs
 * @returns Array of MediaMatch objects with type, kind, URL, and position info
 */
export function detectMediaUrls(text: string): MediaMatch[] {
  if (!text) {
    return []
  }

  const matches: MediaMatch[] = []
  let embeds = 0
  // Reset regex state (important since we use global flag)
  MEDIA_URL_PATTERN.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = MEDIA_URL_PATTERN.exec(text)) !== null) {
    const originalUrl = match[0]
    const url = parseUrl(originalUrl)
    if (!url || url.protocol !== 'https:') continue
    const mediaType = getMediaType(url)
    if (!mediaType) continue

    const embed = embeds < MAX_EMBEDS_PER_MESSAGE && isEmbeddable(url)
    if (embed) embeds += 1

    matches.push({
      type: mediaType,
      kind: embed ? 'embed' : 'link',
      url: originalUrl,
      originalUrl,
      startIndex: match.index,
      endIndex: match.index + originalUrl.length,
    })
  }

  return matches
}
