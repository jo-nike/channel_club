import { describe, it, expect } from 'vitest'
import { configView } from '@/test/settingsFixtures'
import type { PlexServer, SetupFacts } from '@/types/setup'
import { EMPTY_DRAFT, fieldValue } from '@/components/server-settings/model/configDraft'
import {
  initialWizardState,
  startingDraft,
  wizardReducer,
  type WizardAction,
  type WizardAdmin,
  type WizardState,
} from './wizardReducer'

const ADMIN: WizardAdmin = { signIn: 'password', username: 'sam', plexId: null }
const FACTS: SetupFacts = {
  dispatcharrChannels: 37,
  ersatztvChannels: null,
  plexServerName: null,
  features: { chat: true, gifs: false, clips: false, feedback: false },
}
const SERVERS: PlexServer[] = [
  { machineId: 'cabin', name: 'Cabin NAS', online: false },
  { machineId: 'home', name: 'Home Server', online: true },
]

function run(state: WizardState, ...actions: WizardAction[]): WizardState {
  return actions.reduce(wizardReducer, state)
}

const unclaimed = () => initialWizardState({ setupState: 'unclaimed' })
const claimed = () => initialWizardState({ setupState: 'claimed', admin: ADMIN })
const loaded = (view = configView()) => run(claimed(), { type: 'configLoaded', view })

describe('where the wizard opens', () => {
  it('opens a new club at Welcome, and nothing past Your account before the claim', () => {
    expect(unclaimed()).toMatchObject({ step: 'welcome', reached: 0, admin: null, settings: null })
    // Even a stash that says otherwise
    expect(initialWizardState({ setupState: 'unclaimed', step: 'extras', reached: 4 })).toMatchObject({ step: 'account', reached: 1 })
  })

  it('opens a claimed club where the admin got to, and at Channels at the earliest', () => {
    expect(claimed()).toMatchObject({ step: 'sources', reached: 2, admin: ADMIN })
    expect(initialWizardState({ setupState: 'claimed', step: 'extras', reached: 4 })).toMatchObject({ step: 'extras', reached: 4 })
    expect(initialWizardState({ setupState: 'claimed', step: 'welcome', reached: 0 })).toMatchObject({ step: 'sources', reached: 2 })
    // Never a step beyond the furthest reached
    expect(initialWizardState({ setupState: 'claimed', step: 'review', reached: 3 })).toMatchObject({ step: 'access', reached: 3 })
  })

  it('takes the sign-in and username a Plex redirect kept, with no password', () => {
    const state = initialWizardState({ setupState: 'unclaimed', step: 'account', reached: 1, account: { method: 'password', username: 'sam' } })
    expect(state.account).toEqual({ method: 'password', username: 'sam', password: '', confirm: '' })
    expect(unclaimed().account).toEqual({ method: 'plex', username: 'admin', password: '', confirm: '' })
  })
})

describe('moving between steps', () => {
  it('opens only a step already reached', () => {
    const state = run(unclaimed(), { type: 'advance' })
    expect(state).toMatchObject({ step: 'account', reached: 1 })

    expect(run(state, { type: 'goTo', step: 'sources' })).toBe(state)
    expect(run(state, { type: 'goTo', step: 'welcome' })).toMatchObject({ step: 'welcome', reached: 1 })
  })

  it('never continues past Your account before the claim', () => {
    expect(run(unclaimed(), { type: 'advance' }, { type: 'advance' })).toMatchObject({ step: 'account', reached: 1 })
  })

  it('continues to Review once claimed, and no further', () => {
    const state = run(claimed(), { type: 'advance' }, { type: 'advance' }, { type: 'advance' }, { type: 'advance' })
    expect(state).toMatchObject({ step: 'review', reached: 5 })
  })

  it('leaves errors behind with the step', () => {
    const failed = run(unclaimed(), { type: 'advance' }, { type: 'failed', errors: { username: 'Choose a username.' }, formError: { message: 'Nope' } })
    expect(run(failed, { type: 'goTo', step: 'welcome' })).toMatchObject({ errors: {}, formError: null })
  })

  it('opens Channels once the club is claimed, and forgets the password', () => {
    const state = run(
      unclaimed(),
      { type: 'advance' },
      { type: 'setMethod', method: 'password' },
      { type: 'setAccount', field: 'password', value: 'correct horse battery' },
      { type: 'setAccount', field: 'confirm', value: 'correct horse battery' },
      { type: 'busy', busy: 'claim' },
      { type: 'claimed', admin: ADMIN }
    )
    expect(state).toMatchObject({ setupState: 'claimed', step: 'sources', reached: 2, admin: ADMIN, busy: null })
    expect(state.account).toMatchObject({ password: '', confirm: '' })
  })

  it('marks every step reached when setup finishes, and opens none after', () => {
    const done = run(loaded(), { type: 'busy', busy: 'complete' }, { type: 'completed', facts: FACTS })
    expect(done).toMatchObject({ done: true, facts: FACTS, reached: 5, busy: null })
    expect(run(done, { type: 'goTo', step: 'sources' })).toBe(done)
  })
})

