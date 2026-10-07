import { describe, it, expect } from 'vitest'
import { configView } from '@/test/settingsFixtures'
import type { ConfigValues, SetupFacts } from '@/types/setup'
import { EMPTY_DRAFT, type Draft } from '@/components/server-settings/model/configDraft'
import { testFingerprint } from '@/components/server-settings/model/testResults'
import { onAirFacts, pickedServerName, reviewRows, stepSummary } from './summaries'
import { initialWizardState, wizardReducer, type WizardAdmin, type WizardState } from './wizardReducer'

const SERVERS = [
  { machineId: 'cabin', name: 'Cabin NAS', online: false },
  { machineId: 'home', name: 'Home Server', online: true },
]

function beforeClaim(method: 'plex' | 'password', username = 'admin'): WizardState {
  return initialWizardState({ setupState: 'unclaimed', account: { method, username } })
}

function signedInToPlex(state: WizardState): WizardState {
  return wizardReducer(state, { type: 'plexSignedIn', token: 'tok-1', account: { username: 'jon' }, servers: SERVERS })
}

const PASSWORD_ADMIN: WizardAdmin = { signIn: 'password', username: 'sam', plexId: null }

/** A claimed club with these settings saved, loaded under `draft` (or the wizard's starting draft). */
function afterClaim(
  values: Partial<ConfigValues> = {},
  { draft, admin = PASSWORD_ADMIN, plexServerName = null }: { draft?: Draft; admin?: WizardAdmin; plexServerName?: string | null } = {}
): WizardState {
  const state = initialWizardState({ setupState: 'claimed', admin, draft })
  return wizardReducer(state, { type: 'configLoaded', view: configView(values, { plexServerName }) })
}

describe('pickedServerName', () => {
  it('names the server picked, or nothing before a Plex sign-in', () => {
    expect(pickedServerName(beforeClaim('plex'))).toBeNull()
    const signedIn = signedInToPlex(beforeClaim('plex'))
    expect(pickedServerName(signedIn)).toBe('Home Server')
    expect(pickedServerName(wizardReducer(signedIn, { type: 'pickServer', machineId: 'cabin' }))).toBe('Cabin NAS')
  })
})

describe('stepSummary', () => {
  it('says nothing for Welcome, and Checked for Review', () => {
    expect(stepSummary(afterClaim(), 'welcome')).toBe('')
    expect(stepSummary(afterClaim(), 'review')).toBe('Checked')
  })

  it('names the sign-in being chosen before the claim', () => {
    expect(stepSummary(beforeClaim('plex'), 'account')).toBe('Plex')
    expect(stepSummary(signedInToPlex(beforeClaim('plex')), 'account')).toBe('Plex · Home Server')
    expect(stepSummary(beforeClaim('password', 'sam'), 'account')).toBe('Password · sam')
    expect(stepSummary(beforeClaim('password', ''), 'account')).toBe('Password · admin')
  })

  it("names the admin's sign-in after the claim, with the linked server", () => {
    const plexAdmin: WizardAdmin = { signIn: 'plex', username: 'jon', plexId: '101' }
    expect(stepSummary(afterClaim(), 'account')).toBe('Password · sam')
    expect(stepSummary(afterClaim({}, { admin: plexAdmin, plexServerName: 'Home Server' }), 'account')).toBe('Plex · Home Server')
    expect(stepSummary(initialWizardState({ setupState: 'claimed', admin: plexAdmin }), 'account')).toBe('Plex · your server')
  })

  it("says nothing about a settings step until the settings have loaded", () => {
    const state = initialWizardState({ setupState: 'claimed', admin: null })
    expect(['sources', 'access', 'extras'].map((step) => stepSummary(state, step as 'sources'))).toEqual(['', '', ''])
  })

  it('lists the sources switched on, as the draft has them', () => {
    expect(stepSummary(afterClaim(), 'sources')).toBe('Dispatcharr')
    expect(stepSummary(afterClaim({ dispatcharrUrl: 'http://tv.lan', ersatztvBaseUrl: 'http://etv.lan' }), 'sources')).toBe('Dispatcharr + ErsatzTV')
    expect(stepSummary(afterClaim({}, { draft: { values: {}, sources: { dispatcharr: false } } }), 'sources')).toBe('No source yet')
  })

  it('says who can join', () => {
    expect(stepSummary(afterClaim(), 'access')).toBe('Admin only')
    // Plex members count once a server is linked
    expect(stepSummary(afterClaim({ plexAuthEnabled: true }), 'access')).toBe('Admin only')
    expect(stepSummary(afterClaim({ plexAuthEnabled: true, plexServerMachineId: 'home' }), 'access')).toBe('Plex members')
    expect(
      stepSummary(afterClaim({ plexAuthEnabled: true, plexServerMachineId: 'home', plexDefaultRole: 'admin', localAuthEnabled: true }), 'access')
    ).toBe('Plex, as admins, passwords')
    expect(stepSummary(afterClaim({ localAuthEnabled: true }, { draft: { ...EMPTY_DRAFT, values: { viewerPassword: 'guest pass 1' } } }), 'access')).toBe(
      'Passwords, guest'
    )
  })

  it('lists the extras switched on', () => {
    expect(stepSummary(afterClaim(), 'extras')).toBe('None')
    expect(stepSummary(afterClaim({ chatEnabled: true, highlightEnabled: true, nhlEnabled: true, ntfyEnabled: true }), 'extras')).toBe(
      'Chat, clips, NHL scores, feedback'
    )
    expect(stepSummary(afterClaim({ ntfyEnabled: true }), 'extras')).toBe('Feedback')
  })
})

