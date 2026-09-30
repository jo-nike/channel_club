import { describe, it, expect } from 'vitest'
import { SetupApiError } from '@/services/setupApi'
import { linkFailure, plexErrorMessage, saveFailure, secretToRetype, testErrorMessage, warningText } from './failures'

describe('saveFailure', () => {
  const refused = (status: number, code?: string, fieldErrors?: Record<string, string>) =>
    new SetupApiError(status, 'The server says no', { code, fieldErrors })

  it('says why the server refused the whole step', () => {
    expect(saveFailure(refused(409, 'locked'), 'sources')).toEqual({
      formError: { message: "Part of this is now set by the server's environment. Reload the page to see what changed." },
    })
    expect(saveFailure(refused(409, 'self_lockout'), 'access')).toEqual({
      formError: { message: "That would lock you out, so it wasn't saved. Another admin can change it." },
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

describe('testErrorMessage', () => {
  it('asks for a moment after ntfy has just sent one, else says what went wrong', () => {
    expect(testErrorMessage(new SetupApiError(429, 'Wait a moment before testing again', { code: 'busy' }))).toBe(
      'Wait a few seconds before testing again.'
    )
    expect(testErrorMessage(new TypeError('Failed to fetch'))).toBe('Failed to fetch')
    expect(testErrorMessage('odd')).toBe("Couldn't run the test.")
  })
})

describe('secretToRetype', () => {
  it('names the saved secret the server won\'t send to a new address', () => {
    expect(secretToRetype(new SetupApiError(422, 'Enter it again', { code: 'secret_required', fieldErrors: { dispatcharrApiKey: 'Enter it again' } }))).toBe(
      'dispatcharrApiKey'
    )
    expect(secretToRetype(new SetupApiError(422, 'Too long', { code: 'string_too_long', fieldErrors: { ntfyTopic: 'Too long' } }))).toBeUndefined()
    expect(secretToRetype(new Error('odd'))).toBeUndefined()
  })
})

describe('warningText', () => {
  it("says a saved setting that won't work yet in the app's words, or the server's", () => {
    expect(warningText({ code: 'feedback_unavailable', message: 'Feedback needs an ntfy address and topic' })).toBe(
      'Saved. Feedback sends nothing until it has an ntfy address and topic.'
    )
    expect(warningText({ code: 'something_new', message: 'A newer server says so' })).toBe('A newer server says so')
  })
})
