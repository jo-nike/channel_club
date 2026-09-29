import { describe, it, expect } from 'vitest'
import { SetupApiError } from '@/services/setupApi'
import { accountErrors, claimFailure, linkFailure, plexErrorMessage, saveFailure } from './useSetupWizard'
import type { AccountDraft } from './wizardReducer'

const PASS = 'correct horse battery'

function account(overrides: Partial<AccountDraft> = {}): AccountDraft {
  return { method: 'password', username: 'sam', password: PASS, confirm: PASS, ...overrides }
}

describe('accountErrors', () => {
  it('passes an account the server would take', () => {
    expect(accountErrors(account())).toEqual({})
  })

  it('asks for a username, and a password of 12 characters or more', () => {
    expect(accountErrors(account({ username: '  ', password: 'short', confirm: 'short' }))).toEqual({
      username: 'Choose a username.',
      password: 'Use at least 12 characters.',
    })
  })

  it("says the passwords don't match only once the password itself is fine", () => {
    expect(accountErrors(account({ confirm: 'correct horse' }))).toEqual({ confirm: "The passwords don't match." })
    expect(accountErrors(account({ password: 'short', confirm: 'other' }))).toEqual({ password: 'Use at least 12 characters.' })
  })
})

describe('claimFailure', () => {
  const failed = (status: number, code?: string, fieldErrors?: Record<string, string>) =>
    new SetupApiError(status, 'The server says no', { code, fieldErrors })

  it('offers the sign-in page when the club is already set up', () => {
    expect(claimFailure(failed(409, 'already_claimed'), account())).toEqual({
      formError: { message: 'Someone else set up this club first.', signIn: true },
    })
    expect(claimFailure(failed(409, 'env_managed'), account())).toEqual({
      formError: { message: "Sign-in is set in this server's environment, so there's nothing to set up.", signIn: true },
    })
  })

  it('puts a Plex problem with the sign-in on the Plex sign-in', () => {
    expect(claimFailure(failed(400, 'plex_token'), account())).toEqual({
      errors: { plex: "Plex didn't accept that sign-in. Sign in with Plex again." },
    })
    expect(claimFailure(failed(403, 'not_owner'), account())).toEqual({
      errors: { plex: "That Plex server isn't one of yours. Pick one you own." },
    })
  })

  it('words the rest in its own voice, for the step as a whole', () => {
    expect(claimFailure(failed(503, 'plex_unavailable'), account())).toEqual({ formError: { message: "Plex isn't responding. Try again in a moment." } })
    expect(claimFailure(failed(429, 'busy'), account())).toEqual({ formError: { message: 'Setup is busy talking to Plex. Try again in a moment.' } })
    expect(claimFailure(failed(500, 'write_failed'), account())).toEqual({
      formError: { message: "The server couldn't save your account. Check that its data folder can be written to, then try again." },
    })
    expect(claimFailure(new SetupApiError(0, "Couldn't reach Channel Club's server.", { code: 'network' }), account())).toEqual({
      formError: { message: "Couldn't reach Channel Club's server." },
    })
    expect(claimFailure(new TypeError('Failed to parse'), account())).toEqual({ formError: { message: 'Failed to parse' } })
  })

  it("puts a refused username or password on its field, in the form's words where it has them", () => {
    const refused = failed(422, 'string_pattern_mismatch', { username: 'String should match pattern', password: 'Too long' })
    expect(claimFailure(refused, account({ username: ' sam' }))).toEqual({
      errors: { username: 'Use up to 64 characters, with no space at either end.', password: 'Too long' },
    })
    // Anything else the server refused is the step's
    expect(claimFailure(failed(422, 'string_pattern_mismatch', { machineId: 'Bad id' }), account())).toEqual({
      formError: { message: 'The server says no' },
    })
  })
})