describe('errors', () => {
  it('an edit clears its own error and no other', () => {
    const failed = run(unclaimed(), { type: 'failed', errors: { username: 'Choose a username.', password: 'Use at least 12 characters.' } })
    expect(run(failed, { type: 'setAccount', field: 'username', value: 'sam' }).errors).toEqual({ password: 'Use at least 12 characters.' })
  })

  it('choosing the other sign-in clears the account errors and the step error', () => {
    const failed = run(unclaimed(), {
      type: 'failed',
      errors: { username: 'Choose a username.', plex: 'Sign in with Plex to continue.' },
      formError: { message: 'Nope' },
    })
    expect(run(failed, { type: 'setMethod', method: 'plex' })).toMatchObject({ errors: {}, formError: null, account: { method: 'plex' } })
  })

  it("a setting edited clears its error; Plex members clears the link's too", () => {
    const failed = run(loaded(), { type: 'failed', errors: { dispatcharrUrl: 'Enter the full address.', plexLink: 'Sign in with Plex.' } })
    expect(run(failed, { type: 'setField', field: 'dispatcharrUrl', value: 'http://tv.lan' }).errors).toEqual({ plexLink: 'Sign in with Plex.' })
    expect(run(failed, { type: 'setField', field: 'plexAuthEnabled', value: false }).errors).toEqual({ dispatcharrUrl: 'Enter the full address.' })
  })

  it("a source switched on answers the missing source; one switched off drops its own fields' errors", () => {
    const failed = run(loaded(), {
      type: 'failed',
      errors: { sources: 'Turn on a source.', dispatcharrUrl: 'Enter the address.', dispatcharrApiKey: 'Paste the key.', ersatztvBaseUrl: 'Enter it.' },
    })
    expect(run(failed, { type: 'setSource', kind: 'ersatztv', on: true }).errors).toEqual({
      dispatcharrUrl: 'Enter the address.',
      dispatcharrApiKey: 'Paste the key.',
      ersatztvBaseUrl: 'Enter it.',
    })
    expect(run(failed, { type: 'setSource', kind: 'dispatcharr', on: false }).errors).toEqual({ sources: 'Turn on a source.', ersatztvBaseUrl: 'Enter it.' })
  })

  it('saving clears the step error, and a failure ends saving', () => {
    const failed = run(loaded(), { type: 'failed', formError: { message: 'Nope' } })
    const saving = run(failed, { type: 'busy', busy: 'save' })
    expect(saving).toMatchObject({ busy: 'save', formError: null })
    expect(run(saving, { type: 'failed', errors: { ntfyTopic: 'Use only letters.' } })).toMatchObject({ busy: null, errors: { ntfyTopic: 'Use only letters.' } })
  })
})

describe('Plex sign-in', () => {
  const signIn = (servers: readonly PlexServer[]): WizardAction => ({ type: 'plexSignedIn', token: 'tok-1', account: { username: 'jon' }, servers })

  it('picks the first server online, or the first there is', () => {
    expect(run(unclaimed(), signIn(SERVERS)).plex).toEqual({ token: 'tok-1', account: { username: 'jon' }, servers: SERVERS, machineId: 'home' })
    expect(run(unclaimed(), signIn([SERVERS[0]])).plex.machineId).toBe('cabin')
    expect(run(unclaimed(), signIn([])).plex.machineId).toBeNull()
  })

  it('keeps the server picked while it is still listed', () => {
    const picked = run(unclaimed(), signIn(SERVERS), { type: 'pickServer', machineId: 'cabin' })
    expect(run(picked, signIn(SERVERS)).plex.machineId).toBe('cabin')
    expect(run(picked, signIn([SERVERS[1]])).plex.machineId).toBe('home')
  })

  it('clears the Plex error on signing in or picking', () => {
    const failed = run(unclaimed(), { type: 'failed', errors: { plex: 'Sign in with Plex to continue.' }, formError: { message: 'Plex is slow' } })
    expect(run(failed, signIn(SERVERS))).toMatchObject({ errors: {}, formError: null })
    expect(run(failed, { type: 'pickServer', machineId: 'home' }).errors).toEqual({})
  })

  it('forgets the sign-in on signing out', () => {
    expect(run(unclaimed(), signIn(SERVERS), { type: 'plexSignedOut' }).plex).toEqual({ token: null, account: null, servers: [], machineId: null })
  })
})

