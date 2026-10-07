import { describe, it, expect, vi, afterEach } from 'vitest'
import { configView, settingsState } from '@/test/settingsFixtures'
import {
  afterSave,
  draftDefaults,
  differsFromDefault,
  fieldValue,
  formatNumber,
  isDirty,
  isShown,
  lockedBy,
  newNtfyTopic,
  parseNumber,
  parseOrigins,
  secretEntry,
  secretFilled,
  sectionPatch,
  setField,
  setSourceOn,
  sourceOn,
  EMPTY_DRAFT,
} from './configDraft'

// A stand-in secret (spaced, so no scanner takes it for a real one)
const KEY = 'api key one'

describe('what a setting shows', () => {
  it('is the saved value until the draft changes it', () => {
    const state = settingsState({ dispatcharrUrl: 'http://tv.lan' })

    expect(fieldValue(state, 'dispatcharrUrl')).toBe('http://tv.lan')
    expect(fieldValue({ ...state, draft: setField(state.draft, 'dispatcharrUrl', 'http://new.lan') }, 'dispatcharrUrl'))
      .toBe('http://new.lan')
  })

  it("is the environment's value when locked, whatever the draft says", () => {
    const state = settingsState(
      { dispatcharrUrl: 'http://env.lan' },
      { values: { dispatcharrUrl: 'http://draft.lan' } },
      { locked: { dispatcharrUrl: ['DISPATCHARR_URL'] } }
    )

    expect(fieldValue(state, 'dispatcharrUrl')).toBe('http://env.lan')
    expect(lockedBy(state.view, 'dispatcharrUrl')).toEqual(['DISPATCHARR_URL'])
    expect(lockedBy(state.view, 'ersatztvBaseUrl')).toBeNull()
  })

  it('shows bytes in MB or KB and the logo sources as one line', () => {
    const state = settingsState({ ersatztvLogoOrigins: ['https://a.example', 'https://b.example'] })

    expect(fieldValue(state, 'mediaExportMaxBytes')).toBe('256')
    expect(fieldValue(state, 'requestBodyMaxBytes')).toBe('64')
    expect(fieldValue(state, 'castSessionTimeout')).toBe('300')
    expect(fieldValue(state, 'ersatztvLogoOrigins')).toBe('https://a.example, https://b.example')
  })

  it('shows a size that is not a whole unit to two places', () => {
    expect(formatNumber('mediaExportMaxBytes', 300_000_000)).toBe('286.1')
  })

  it('reads a role the environment set to something else as viewer', () => {
    expect(fieldValue(settingsState({ plexDefaultRole: 'Admin?' }), 'plexDefaultRole')).toBe('viewer')
    expect(fieldValue(settingsState({ plexDefaultRole: 'admin' }), 'plexDefaultRole')).toBe('admin')
  })
})

describe('numbers', () => {
  it('parse whole numbers in the shown unit into what the server stores', () => {
    expect(parseNumber('mediaExportMaxBytes', ' 512 ')).toBe(512 * 1024 * 1024)
    expect(parseNumber('requestBodyMaxBytes', '128')).toBe(128 * 1024)
    expect(parseNumber('castHlsListSize', '7')).toBe(7)
  })

  it.each(['', '1.5', '-2', '1e3', 'ten'])('refuse %j', (text) => {
    expect(parseNumber('castHlsListSize', text)).toBeNull()
  })
})

describe('secrets', () => {
  it('count as filled when saved, typed, but not once Remove is pressed', () => {
    const saved = settingsState({ dispatcharrApiKey: { set: true } })

    expect(secretFilled(secretEntry(saved, 'dispatcharrApiKey'))).toBe(true)
    expect(secretFilled(secretEntry({ ...saved, draft: setField(saved.draft, 'dispatcharrApiKey', '') }, 'dispatcharrApiKey')))
      .toBe(true)
    expect(secretFilled(secretEntry({ ...saved, draft: setField(saved.draft, 'dispatcharrApiKey', null) }, 'dispatcharrApiKey')))
      .toBe(false)
    const unsaved = settingsState()
    expect(secretFilled(secretEntry(unsaved, 'dispatcharrApiKey'))).toBe(false)
    expect(secretFilled(secretEntry({ ...unsaved, draft: setField(unsaved.draft, 'dispatcharrApiKey', KEY) }, 'dispatcharrApiKey')))
      .toBe(true)
  })

  it('treat a key of spaces as not typed, but a password of spaces as typed', () => {
    const state = settingsState({}, { values: { dispatcharrApiKey: '   ', viewerPassword: '   ' } })

    expect(secretEntry(state, 'dispatcharrApiKey').typed).toBe(false)
    expect(secretEntry(state, 'viewerPassword').typed).toBe(true)
  })

  it('ignore the draft of a locked secret', () => {
    const state = settingsState(
      { dispatcharrApiKey: { set: true } },
      { values: { dispatcharrApiKey: KEY } },
      { locked: { dispatcharrApiKey: ['DISPATCHARR_URL'] } }
    )

    expect(secretEntry(state, 'dispatcharrApiKey')).toEqual({ draft: undefined, typed: false, saved: true, locked: true })
  })
})

