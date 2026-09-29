import { describe, it, expect } from 'vitest'
import { settingsState } from '@/test/settingsFixtures'
import { setField } from './configDraft'
import {
  currentTest,
  describeResult,
  hostOf,
  testFingerprint,
  testInputError,
  testStatus,
  testValues,
  type TestRecord,
} from './testResults'

// Stand-ins for secrets (spaced, so no scanner takes them for real ones)
const KEY = 'api key one'
const OTHER = 'api key two'

describe('testFingerprint', () => {
  const state = settingsState({ dispatcharrUrl: 'http://tv.lan', dispatcharrApiKey: { set: true } })

  it('changes when an input the test uses changes', () => {
    const before = testFingerprint(state, 'dispatcharr')

    expect(testFingerprint({ ...state, draft: setField(state.draft, 'dispatcharrUrl', 'http://tv2.lan') }, 'dispatcharr')).not.toBe(before)
    expect(testFingerprint({ ...state, draft: setField(state.draft, 'dispatcharrApiKey', KEY) }, 'dispatcharr')).not.toBe(before)
  })

  it('stays when anything else changes', () => {
    const before = testFingerprint(state, 'dispatcharr')

    expect(testFingerprint({ ...state, draft: setField(state.draft, 'chatEnabled', true) }, 'dispatcharr')).toBe(before)
    expect(testFingerprint({ ...state, draft: setField(state.draft, 'ersatztvBaseUrl', 'http://etv.lan') }, 'dispatcharr')).toBe(before)
  })

  it('tells a typed secret from another, from the saved one, and from none', () => {
    const typed = (value: string | null) => testFingerprint({ ...state, draft: setField(state.draft, 'dispatcharrApiKey', value) }, 'dispatcharr')

    expect(new Set([typed(KEY), typed(OTHER), typed(null), testFingerprint(state, 'dispatcharr')]).size).toBe(4)
    // Blank keeps the saved key: the same inputs as before
    expect(typed('')).toBe(testFingerprint(state, 'dispatcharr'))
  })
})

describe('currentTest and testStatus', () => {
  const state = settingsState({ ersatztvBaseUrl: 'http://etv.lan' })
  const record = (overrides: Partial<TestRecord>): TestRecord => ({
    fingerprint: testFingerprint(state, 'ersatztv'),
    running: false,
    ...overrides,
  })

  it('shows a result only while its inputs are unchanged', () => {
    const passed = record({ result: { ok: true } })
    const edited = { ...state, draft: setField(state.draft, 'ersatztvBaseUrl', 'http://etv2.lan') }

    expect(currentTest(passed, state, 'ersatztv')).toBe(passed)
    expect(currentTest(passed, edited, 'ersatztv')).toBeUndefined()
    expect(testStatus(passed, edited, 'ersatztv')).toBe('untested')
  })

  it('reads running, passed, failed and untested', () => {
    expect(testStatus(undefined, state, 'ersatztv')).toBe('untested')
    expect(testStatus(record({ running: true }), state, 'ersatztv')).toBe('running')
    expect(testStatus(record({ result: { ok: true } }), state, 'ersatztv')).toBe('passed')
    expect(testStatus(record({ result: { ok: false, reason: 'timeout' } }), state, 'ersatztv')).toBe('failed')
    expect(testStatus(record({ error: "Couldn't reach Channel Club's server." }), state, 'ersatztv')).toBe('failed')
  })
})

describe('testValues', () => {
  it('sends the values shown and a secret only when typed', () => {
    const saved = settingsState({ dispatcharrUrl: 'http://tv.lan', dispatcharrApiKey: { set: true } })

    expect(testValues(saved, 'dispatcharr')).toEqual({ dispatcharrUrl: 'http://tv.lan' })
    expect(testValues({ ...saved, draft: setField(saved.draft, 'dispatcharrApiKey', ` ${KEY} `) }, 'dispatcharr'))
      .toEqual({ dispatcharrUrl: 'http://tv.lan', dispatcharrApiKey: KEY })
  })

  it('leaves out what the environment locks', () => {
    const state = settingsState(
      { ntfyUrl: 'https://ntfy.sh' },
      { values: { ntfyTopic: ' club-topic ' } },
      { locked: { ntfyUrl: ['NTFY_URL'] } }
    )

    expect(testValues(state, 'ntfy')).toEqual({ ntfyTopic: 'club-topic' })
  })
})