describe('saveFailure', () => {
  const refused = (status: number, code?: string, fieldErrors?: Record<string, string>) =>
    new SetupApiError(status, 'The server says no', { code, fieldErrors })

  it('says why the server refused the whole step', () => {
    expect(saveFailure(refused(409, 'locked'), 'sources')).toEqual({
      formError: { message: "Part of this is now set by the server's environment. Reload the page to see what changed." },
    })
    expect(saveFailure(refused(409, 'self_lockout'), 'access')).toEqual({
      formError: { message: "That would switch off the sign-in you're using, so it wasn't saved." },
    })
    expect(saveFailure(refused(409, 'no_storage'), 'extras')).toEqual({
      formError: { message: 'This server has nowhere to keep settings. Give it a /data volume, restart it, then try again.' },
    })
    expect(saveFailure(refused(500, 'write_failed'), 'extras')).toEqual({
      formError: { message: "The server couldn't save the settings. Check that its data folder can be written to, then try again." },
    })
    expect(saveFailure(new TypeError('Failed to fetch'), 'extras')).toEqual({ formError: { message: 'Failed to fetch' } })
  })

  it("puts a refused setting's error on it, in the form's words where it has them", () => {
    expect(saveFailure(refused(422, 'username_taken', { viewerUsername: 'Use a different name from the admin login' }), 'access')).toEqual({
      errors: { viewerUsername: 'Use a different name from the admin login.' },
    })
    expect(saveFailure(refused(422, 'segment_too_long', { highlightSegmentSeconds: 'Keep segments short' }), 'advanced')).toEqual({
      errors: { highlightSegmentSeconds: 'Keep segments no longer than the seconds kept for clipping.' },
    })
    expect(saveFailure(refused(422, 'greater_than_equal', { mediaProcessLimit: 'Input should be at least 1' }), 'advanced')).toEqual({
      errors: { mediaProcessLimit: 'Input should be at least 1' },
    })
  })

  it('asks for a Plex sign-in when Plex members were saved with no server linked', () => {
    expect(saveFailure(refused(422, 'plex_not_linked', { plexAuthEnabled: 'Link a Plex server first' }), 'access')).toEqual({
      errors: { plexLink: 'Sign in with Plex to choose the server, or switch Plex members off.' },
    })
  })

  it("keeps a refusal of a setting that isn't the step's for the step", () => {
    expect(saveFailure(refused(422, 'string_too_long', { ntfyTopic: 'Too long' }), 'sources')).toEqual({
      formError: { message: 'The server says no' },
    })
  })
})

describe('linkFailure', () => {
  const refused = (status: number, code?: string) => new SetupApiError(status, 'The server says no', { code })

  it('puts a problem with the Plex sign-in or server on the link', () => {
    expect(linkFailure(refused(400, 'plex_token'))).toEqual({ errors: { plexLink: "Plex didn't accept that sign-in. Sign in with Plex again." } })
    expect(linkFailure(refused(403, 'not_owner'))).toEqual({ errors: { plexLink: "That Plex server isn't one of yours. Pick one you own." } })
  })

  it('says the rest for the step', () => {
    expect(linkFailure(refused(503, 'plex_unavailable'))).toEqual({ formError: { message: "Plex isn't responding. Try again in a moment." } })
    expect(linkFailure(refused(500, 'write_failed'))).toEqual({
      formError: { message: "The server couldn't save the settings. Check that its data folder can be written to, then try again." },
    })
    expect(linkFailure(refused(409, 'locked'))).toEqual({
      formError: { message: "Part of this is now set by the server's environment. Reload the page to see what changed." },
    })
    expect(linkFailure(refused(502))).toEqual({ formError: { message: 'The server says no' } })
  })
})

describe('plexErrorMessage', () => {
  it("says a Plex listing's failure in the wizard's words, or the server's", () => {
    expect(plexErrorMessage(new SetupApiError(400, 'Plex refused', { code: 'plex_token' }))).toBe(
      "Plex didn't accept that sign-in. Sign in with Plex again."
    )
    expect(plexErrorMessage(new SetupApiError(401, 'Not authenticated'))).toBe('Not authenticated')
    expect(plexErrorMessage('odd')).toBe("Couldn't list your Plex servers.")
  })
})