describe('reviewRows', () => {
  const lines = (state: WizardState, step: string) =>
    reviewRows(state, state.settings!).find((row) => row.step === step)?.lines.map((line) => (line.warn ? `! ${line.text}` : line.text))

  it("names the admin's sign-in", () => {
    expect(lines(afterClaim(), 'account')).toEqual(['Username and password, as sam'])
    const plexAdmin: WizardAdmin = { signIn: 'plex', username: 'jon', plexId: '101' }
    expect(lines(afterClaim({}, { admin: plexAdmin, plexServerName: 'Home Server' }), 'account')).toEqual([
      'Plex, signed in as jon',
      'Server: Home Server',
    ])
  })

  it("says how each source's last test went, for the address shown", () => {
    const state = afterClaim({ dispatcharrUrl: 'https://tv.example.com', dispatcharrApiKey: { set: true }, ersatztvBaseUrl: 'http://etv.lan' })
    expect(lines(state, 'sources')).toEqual(['Dispatcharr · not tested', 'ErsatzTV · not tested'])

    const tested = [
      { type: 'testStarted', kind: 'dispatcharr', fingerprint: testFingerprint(state.settings!, 'dispatcharr') },
      { type: 'testFinished', kind: 'dispatcharr', fingerprint: testFingerprint(state.settings!, 'dispatcharr'), result: { ok: true, counts: { channels: 37 } } },
      { type: 'testStarted', kind: 'ersatztv', fingerprint: testFingerprint(state.settings!, 'ersatztv') },
      { type: 'testFinished', kind: 'ersatztv', fingerprint: testFingerprint(state.settings!, 'ersatztv'), result: { ok: false, reason: 'timeout' } },
    ] as const
    expect(lines(tested.reduce(wizardReducer, state), 'sources')).toEqual(['Dispatcharr · 37 channels', '! ErsatzTV · last test failed'])
    expect(lines(afterClaim({}, { draft: { values: {}, sources: { dispatcharr: false } } }), 'sources')).toEqual(['! No source yet'])
  })

  it('says who can join and how', () => {
    const plexAdmin: WizardAdmin = { signIn: 'plex', username: 'jon', plexId: '101' }
    const linked = afterClaim(
      // The owner is an admin whether listed or not
      { plexAuthEnabled: true, plexServerMachineId: 'home', plexAdminIds: ['202'], plexDefaultRole: 'admin', userChannelSelection: true },
      { admin: plexAdmin, plexServerName: 'Home Server' }
    )
    const withMembers = wizardReducer(linked, {
      type: 'members',
      members: [
        { plexId: '101', username: 'jon', managed: false, owner: true, admin: true },
        { plexId: '202', username: 'sam', managed: false, owner: false, admin: true },
        { plexId: '303', username: 'kim', managed: false, owner: false, admin: false },
      ],
    })
    expect(lines(withMembers, 'access')).toEqual([
      'Plex members of Home Server join as admins',
      'Admins: jon, sam',
      'Anyone can change the live channel',
      'Others see only who is online',
    ])
    expect(lines(afterClaim({ localAuthEnabled: true, adminPassword: { set: true }, presenceVisible: true }), 'access')).toEqual([
      'Admin login: admin',
      'No guest login',
      'Only admins change the live channel',
      'Everyone sees what others watch',
    ])
    expect(
      lines(afterClaim({ localAuthEnabled: true }, { draft: { ...EMPTY_DRAFT, values: { viewerUsername: 'lounge', viewerPassword: 'guest pass 1' } } }), 'access')
    ).toEqual(['No password admin login', 'Guest login: lounge', 'Only admins change the live channel', 'Others see only who is online'])
  })

  it('lists the extras on', () => {
    expect(lines(afterClaim(), 'extras')).toEqual(['None'])
    expect(
      lines(
        afterClaim({
          chatEnabled: true,
          giphyApiKey: { set: true },
          highlightEnabled: true,
          ziplineEnabled: true,
          nhlEnabled: true,
          ntfyEnabled: true,
          ntfyTopic: 'club-news',
        }),
        'extras'
      )
    ).toEqual(['Chat, with GIFs', 'Clips, shared through Zipline', 'NHL scores', 'Feedback to the ntfy topic club-news'])
    expect(lines(afterClaim({ chatEnabled: true, highlightEnabled: true }), 'extras')).toEqual(['Chat', 'Clips'])
  })
})

describe('onAirFacts', () => {
  const facts = (overrides: Partial<SetupFacts> = {}, features: Partial<SetupFacts['features']> = {}): SetupFacts => ({
    dispatcharrChannels: null,
    ersatztvChannels: null,
    plexServerName: null,
    ...overrides,
    features: { chat: false, gifs: false, clips: false, nhl: false, feedback: false, ...features },
  })

  it('counts the channels from every source that answered', () => {
    expect(onAirFacts(facts({ dispatcharrChannels: 37, ersatztvChannels: 12 }))).toEqual(['49 channels'])
    expect(onAirFacts(facts({ ersatztvChannels: 1 }))).toEqual(['1 channel'])
    expect(onAirFacts(facts())).toEqual([])
  })

  it('names who can join and the extras that are on', () => {
    expect(onAirFacts(facts({ dispatcharrChannels: 0, plexServerName: 'Home Server' }, { chat: true, clips: true, feedback: true }))).toEqual([
      '0 channels',
      'Members of Home Server can join',
      'Chat on',
      'Clips on',
    ])
  })
})
