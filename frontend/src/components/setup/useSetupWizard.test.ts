import { describe, it, expect } from 'vitest'
import { SetupApiError } from '@/services/setupApi'
import { accountErrors, claimFailure } from './useSetupWizard'
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
