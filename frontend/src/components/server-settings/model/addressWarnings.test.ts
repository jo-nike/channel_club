import { describe, it, expect } from 'vitest'
import { addressWarning } from './addressWarnings'

describe('addressWarning', () => {
  it.each(['http://localhost:9191', 'http://127.0.0.1', 'http://127.1.2.3:80', 'http://[::1]:9191', 'http://0.0.0.0', 'http://tv.localhost'])(
    'warns that other devices cannot reach Dispatcharr at %s',
    (address) => {
      expect(addressWarning('dispatcharr', address, 'http:')).toBe(
        'Other devices can\'t reach "localhost". Use the address phones and TVs on your network use.'
      )
    }
  )

  it('warns about http Dispatcharr streams only on an https page', () => {
    const warning = 'This site is on https, so browsers will block streams from an http address. Use Dispatcharr\'s https address.'

    expect(addressWarning('dispatcharr', 'http://tv.example.com', 'https:')).toBe(warning)
    expect(addressWarning('dispatcharr', 'http://tv.example.com', 'http:')).toBeNull()
    expect(addressWarning('dispatcharr', 'https://tv.example.com', 'https:')).toBeNull()
  })

  it('warns that localhost is the container itself for ErsatzTV, whatever the page', () => {
    expect(addressWarning('ersatztv', 'http://localhost:8409', 'https:')).toBe(
      'Inside the Channel Club container, "localhost" is the container itself. Use ErsatzTV\'s network address.'
    )
    // Only the server reads ErsatzTV, so an http address is fine
    expect(addressWarning('ersatztv', 'http://etv.lan:8409', 'https:')).toBeNull()
  })

  it('warns when the Zipline address carries the upload path', () => {
    expect(addressWarning('zipline', 'https://clips.example.com/api/upload', 'https:')).toBe('Leave off /api/upload. Channel Club adds it.')
    expect(addressWarning('zipline', 'https://clips.example.com/api/upload/', 'https:')).toBe('Leave off /api/upload. Channel Club adds it.')
    expect(addressWarning('zipline', 'https://clips.example.com/zipline', 'https:')).toBeNull()
  })

  it.each(['', 'tv.example.com', 'ftp://localhost'])('says nothing about %j, which validation reports', (text) => {
    expect(addressWarning('dispatcharr', text, 'https:')).toBeNull()
  })
})
