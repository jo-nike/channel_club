import { describe, it, expect } from 'vitest'
import { detectMediaUrls, normalizeMediaUrl } from './mediaDetection'

describe('detectMediaUrls', () => {
  describe('GIF detection', () => {
    it('detects simple .gif URLs', () => {
      const text = 'Check this out: https://example.com/funny.gif'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(1)
      expect(matches[0]).toMatchObject({
        type: 'gif',
        url: 'https://example.com/funny.gif',
        originalUrl: 'https://example.com/funny.gif',
      })
    })

    it('detects .gif URLs with query parameters', () => {
      const text = 'Look at this: https://example.com/image.gif?v=123&size=large'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(1)
      expect(matches[0].type).toBe('gif')
      expect(matches[0].url).toContain('?v=123')
    })

    it('detects Giphy URLs', () => {
      const text = 'https://media.giphy.com/media/abc123/giphy.gif'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(1)
      expect(matches[0].type).toBe('gif')
    })
  })

  describe('Video format detection', () => {
    it('detects .gifv URLs and returns video type', () => {
      const text = 'https://i.imgur.com/abc123.gifv'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(1)
      expect(matches[0].type).toBe('video')
      expect(matches[0].originalUrl).toBe('https://i.imgur.com/abc123.gifv')
    })

    it('detects .webm URLs', () => {
      const text = 'Check this video: https://example.com/video.webm'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(1)
      expect(matches[0].type).toBe('video')
    })

    it('detects .mp4 URLs', () => {
      const text = 'Watch: https://cdn.example.com/clip.mp4?quality=hd'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(1)
      expect(matches[0].type).toBe('video')
    })
  })

  describe('Image format detection', () => {
    it('detects .png URLs', () => {
      const text = 'Screenshot: https://example.com/screenshot.png'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(1)
      expect(matches[0].type).toBe('image')
    })

    it('detects .jpg URLs', () => {
      const text = 'Photo: https://example.com/photo.jpg'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(1)
      expect(matches[0].type).toBe('image')
    })

    it('detects .jpeg URLs', () => {
      const text = 'Image: https://example.com/image.jpeg'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(1)
      expect(matches[0].type).toBe('image')
    })

    it('detects .webp URLs', () => {
      const text = 'Modern format: https://example.com/image.webp'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(1)
      expect(matches[0].type).toBe('image')
    })
  })

  describe('Mixed content handling', () => {
    it('detects multiple media URLs in same message', () => {
      const text = 'Check these: https://a.com/1.gif and https://b.com/2.mp4'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(2)
      expect(matches[0].type).toBe('gif')
      expect(matches[1].type).toBe('video')
    })

    it('returns correct indices for mixed text and media', () => {
      const text = 'Before https://example.com/test.gif after'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(1)
      expect(text.slice(matches[0].startIndex, matches[0].endIndex)).toBe(
        'https://example.com/test.gif'
      )
    })

    it('preserves order of media URLs', () => {
      const text = 'First https://a.com/1.png second https://b.com/2.gif third'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(2)
      expect(matches[0].startIndex).toBeLessThan(matches[1].startIndex)
    })
  })

  describe('Non-media URLs', () => {
    it('returns empty array for text without media URLs', () => {
      const text = 'Just plain text without any URLs'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(0)
    })

    it('ignores non-media URLs', () => {
      const text = 'Check https://example.com/page.html for info'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(0)
    })

    it('ignores URLs with unsupported extensions', () => {
      const text = 'Download https://example.com/file.pdf'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(0)
    })
  })

  describe('Edge cases', () => {
    it('handles empty string', () => {
      expect(detectMediaUrls('')).toHaveLength(0)
    })

    it('handles URL at start of text', () => {
      const text = 'https://example.com/test.gif is cool'
      const matches = detectMediaUrls(text)
      expect(matches[0].startIndex).toBe(0)
    })

    it('handles URL at end of text', () => {
      const text = 'Check this https://example.com/test.gif'
      const matches = detectMediaUrls(text)
      expect(matches[0].endIndex).toBe(text.length)
    })

    it('handles URLs separated by newlines', () => {
      const text = 'https://a.com/1.gif\nhttps://b.com/2.gif'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(2)
    })

    it('handles case-insensitive extensions', () => {
      const text = 'https://example.com/IMAGE.GIF'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(1)
      expect(matches[0].type).toBe('gif')
    })
  })
})

describe('normalizeMediaUrl', () => {
  it('converts Imgur .gifv to .mp4', () => {
    const result = normalizeMediaUrl('https://i.imgur.com/abc123.gifv')
    expect(result).toBe('https://i.imgur.com/abc123.mp4')
  })

  it('leaves non-Imgur .gifv unchanged', () => {
    const result = normalizeMediaUrl('https://other.com/video.gifv')
    // Should still work as .gifv is a video format
    expect(result).toBe('https://other.com/video.gifv')
  })

  it('leaves regular URLs unchanged', () => {
    const result = normalizeMediaUrl('https://example.com/image.gif')
    expect(result).toBe('https://example.com/image.gif')
  })

  it('leaves mp4 URLs unchanged', () => {
    const result = normalizeMediaUrl('https://example.com/video.mp4')
    expect(result).toBe('https://example.com/video.mp4')
  })
})

describe('Special URL format handling', () => {
  describe('Giphy URLs', () => {
    it('detects Giphy media URLs as GIFs', () => {
      const text = 'https://media.giphy.com/media/abc123/giphy.gif'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(1)
      expect(matches[0].type).toBe('gif')
    })

    it('detects Giphy CDN URLs', () => {
      const text = 'https://media0.giphy.com/media/abc123/200.gif'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(1)
      expect(matches[0].type).toBe('gif')
    })
  })

  describe('Tenor URLs', () => {
    it('detects Tenor GIF URLs', () => {
      const text = 'https://media.tenor.com/abc123/some-name.gif'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(1)
      expect(matches[0].type).toBe('gif')
    })

    it('detects Tenor MP4 URLs', () => {
      const text = 'https://media.tenor.com/abc123/video.mp4'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(1)
      expect(matches[0].type).toBe('video')
    })
  })

  describe('Imgur URLs', () => {
    it('converts Imgur .gifv URLs to .mp4 in detection', () => {
      const text = 'Check this: https://i.imgur.com/xyz789.gifv'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(1)
      expect(matches[0].type).toBe('video')
      expect(matches[0].url).toBe('https://i.imgur.com/xyz789.mp4')
      expect(matches[0].originalUrl).toBe('https://i.imgur.com/xyz789.gifv')
    })

    it('detects regular Imgur GIF URLs', () => {
      const text = 'https://i.imgur.com/abc123.gif'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(1)
      expect(matches[0].type).toBe('gif')
    })
  })
})
