import { describe, it, expect } from 'vitest'
import { detectMediaUrls } from './mediaDetection'

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
      expect(matches[0]).toMatchObject({ type: 'gif', kind: 'embed' })
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

    it('detects .webp URLs as gif (can be animated)', () => {
      const text = 'Modern format: https://example.com/image.webp'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(1)
      // webp is treated as gif since it can be animated (especially from Giphy)
      expect(matches[0].type).toBe('gif')
    })
  })

  describe('Mixed content handling', () => {
    it('detects multiple media URLs in same message', () => {
      const text = 'Check these: https://media.giphy.com/1.gif and https://b.com/2.mp4'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(2)
      expect(matches[0]).toMatchObject({ type: 'gif', kind: 'embed' })
      expect(matches[1]).toMatchObject({ type: 'video', kind: 'link' })
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
    it('offers Tenor GIF URLs as links, not embeds', () => {
      const text = 'https://media.tenor.com/abc123/some-name.gif'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(1)
      expect(matches[0]).toMatchObject({ type: 'gif', kind: 'link' })
    })

    it('offers Tenor MP4 URLs as links, not embeds', () => {
      const text = 'https://media.tenor.com/abc123/video.mp4'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(1)
      expect(matches[0]).toMatchObject({ type: 'video', kind: 'link' })
    })
  })

  describe('Imgur URLs', () => {
    it('offers Imgur .gifv URLs as links, as written', () => {
      const text = 'Check this: https://i.imgur.com/xyz789.gifv'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(1)
      expect(matches[0]).toMatchObject({
        type: 'video',
        kind: 'link',
        url: 'https://i.imgur.com/xyz789.gifv',
        originalUrl: 'https://i.imgur.com/xyz789.gifv',
      })
    })

    it('offers regular Imgur GIF URLs as links, not embeds', () => {
      const text = 'https://i.imgur.com/abc123.gif'
      const matches = detectMediaUrls(text)
      expect(matches).toHaveLength(1)
      expect(matches[0]).toMatchObject({ type: 'gif', kind: 'link' })
    })
  })
})

describe('Embed policy', () => {
  it.each([
    ['https://media.giphy.com/media/abc/giphy.gif', 'gif'],
    ['https://media0.giphy.com/media/abc/200.webp', 'gif'],
    ['https://i.giphy.com/media/abc/giphy.mp4', 'video'],
  ])('embeds %s', (url, type) => {
    expect(detectMediaUrls(`look ${url}`)).toEqual([
      { type, kind: 'embed', url, originalUrl: url, startIndex: 5, endIndex: 5 + url.length },
    ])
  })

  it.each([
    'http://192.168.1.1/apply.cgi?reboot=1&x=.png',
    'http://10.0.0.5:8080/admin/delete?id=3#.jpg',
    'https://example.com/a.cgi?x=.png',
    'https://example.com/a.cgi#.gif',
    'http://media.giphy.com/x.gif',
    'http://example.com/photo.jpg',
  ])('leaves %s as plain text', (url) => {
    expect(detectMediaUrls(`see ${url} now`)).toEqual([])
  })

  it.each([
    'https://media.giphy.com@evil.example/x.gif',
    'https://user:pw@media.giphy.com/x.gif',
    'https://evil.example/media.giphy.com/x.gif',
    'https://giphy.com.evil.example/x.gif',
    'https://giphy.com/x.gif',
    'https://media.giphy.com:8443/x.gif',
    'https://media.giphy.com./x.gif',
  ])('links but does not embed %s', (url) => {
    const matches = detectMediaUrls(url)
    expect(matches).toHaveLength(1)
    expect(matches[0].kind).toBe('link')
  })

  it('embeds an upper-case Giphy host and extension', () => {
    const matches = detectMediaUrls('https://MEDIA.GIPHY.COM/x.GIF')
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ type: 'gif', kind: 'embed' })
  })

  it('embeds at most three per message, the rest are links', () => {
    const urls = [1, 2, 3, 4, 5].map((n) => `https://media.giphy.com/media/${n}/giphy.gif`)
    const matches = detectMediaUrls(urls.join(' '))
    expect(matches.map((m) => m.kind)).toEqual(['embed', 'embed', 'embed', 'link', 'link'])
    expect(matches.map((m) => m.url)).toEqual(urls)
  })

  it('does not count a link against the embed cap', () => {
    const text = [
      'https://i.imgur.com/a.gif',
      'https://media.giphy.com/1.gif',
      'https://media.giphy.com/2.gif',
      'https://media.giphy.com/3.gif',
    ].join(' ')
    expect(detectMediaUrls(text).map((m) => m.kind)).toEqual(['link', 'embed', 'embed', 'embed'])
  })
})
