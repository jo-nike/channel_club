import { describe, it, expect } from 'vitest'
import { settingsState } from '@/test/settingsFixtures'
import {
  firstError,
  newPasswordError,
  passwordLength,
  urlProblem,
  usernameError,
  validateSection,
  USERNAME_PATTERN,
} from './validation'

// Stand-ins for secrets (spaced, so no scanner takes them for real ones)
const KEY = 'api key one'
const LONG = 'twelve chars plus'

describe('urlProblem', () => {
  it.each([
    'https://tv.example.com',
    'http://tv.lan:9191',
    'http://10.0.0.5:8409/base',
    'HTTPS://TV.example.com/',
    '  http://tv.lan  ',
    'http://[::1]:8080',
  ])('accepts %j', (text) => {
    expect(urlProblem(text)).toBeNull()
  })

  it.each(['', 'tv.example.com', 'ftp://tv.lan', 'http://', 'http:tv.lan', 'http://tv.lan:0', 'javascript:alert(1)'])(
    'calls %j invalid',
    (text) => {
      expect(urlProblem(text)).toBe('invalid')
    }
  )

  it.each(['http://user:pass@tv.lan', 'http://tv.lan/?key=1', 'http://tv.lan/#top'])('refuses the extras in %j', (text) => {
    expect(urlProblem(text)).toBe('extras')
  })
})

describe('sign-in rules', () => {
  it('counts password characters as the server does, not UTF-16 units', () => {
    expect(passwordLength('🎬🎬🎬🎬🎬🎬')).toBe(6)
    expect(newPasswordError('🎬🎬🎬🎬🎬🎬', false)).toBe('Use at least 12 characters.')
  })

  it('lets an optional password be blank but not short', () => {
    expect(newPasswordError('', true)).toBeNull()
    expect(newPasswordError('short', true)).toBe('Use at least 12 characters, or leave it blank.')
    expect(newPasswordError(LONG, true)).toBeNull()
    expect(newPasswordError('x'.repeat(257), false)).toBe('Use at most 256 characters.')
  })

  it("takes the server's usernames", () => {
    expect(usernameError('jon')).toBeNull()
    expect(usernameError('living room tv')).toBeNull()
    expect(usernameError('')).toBe('Choose a username.')
    expect(usernameError('   ')).toBe('Choose a username.')
    expect(usernameError(' jon')).toBe('Use up to 64 characters, with no space at either end.')
    expect(usernameError('x'.repeat(65))).toBe('Use up to 64 characters, with no space at either end.')
    expect(USERNAME_PATTERN.test('x'.repeat(64))).toBe(true)
    expect(USERNAME_PATTERN.test('tab\there')).toBe(false)
  })
})

describe('sources', () => {
  it('needs at least one source', () => {
    expect(validateSection(settingsState(), 'sources')).toEqual({
      sources: 'Turn on Dispatcharr or ErsatzTV. The club needs at least one source of channels.',
    })
  })

  it('needs an address and a key for Dispatcharr', () => {
    const state = settingsState({}, { sources: { dispatcharr: true } })

    expect(validateSection(state, 'sources')).toEqual({
      dispatcharrUrl: 'Enter the full address, starting with https:// or http://.',
      dispatcharrApiKey: 'Paste the API key from your Dispatcharr profile page.',
    })
  })

  it('counts a saved key as filled, unless it is being removed', () => {
    const saved = settingsState({ dispatcharrUrl: 'http://tv.lan', dispatcharrApiKey: { set: true } })

    expect(validateSection(saved, 'sources')).toEqual({})
    expect(validateSection({ ...saved, draft: { ...saved.draft, values: { dispatcharrApiKey: null } } }, 'sources'))
      .toEqual({ dispatcharrApiKey: 'Paste the API key from your Dispatcharr profile page.' })
  })

  it('needs an address for ErsatzTV, and says what is wrong with one', () => {
    const state = settingsState({}, { sources: { ersatztv: true }, values: { ersatztvBaseUrl: 'http://etv.lan/?x=1' } })

    expect(validateSection(state, 'sources')).toEqual({
      ersatztvBaseUrl: 'Use the address on its own, without a user name, ? or #.',
    })
    expect(validateSection({ ...state, draft: { ...state.draft, values: {} } }, 'sources')).toEqual({
      ersatztvBaseUrl: 'Enter the full address, starting with http:// or https://.',
    })
  })

  it('skips what the environment locks', () => {
    const state = settingsState(
      { dispatcharrUrl: 'env-value-the-server-checked' },
      {},
      { locked: { dispatcharrUrl: ['DISPATCHARR_URL', 'DISPATCHARR_API_KEY'], dispatcharrApiKey: ['DISPATCHARR_URL', 'DISPATCHARR_API_KEY'] } }
    )

    expect(validateSection(state, 'sources')).toEqual({})
  })

  it("doesn't check a source that is off", () => {
    const state = settingsState({ ersatztvBaseUrl: 'http://etv.lan' }, { values: { dispatcharrUrl: 'nonsense' } })

    expect(validateSection(state, 'sources')).toEqual({})
  })
})