describe('sources', () => {
  it('are on when they have an address, until switched', () => {
    const state = settingsState({ dispatcharrUrl: 'http://tv.lan' })

    expect(sourceOn(state, 'dispatcharr')).toBe(true)
    expect(sourceOn(state, 'ersatztv')).toBe(false)
    expect(sourceOn({ ...state, draft: setSourceOn(state.draft, 'dispatcharr', false) }, 'dispatcharr')).toBe(false)
    expect(sourceOn({ ...state, draft: setSourceOn(state.draft, 'ersatztv', true) }, 'ersatztv')).toBe(true)
  })

  it('stay on when the environment sets them', () => {
    const state = settingsState(
      { ersatztvBaseUrl: 'http://etv.lan' },
      { sources: { ersatztv: false } },
      { locked: { ersatztvBaseUrl: ['ERSATZTV_BASE_URL'] } }
    )

    expect(sourceOn(state, 'ersatztv')).toBe(true)
  })

  it('hide their settings while off', () => {
    const state = settingsState()

    expect(isShown(state, 'dispatcharrApiKey')).toBe(false)
    expect(isShown({ ...state, draft: setSourceOn(state.draft, 'dispatcharr', true) }, 'dispatcharrApiKey')).toBe(true)
  })
})

describe('switches', () => {
  it('hide what sits behind them, two deep for Zipline', () => {
    const clipsOnly = settingsState({ highlightEnabled: true })
    const both = settingsState({ highlightEnabled: true, ziplineEnabled: true })

    expect(isShown(clipsOnly, 'ziplineEnabled')).toBe(true)
    expect(isShown(clipsOnly, 'ziplineUrl')).toBe(false)
    expect(isShown(both, 'ziplineUrl')).toBe(true)
    expect(isShown(settingsState({ ziplineEnabled: true }), 'ziplineUrl')).toBe(false)
  })
})

describe('isDirty', () => {
  it('is false for an untouched setting and a draft equal to the saved value', () => {
    const state = settingsState({ chatEnabled: true })

    expect(isDirty(state, 'chatEnabled')).toBe(false)
    expect(isDirty({ ...state, draft: setField(state.draft, 'chatEnabled', true) }, 'chatEnabled')).toBe(false)
    expect(isDirty({ ...state, draft: setField(state.draft, 'chatEnabled', false) }, 'chatEnabled')).toBe(true)
  })

  it('compares numbers after the unit, so 256 MB is no change', () => {
    const state = settingsState()

    expect(isDirty({ ...state, draft: setField(state.draft, 'mediaExportMaxBytes', '256') }, 'mediaExportMaxBytes')).toBe(false)
    expect(isDirty({ ...state, draft: setField(state.draft, 'mediaExportMaxBytes', '512') }, 'mediaExportMaxBytes')).toBe(true)
    expect(isDirty({ ...state, draft: setField(state.draft, 'mediaExportMaxBytes', 'x') }, 'mediaExportMaxBytes')).toBe(true)
  })

  it('compares admin ids as a set and logo sources as a list', () => {
    const state = settingsState({ plexAdminIds: ['1', '2'], ersatztvLogoOrigins: ['https://a.example'] })

    expect(isDirty({ ...state, draft: setField(state.draft, 'plexAdminIds', ['2', '1']) }, 'plexAdminIds')).toBe(false)
    expect(isDirty({ ...state, draft: setField(state.draft, 'plexAdminIds', ['1']) }, 'plexAdminIds')).toBe(true)
    expect(isDirty({ ...state, draft: setField(state.draft, 'ersatztvLogoOrigins', ' https://a.example ') }, 'ersatztvLogoOrigins'))
      .toBe(false)
  })

  it('counts a secret changed when one is typed, or a saved one removed', () => {
    const saved = settingsState({ giphyApiKey: { set: true } })
    const unsaved = settingsState()

    expect(isDirty({ ...saved, draft: setField(saved.draft, 'giphyApiKey', '') }, 'giphyApiKey')).toBe(false)
    expect(isDirty({ ...saved, draft: setField(saved.draft, 'giphyApiKey', KEY) }, 'giphyApiKey')).toBe(true)
    expect(isDirty({ ...saved, draft: setField(saved.draft, 'giphyApiKey', null) }, 'giphyApiKey')).toBe(true)
    expect(isDirty({ ...unsaved, draft: setField(unsaved.draft, 'giphyApiKey', null) }, 'giphyApiKey')).toBe(false)
  })

  it('is never true for a locked setting', () => {
    const state = settingsState({}, { values: { logLevel: 'DEBUG' } }, { locked: { logLevel: ['LOG_LEVEL'] } })

    expect(isDirty(state, 'logLevel')).toBe(false)
  })
})

