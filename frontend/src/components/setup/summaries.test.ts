import { describe, it, expect } from 'vitest'
import { configView } from '@/test/settingsFixtures'
import type { ConfigValues } from '@/types/setup'
import { EMPTY_DRAFT, type Draft } from '@/components/server-settings/model/configDraft'
import { pickedServerName, stepSummary } from './summaries'
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
    expect(stepSummary(afterClaim({ chatEnabled: true, highlightEnabled: true, castEnabled: true, ntfyEnabled: true }), 'extras')).toBe(
      'Chat, clips, Chromecast, feedback'
    )
    expect(stepSummary(afterClaim({ castEnabled: true }), 'extras')).toBe('Chromecast')
  })
})