describe('testInputError', () => {
  it.each([
    ['dispatcharr', {}, 'dispatcharrUrl', 'Enter the address first, starting with https:// or http://.'],
    ['dispatcharr', { dispatcharrUrl: 'http://tv.lan' }, 'dispatcharrApiKey', 'Paste the API key first.'],
    ['ersatztv', {}, 'ersatztvBaseUrl', 'Enter the address first, starting with http:// or https://.'],
    ['giphy', {}, 'giphyApiKey', 'Paste a key to check it, or leave it blank for no GIFs.'],
    ['zipline', {}, 'ziplineUrl', 'Enter the Zipline address first.'],
    ['zipline', { ziplineUrl: 'https://clips.lan' }, 'ziplineToken', 'Paste the token first.'],
    ['ntfy', {}, 'ntfyUrl', 'Enter the ntfy server address first.'],
    ['ntfy', { ntfyUrl: 'https://ntfy.sh' }, 'ntfyTopic', 'Use only letters, numbers, - and _, up to 64 characters.'],
  ] as const)('asks %s for %o: %s', (kind, values, field, message) => {
    expect(testInputError(settingsState(values), kind)).toEqual({ field, message })
  })

  it('lets a test run with a saved key, or a locked one', () => {
    expect(testInputError(settingsState({ dispatcharrUrl: 'http://tv.lan', dispatcharrApiKey: { set: true } }), 'dispatcharr')).toBeNull()
    const locked = settingsState({}, {}, { locked: { dispatcharrUrl: ['DISPATCHARR_URL'], dispatcharrApiKey: ['DISPATCHARR_URL'] } })
    expect(testInputError(locked, 'dispatcharr')).toBeNull()
  })
})

describe('describeResult', () => {
  const where = { address: 'http://tv.lan:9191', topic: 'channel-club-abc' }

  it.each([
    ['dispatcharr', { channels: 37, groups: 4 }, 'This server reached Dispatcharr', 'API key accepted · 37 channels in 4 groups'],
    ['dispatcharr', { channels: 1, groups: 1 }, 'This server reached Dispatcharr', 'API key accepted · 1 channel in 1 group'],
    ['ersatztv', { channels: 12, guideDays: 2 }, 'This server reached ErsatzTV', '12 channels · the guide covers the next 2 days'],
    ['ersatztv', { channels: 1, guideDays: 1 }, 'This server reached ErsatzTV', '1 channel · the guide covers the next day'],
    ['ersatztv', { channels: 3, guideDays: 0 }, 'This server reached ErsatzTV', '3 channels · no guide for the days ahead'],
    ['ersatztv', { channels: 3, guideDays: null }, 'This server reached ErsatzTV', "3 channels · the guide didn't load in time"],
    ['giphy', {}, 'Key accepted', 'The GIF button will show in chat.'],
    ['zipline', { username: 'channel-club' }, 'Connected to Zipline', 'Signed in as channel-club'],
    ['ntfy', {}, 'Test notification sent', 'Subscribe to channel-club-abc in the ntfy app to get reports on your phone.'],
  ] as const)('words a passed %s test with its counts', (kind, counts, title, detail) => {
    expect(describeResult(kind, { ok: true, counts }, where)).toEqual({ tone: 'ok', title, detail })
  })

  it.each([
    ['dispatcharr', 'unreachable', "Couldn't connect to tv.lan:9191"],
    ['dispatcharr', 'timeout', "tv.lan:9191 didn't answer in time"],
    ['dispatcharr', 'auth', 'Dispatcharr rejected the API key'],
    ['dispatcharr', 'not_found', "Dispatcharr's API isn't at tv.lan:9191"],
    ['dispatcharr', 'http', 'tv.lan:9191 answered with an error'],
    ['dispatcharr', 'invalid', "tv.lan:9191 doesn't look like Dispatcharr"],
    ['ersatztv', 'not_found', 'No ErsatzTV channel list at tv.lan:9191'],
    ['giphy', 'auth', 'GIPHY rejected this key'],
    ['giphy', 'unreachable', "Couldn't connect to GIPHY"],
    ['zipline', 'auth', 'Zipline rejected the token'],
    ['ntfy', 'auth', 'tv.lan:9191 refused the message'],
  ] as const)('words a failed %s test (%s)', (kind, reason, title) => {
    const row = describeResult(kind, { ok: false, reason }, where)

    expect(row.tone).toBe('bad')
    expect(row.title).toBe(title)
    expect(row.detail).not.toBe('')
  })

  it("names the address as typed when it won't parse", () => {
    expect(hostOf('  not a url ')).toBe('not a url')
    expect(hostOf('https://tv.example.com/path')).toBe('tv.example.com')
  })
})