describe('who can join', () => {
  it('asks for a Plex server before Plex members can join', () => {
    const state = settingsState({ localAuthEnabled: true, adminPassword: { set: true } }, { values: { plexAuthEnabled: true } })

    expect(validateSection(state, 'access')).toEqual({
      plexLink: 'Sign in with Plex to choose the server, or switch Plex members off.',
    })
    expect(validateSection(settingsState({ plexAuthEnabled: true, plexServerMachineId: 'abc' }), 'access')).toEqual({})
  })

  it('lets the passwords be blank but not short', () => {
    const state = settingsState(
      { plexAuthEnabled: true, plexServerMachineId: 'abc', localAuthEnabled: true },
      { values: { adminPassword: 'short', viewerPassword: 'tiny' } }
    )

    expect(validateSection(state, 'access')).toEqual({
      adminPassword: 'Use at least 12 characters, or leave it blank.',
      viewerPassword: 'Use at least 12 characters, or leave it blank.',
    })
  })

  it('checks a changed username', () => {
    const state = settingsState({ localAuthEnabled: true }, { values: { viewerUsername: ' tv' } })

    expect(validateSection(state, 'access')).toEqual({
      viewerUsername: 'Use up to 64 characters, with no space at either end.',
    })
  })

  it("won't let the guest login share the admin's name while both can sign in", () => {
    const state = settingsState(
      { localAuthEnabled: true, adminPassword: { set: true } },
      { values: { viewerUsername: 'admin', viewerPassword: LONG } }
    )

    expect(validateSection(state, 'access')).toEqual({ viewerUsername: 'Use a different name from the admin login.' })
    // With no guest password there is no guest login to clash
    expect(validateSection({ ...state, draft: { ...state.draft, values: { viewerUsername: 'admin' } } }, 'access')).toEqual({})
  })

  it('checks nothing behind local sign-in while it is off', () => {
    const state = settingsState({ plexAuthEnabled: true, plexServerMachineId: 'abc' }, { values: { viewerPassword: 'short' } })

    expect(validateSection(state, 'access')).toEqual({})
  })
})

describe('extras', () => {
  it('needs a Zipline address and token when sharing is on', () => {
    const state = settingsState({ highlightEnabled: true, ziplineEnabled: true })

    expect(validateSection(state, 'extras')).toEqual({
      ziplineUrl: 'Enter the Zipline address, starting with https://.',
      ziplineToken: 'Paste the token from your Zipline account.',
    })
    expect(validateSection(settingsState({ ziplineEnabled: true }), 'extras')).toEqual({})
  })

  it('needs an ntfy server and a topic of the right characters', () => {
    const state = settingsState({ ntfyEnabled: true }, { values: { ntfyUrl: 'ntfy.sh', ntfyTopic: 'my topic!' } })

    expect(validateSection(state, 'extras')).toEqual({
      ntfyUrl: 'Enter the ntfy server address, like https://ntfy.sh.',
      ntfyTopic: 'Use only letters, numbers, - and _, up to 64 characters.',
    })
    const good = settingsState({ ntfyEnabled: true }, { values: { ntfyUrl: 'https://ntfy.sh', ntfyTopic: 'channel-club-x7' } })
    expect(validateSection(good, 'extras')).toEqual({})
  })

  it('needs no GIPHY key', () => {
    expect(validateSection(settingsState({ chatEnabled: true }), 'extras')).toEqual({})
    expect(validateSection(settingsState({ chatEnabled: true }, { values: { giphyApiKey: KEY } }), 'extras')).toEqual({})
  })
})

describe('advanced', () => {
  it('passes the saved values untouched', () => {
    expect(validateSection(settingsState(), 'advanced')).toEqual({})
  })

  it('wants whole numbers in range, in the unit shown', () => {
    const state = settingsState({}, {
      values: { castHlsListSize: '1', mediaExportMaxBytes: '4096', requestBodyMaxBytes: '16', feedbackCooldownSeconds: '0', castSessionTimeout: '2.5' },
    })

    expect(validateSection(state, 'advanced')).toEqual({
      castHlsListSize: 'Use a whole number from 2 to 30.',
      mediaExportMaxBytes: 'Use a whole number from 1 to 2048.',
      requestBodyMaxBytes: 'Use a whole number from 32 to 16384.',
      castSessionTimeout: 'Use a whole number from 30 to 86400.',
    })
  })

  it('keeps recording segments no longer than the seconds kept', () => {
    const state = settingsState({}, { values: { highlightBufferSeconds: '20', highlightSegmentSeconds: '30' } })

    expect(validateSection(state, 'advanced')).toEqual({
      highlightSegmentSeconds: 'Keep segments no longer than the seconds kept for clipping.',
    })
  })

  it('wants the logo sources as addresses, at most 20', () => {
    const bad = settingsState({}, { values: { ersatztvLogoOrigins: 'https://a.example, images' } })
    const many = settingsState({}, {
      values: { ersatztvLogoOrigins: Array.from({ length: 21 }, (_, i) => `https://h${i}.example`).join(',') },
    })

    expect(validateSection(bad, 'advanced')).toEqual({
      ersatztvLogoOrigins: 'Use http:// or https:// addresses, separated by commas.',
    })
    expect(validateSection(many, 'advanced')).toEqual({ ersatztvLogoOrigins: 'Use up to 20 addresses.' })
  })

  it('skips a locked number', () => {
    const state = settingsState({}, { values: { castHlsListSize: '99' } }, { locked: { castHlsListSize: ['CAST_HLS_LIST_SIZE'] } })

    expect(validateSection(state, 'advanced')).toEqual({})
  })
})

describe('firstError', () => {
  it('finds the first error in the order the section shows them', () => {
    expect(firstError('sources', { ersatztvBaseUrl: 'x', sources: 'y' })).toBe('sources')
    expect(firstError('access', { viewerPassword: 'x', plexLink: 'y' })).toBe('plexLink')
    expect(firstError('extras', { ntfyTopic: 'x', ziplineUrl: 'y' })).toBe('ziplineUrl')
    expect(firstError('advanced', {})).toBeNull()
  })
})