describe('sectionPatch', () => {
  it('is null when nothing changed', () => {
    expect(sectionPatch(settingsState(), 'extras')).toBeNull()
    expect(sectionPatch(settingsState({}, { values: { chatEnabled: false } }), 'extras')).toBeNull()
  })

  it('sends only the changed settings of its own section', () => {
    const state = settingsState({}, { values: { chatEnabled: true, ntfyEnabled: false, logLevel: 'DEBUG' } })

    expect(sectionPatch(state, 'extras')).toEqual({ chatEnabled: true })
    expect(sectionPatch(state, 'advanced')).toEqual({ logLevel: 'DEBUG' })
  })

  it('never sends a locked setting or an untouched secret', () => {
    const state = settingsState(
      { dispatcharrUrl: 'http://env.lan', dispatcharrApiKey: { set: true }, ersatztvBaseUrl: 'http://etv.lan' },
      { values: { dispatcharrUrl: 'http://draft.lan', ersatztvBaseUrl: 'http://etv2.lan' } },
      { locked: { dispatcharrUrl: ['DISPATCHARR_URL'], dispatcharrApiKey: ['DISPATCHARR_URL'] } }
    )

    expect(sectionPatch(state, 'sources')).toEqual({ ersatztvBaseUrl: 'http://etv2.lan' })
  })

  it('sends a typed secret trimmed, a password as typed, and null to remove one', () => {
    const state = settingsState(
      { localAuthEnabled: true, chatEnabled: true, giphyApiKey: { set: true }, viewerPassword: { set: false } },
      { values: { giphyApiKey: null, viewerPassword: ' pass phrase long ' } }
    )

    expect(sectionPatch(state, 'extras')).toEqual({ giphyApiKey: null })
    expect(sectionPatch(state, 'access')).toEqual({ viewerPassword: ' pass phrase long ' })
    const typed = settingsState({ chatEnabled: true }, { values: { giphyApiKey: `  ${KEY}\n` } })
    expect(sectionPatch(typed, 'extras')).toEqual({ giphyApiKey: KEY })
  })

  it('converts numbers to what the server stores and the logo sources to a list', () => {
    const state = settingsState(
      {},
      { values: { mediaExportMaxBytes: '512', requestBodyMaxBytes: '128', ersatztvLogoOrigins: 'https://a.example, https://b.example' } }
    )

    expect(sectionPatch(state, 'advanced')).toEqual({
      mediaExportMaxBytes: 512 * 1024 * 1024,
      requestBodyMaxBytes: 128 * 1024,
      ersatztvLogoOrigins: ['https://a.example', 'https://b.example'],
    })
  })

  it('trims addresses and the ntfy topic', () => {
    const state = settingsState(
      { ntfyEnabled: true },
      { values: { ntfyUrl: ' https://ntfy.sh ', ntfyTopic: ' club-topic ' } }
    )

    expect(sectionPatch(state, 'extras')).toEqual({ ntfyUrl: 'https://ntfy.sh', ntfyTopic: 'club-topic' })
  })

  it('leaves out settings behind a switch that is off', () => {
    const state = settingsState(
      { highlightEnabled: true },
      { values: { ziplineUrl: 'bad', ziplineToken: KEY, ntfyTopic: 'x', giphyApiKey: KEY } }
    )

    expect(sectionPatch(state, 'extras')).toBeNull()
  })

  it('saves an empty address for a source switched off, and nothing else of it', () => {
    const state = settingsState(
      { dispatcharrUrl: 'http://tv.lan', dispatcharrApiKey: { set: true } },
      { values: { dispatcharrApiKey: KEY }, sources: { dispatcharr: false, ersatztv: true } }
    )

    expect(sectionPatch(state, 'sources')).toEqual({ dispatcharrUrl: '' })
  })

  it('does not clear an address that was never saved', () => {
    const state = settingsState({}, { sources: { dispatcharr: false } })

    expect(sectionPatch(state, 'sources')).toBeNull()
  })
})

