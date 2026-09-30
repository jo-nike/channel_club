import { SetupApiError } from '@/services/setupApi'
import type { ConfigWarning } from '@/types/setup'
import { SECTION_FIELDS, type EditableField, type SectionId } from './fields'
import type { ErrorKey } from './validation'

/*
 * What a failed save, Plex link or connection test shows, and what a saved
 * setting that won't work yet says. The server's codes pick the words; its
 * messages are for its logs. The setup wizard and the Admin panel's Server
 * tab both show these.
 */

/** A problem with a whole step or section. `signIn`: offer to go to the sign-in page instead. */
export interface FormError {
  message: string
  signIn?: boolean
}

/** A setting, a problem with a whole section, or the Plex sign-in. */
export type SettingsErrorKey = ErrorKey | 'plex'

export interface SettingsFailure {
  errors?: Partial<Record<SettingsErrorKey, string>>
  formError?: FormError
}

/** The server words these codes for logs; the app says them its own way. */
const PLEX_CALL_COPY: Partial<Record<string, string>> = {
  plex_token: "Plex didn't accept that sign-in. Sign in with Plex again.",
  plex_unavailable: "Plex isn't responding. Try again in a moment.",
  busy: 'Setup is busy talking to Plex. Try again in a moment.',
}

export const NOT_OWNER = "That Plex server isn't one of yours. Pick one you own."

/** Saving's refusals of the whole step. */
const SAVE_COPY: Partial<Record<string, string>> = {
  locked: "Part of this is now set by the server's environment. Reload the page to see what changed.",
  self_lockout: "That would lock you out, so it wasn't saved. Another admin can change it.",
  no_storage: 'This server has nowhere to keep settings. Give it a /data volume, restart it, then try again.',
  write_failed: "The server couldn't save the settings. Check that its data folder can be written to, then try again.",
}

/** A saved secret isn't sent to a new address: it has to be typed again. */
export const RETYPE_SECRET = 'Enter it again for the new address.'

/** Saving's refusals of one setting, as the form's own checks word them. */
const FIELD_COPY: Partial<Record<string, string>> = {
  secret_required: RETYPE_SECRET,
  username_taken: 'Use a different name from the admin login.',
  segment_too_long: 'Keep segments no longer than the seconds kept for clipping.',
}

/** Something saved that won't work yet. */
const WARNING_COPY: Partial<Record<string, string>> = {
  zipline_unavailable: 'Saved. Zipline uploads start once clips are on and Zipline has an address and a token.',
  feedback_unavailable: 'Saved. Feedback sends nothing until it has an ntfy address and topic.',
}

/** Why listing the Plex servers failed, for the form. */
export function plexErrorMessage(err: unknown): string {
  if (err instanceof SetupApiError) return (err.code !== undefined ? PLEX_CALL_COPY[err.code] : undefined) ?? err.message
  return err instanceof Error ? err.message : "Couldn't list your Plex servers."
}

/** What a failed save shows: each refused setting's error on it, or a problem with the step. */
export function saveFailure(err: unknown, section: SectionId): SettingsFailure {
  if (!(err instanceof SetupApiError)) {
    return { formError: { message: err instanceof Error ? err.message : "Couldn't save the settings." } }
  }
  const refusal = err.code !== undefined ? SAVE_COPY[err.code] : undefined
  if (refusal) return { formError: { message: refusal } }

  const fields: readonly string[] = SECTION_FIELDS[section]
  const errors: Partial<Record<SettingsErrorKey, string>> = {}
  for (const [field, message] of Object.entries(err.fieldErrors)) {
    if (message === undefined) continue
    if (err.code === 'plex_not_linked') errors.plexLink = 'Sign in with Plex to choose the server, or switch Plex members off.'
    else if (fields.includes(field)) errors[field as EditableField] = (err.code !== undefined ? FIELD_COPY[err.code] : undefined) ?? message
  }
  return Object.keys(errors).length > 0 ? { errors } : { formError: { message: err.message } }
}

/** What a failed Plex server link shows. */
export function linkFailure(err: unknown): SettingsFailure {
  if (!(err instanceof SetupApiError)) {
    return { formError: { message: err instanceof Error ? err.message : "Couldn't link that Plex server." } }
  }
  switch (err.code) {
    case 'plex_token':
      return { errors: { plexLink: plexErrorMessage(err) } }
    case 'not_owner':
      return { errors: { plexLink: NOT_OWNER } }
    case 'plex_unavailable':
    case 'busy':
      return { formError: { message: plexErrorMessage(err) } }
  }
  return { formError: { message: (err.code !== undefined ? SAVE_COPY[err.code] : undefined) ?? err.message } }
}

/** Why a test couldn't run, under its button. */
export function testErrorMessage(err: unknown): string {
  if (err instanceof SetupApiError && err.code === 'busy') return 'Wait a few seconds before testing again.'
  return err instanceof Error ? err.message : "Couldn't run the test."
}

/** A test refused because a saved secret would go to a new address: the secret to type again. */
export function secretToRetype(err: unknown): EditableField | undefined {
  if (!(err instanceof SetupApiError) || err.code !== 'secret_required') return undefined
  return Object.keys(err.fieldErrors)[0] as EditableField | undefined
}

/** What a warning after a save says. */
export function warningText(warning: ConfigWarning): string {
  return WARNING_COPY[warning.code] ?? warning.message
}
