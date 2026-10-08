import { describe, it, expect } from 'vitest'
import { EMPTY_DRAFT } from '@/components/server-settings/model/configDraft'
import { configView } from '@/test/settingsFixtures'
import { initialServerState, serverReducer, type ServerAction, type ServerState } from './serverReducer'

function loaded(values = {}): ServerState {
  return serverReducer(initialServerState(), { type: 'configLoaded', view: configView(values) })
}

function run(state: ServerState, ...actions: ServerAction[]): ServerState {
  return actions.reduce(serverReducer, state)
}

describe('serverReducer', () => {
  it('opens with the draft a Plex redirect left, once the settings load', () => {
    const draft = { values: { chatEnabled: true }, sources: {} }
    const state = run(initialServerState({ draft, relinking: true }), { type: 'configLoaded', view: configView() })

    expect(state.settings?.draft).toEqual(draft)
    expect(state.relinking).toBe(true)
    expect(state.pendingDraft).toBeNull()
  })

  it('keeps unsaved changes when the settings load again', () => {
    const state = run(loaded(), { type: 'setField', field: 'chatEnabled', value: true }, { type: 'configLoaded', view: configView() })
    expect(state.settings?.draft.values).toEqual({ chatEnabled: true })
  })

  it("keeps each section's problems to itself", () => {
    const state = run(
      loaded(),
      { type: 'failed', section: 'sources', errors: { dispatcharrUrl: 'Enter the address' } },
      { type: 'failed', section: 'extras', formError: { message: 'Not saved' } },
      { type: 'setField', field: 'ntfyTopic', value: 'reports' }
    )

    expect(state.sections.sources.errors).toEqual({ dispatcharrUrl: 'Enter the address' })
    // Editing Extras clears its problem, not Channels'
    expect(state.sections.extras.formError).toBeNull()
  })

  it('clears an error when its setting is edited, and a Plex link problem when Plex members switch', () => {
    const state = run(
      loaded(),
      { type: 'failed', section: 'access', errors: { plexLink: 'Sign in with Plex', viewerUsername: 'Taken' } },
      { type: 'setField', field: 'plexAuthEnabled', value: false }
    )
    expect(state.sections.access.errors).toEqual({ viewerUsername: 'Taken' })

    const next = run(state, { type: 'setField', field: 'viewerUsername', value: 'guest' })
    expect(next.sections.access.errors).toEqual({})
  })

  it('says a section saved until it is edited again, and saves nothing of the others', () => {
    const saved = run(
      loaded(),
      { type: 'setField', field: 'chatEnabled', value: true },
      { type: 'setField', field: 'logLevel', value: 'DEBUG' },
      { type: 'busy', section: 'extras' },
      { type: 'saved', section: 'extras', patch: { chatEnabled: true }, view: configView({ chatEnabled: true }) }
    )

    expect(saved.sections.extras).toMatchObject({ busy: false, saved: true })
    expect(saved.settings?.view.values.chatEnabled).toBe(true)
    // Advanced's change is still a draft
    expect(saved.settings?.draft.values).toEqual({ logLevel: 'DEBUG' })

    const edited = run(saved, { type: 'setField', field: 'giphyApiKey', value: 'a key' })
    expect(edited.sections.extras.saved).toBe(false)
  })

  it('a source switched on answers "turn on a source"; one switched off drops its own errors', () => {
    const state = run(loaded(), {
      type: 'failed',
      section: 'sources',
      errors: { sources: 'Turn one on', dispatcharrUrl: 'Enter it', ersatztvBaseUrl: 'Enter it' },
    })

    expect(run(state, { type: 'setSource', kind: 'ersatztv', on: true }).sections.sources.errors).toEqual({
      dispatcharrUrl: 'Enter it',
      ersatztvBaseUrl: 'Enter it',
    })
    expect(run(state, { type: 'setSource', kind: 'dispatcharr', on: false }).sections.sources.errors).toEqual({
      sources: 'Turn one on',
      ersatztvBaseUrl: 'Enter it',
    })
  })

  it('puts Advanced back to the defaults, clearing its errors', () => {
    const state = run(
      loaded({ mediaProcessLimit: 3 }),
      { type: 'failed', section: 'advanced', errors: { mediaProcessLimit: 'Too many' } },
      { type: 'resetAdvanced' }
    )
    expect(state.settings?.draft.values.mediaProcessLimit).toBe('8')
    expect(state.sections.advanced.errors).toEqual({})
  })

  it('closes Re-link and forgets the Plex sign-in once linked', () => {
    const signedIn = run(
      loaded(),
      { type: 'relink', open: true },
      { type: 'plexSignedIn', token: 'tok', account: { username: 'jon' }, servers: [{ machineId: 'home', name: 'Home', online: true }] }
    )
    expect(signedIn.plex.machineId).toBe('home')

    const linking = run(signedIn, { type: 'linking' })
    expect(linking.linking).toBe(true)

    const linked = run(linking, { type: 'linked', view: configView({ plexServerMachineId: 'home' }) })
    expect(linked).toMatchObject({ relinking: false, linking: false, plex: { token: null, machineId: null } })
    expect(linked.settings?.view.values.plexServerMachineId).toBe('home')
  })

  it('forgets the sign-in and its problems when Re-link is cancelled, and stops linking on a failure', () => {
    const state = run(
      loaded(),
      { type: 'relink', open: true },
      { type: 'plexSignedIn', token: 'tok', account: { username: 'jon' }, servers: [] },
      { type: 'linking' },
      { type: 'failed', section: 'access', errors: { plexLink: 'Not yours' } }
    )
    expect(state.linking).toBe(false)

    const cancelled = run(state, { type: 'relink', open: false })
    expect(cancelled).toMatchObject({ relinking: false, plex: { token: null } })
    expect(cancelled.sections.access.errors).toEqual({})
  })

  it('reports only the latest test of a kind', () => {
    const state = run(
      loaded(),
      { type: 'testStarted', kind: 'giphy', fingerprint: 'a' },
      { type: 'testStarted', kind: 'giphy', fingerprint: 'b' },
      { type: 'testFinished', kind: 'giphy', fingerprint: 'a', result: { ok: false, reason: 'auth' } }
    )
    expect(state.tests.giphy).toEqual({ fingerprint: 'b', running: true })
  })

  it('starts with no draft, and nothing changes before the settings load', () => {
    const state = initialServerState()
    expect(run(state, { type: 'setField', field: 'chatEnabled', value: true })).toBe(state)
    expect(loaded().settings?.draft).toEqual(EMPTY_DRAFT)
  })
})