describe('the server settings', () => {
  it('start with Dispatcharr on while no source is set up', () => {
    expect(startingDraft(configView())).toEqual({ ...EMPTY_DRAFT, sources: { dispatcharr: true } })
    expect(startingDraft(configView({ ersatztvBaseUrl: 'http://etv.lan' }))).toEqual(EMPTY_DRAFT)
    expect(startingDraft(configView({}, { locked: { dispatcharrUrl: ['DISPATCHARR_URL'] } }))).toEqual(EMPTY_DRAFT)
  })

  it('load under the draft kept across a Plex redirect, once', () => {
    const kept = { values: { chatEnabled: true }, sources: { ersatztv: true } }
    const state = run(initialWizardState({ setupState: 'claimed', admin: ADMIN, draft: kept }), { type: 'configLoaded', view: configView() })
    expect(state.settings?.draft).toEqual(kept)
    expect(state.pendingDraft).toBeNull()
  })

  it('keep the draft being edited when they load again', () => {
    const edited = run(loaded(), { type: 'setField', field: 'chatEnabled', value: true })
    const again = run(edited, { type: 'configLoaded', view: configView({ ntfyUrl: 'https://ntfy.sh' }) })
    expect(again.settings?.draft).toBe(edited.settings?.draft)
    expect(again.settings?.view.values.ntfyUrl).toBe('https://ntfy.sh')
  })

  it("ignore edits made before they've loaded", () => {
    const state = claimed()
    expect(run(state, { type: 'setField', field: 'chatEnabled', value: true })).toBe(state)
    expect(run(state, { type: 'setSource', kind: 'ersatztv', on: true })).toBe(state)
    expect(run(state, { type: 'resetAdvanced' })).toBe(state)
  })

  it('drop what was saved from the draft', () => {
    const edited = run(loaded(), { type: 'setField', field: 'chatEnabled', value: true }, { type: 'busy', busy: 'save' })
    const saved = run(edited, { type: 'saved', patch: { chatEnabled: true }, view: configView({ chatEnabled: true }) })
    expect(saved).toMatchObject({ busy: null })
    expect(saved.settings?.draft.values).toEqual({})
    expect(fieldValue(saved.settings!, 'chatEnabled')).toBe(true)
  })

  it('put Advanced back to the defaults', () => {
    const view = configView({ mediaProcessLimit: 12, logLevel: 'DEBUG' })
    const state = run(loaded(view), { type: 'failed', errors: { mediaProcessLimit: 'Use a whole number.' } }, { type: 'resetAdvanced' })
    expect(fieldValue(state.settings!, 'mediaProcessLimit')).toBe('8')
    expect(fieldValue(state.settings!, 'logLevel')).toBe('INFO')
    expect(state.errors).toEqual({})
  })

  it('take a newly linked Plex server, clear the link error and forget the Plex sign-in', () => {
    const linking = run(
      loaded(),
      { type: 'plexSignedIn', token: 'tok-1', account: { username: 'jon' }, servers: SERVERS },
      { type: 'failed', errors: { plexLink: 'Sign in with Plex.' } },
      { type: 'busy', busy: 'link' }
    )
    const linked = run(linking, { type: 'linked', view: configView({ plexServerMachineId: 'home' }) })
    expect(linked).toMatchObject({ busy: null, errors: {} })
    expect(linked.settings?.view.values.plexServerMachineId).toBe('home')
    expect(linked.plex).toEqual({ token: null, account: null, servers: [], machineId: null })
  })
})

describe('connection tests', () => {
  it('report only the latest test of a kind', () => {
    const started = run(loaded(), { type: 'testStarted', kind: 'dispatcharr', fingerprint: 'first' }, { type: 'testStarted', kind: 'dispatcharr', fingerprint: 'second' })
    const stale = run(started, { type: 'testFinished', kind: 'dispatcharr', fingerprint: 'first', result: { ok: true } })
    expect(stale).toBe(started)

    const finished = run(started, { type: 'testFinished', kind: 'dispatcharr', fingerprint: 'second', result: { ok: false, reason: 'auth' } })
    expect(finished.tests.dispatcharr).toEqual({ fingerprint: 'second', running: false, result: { ok: false, reason: 'auth' }, error: undefined })
  })
})