describe('afterSave', () => {
  it("takes the server's view and drops only what was saved from the draft", () => {
    const state = settingsState(
      {},
      { values: { dispatcharrUrl: 'http://TV.lan/', chatEnabled: true }, sources: { dispatcharr: true } }
    )
    const patch = sectionPatch(state, 'sources')!
    const view = configView({ dispatcharrUrl: 'http://tv.lan' })

    const next = afterSave(state, patch, view)

    expect(next.view).toBe(view)
    expect(next.draft.values).toEqual({ chatEnabled: true })
    // The server normalised the address; that is what shows now
    expect(fieldValue(next, 'dispatcharrUrl')).toBe('http://tv.lan')
    // The switch agrees with the saved address, so it no longer needs its own state
    expect(next.draft.sources).toEqual({})
  })

  it('keeps a source switch the saved address disagrees with', () => {
    const state = settingsState({}, { sources: { ersatztv: true } })

    expect(afterSave(state, { dispatcharrUrl: '' }, configView()).draft.sources).toEqual({ ersatztv: true })
  })
})

describe('defaults', () => {
  it('put unlocked settings back to the defaults and leave locked ones', () => {
    const state = settingsState(
      { castHlsListSize: 9, mediaExportMaxBytes: 512 * 1024 * 1024, logLevel: 'DEBUG' },
      {},
      { locked: { logLevel: ['LOG_LEVEL'] } }
    )

    const draft = draftDefaults(state, ['castHlsListSize', 'mediaExportMaxBytes', 'logLevel'])

    expect(draft.values).toEqual({ castHlsListSize: '5', mediaExportMaxBytes: '256' })
    expect(sectionPatch({ ...state, draft }, 'advanced')).toEqual({ castHlsListSize: 5, mediaExportMaxBytes: 256 * 1024 * 1024 })
  })

  it('mark a setting that differs from its default as shown', () => {
    const state = settingsState({ castHlsListSize: 9 })

    expect(differsFromDefault(state, 'castHlsListSize')).toBe(true)
    expect(differsFromDefault(state, 'castSessionTimeout')).toBe(false)
    expect(differsFromDefault({ ...state, draft: setField(state.draft, 'castHlsListSize', '5') }, 'castHlsListSize')).toBe(false)
    expect(differsFromDefault({ ...state, draft: setField(state.draft, 'logLevel', 'DEBUG') }, 'logLevel')).toBe(true)
    expect(differsFromDefault({ ...state, draft: setField(state.draft, 'ersatztvLogoOrigins', 'https://a.example') }, 'ersatztvLogoOrigins'))
      .toBe(true)
  })
})

describe('parseOrigins', () => {
  it('splits at commas, spaces and new lines', () => {
    expect(parseOrigins('https://a.example,https://b.example\nhttps://c.example  ')).toEqual([
      'https://a.example',
      'https://b.example',
      'https://c.example',
    ])
    expect(parseOrigins('  ')).toEqual([])
  })
})

describe('newNtfyTopic', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('names a topic with 12 random characters the topic rule accepts', () => {
    const topic = newNtfyTopic()

    expect(topic).toMatch(/^channel-club-[a-km-z2-9]{12}$/)
    expect(newNtfyTopic()).not.toBe(topic)
  })

  it('draws its characters from crypto.getRandomValues', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues')

    newNtfyTopic()

    expect(spy).toHaveBeenCalledWith(expect.any(Uint8Array))
    expect((spy.mock.calls[0][0] as Uint8Array).length).toBe(12)
  })
})

it('EMPTY_DRAFT holds nothing', () => {
  expect(EMPTY_DRAFT).toEqual({ values: {}, sources: {} })
})
