import {
  fieldValue,
  isDirty,
  isLocked,
  isShown,
  parseNumber,
  parseOrigins,
  secretEntry,
  secretFilled,
  sourceOn,
  type SettingsState,
} from './configDraft'
import {
  MAX_LOGO_ORIGINS,
  NUMBER_SPECS,
  SECTION_FIELDS,
  type EditableField,
  type NumberField,
  type SectionId,
} from './fields'

/*
 * The checks a section passes before it is saved: the server's own rules,
 * worded for the form, so a 422 is rare. Settings that are locked or hidden
 * behind a switch that is off are never checked.
 */

/** A sign-in name as the server takes it: 1-64 printable characters, no space at either end. */
// The server's pattern excludes control characters, so this one names them
// eslint-disable-next-line no-control-regex
export const USERNAME_PATTERN = /^[^\s\x00-\x1f\x7f](?:[^\x00-\x1f\x7f]{0,62}[^\s\x00-\x1f\x7f])?$/u
export const MIN_PASSWORD_LENGTH = 12
export const MAX_PASSWORD_LENGTH = 256
export const NTFY_TOPIC_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** A setting, or a problem with a whole section. */
export type ErrorKey = EditableField | 'sources' | 'plexLink'
export type SectionErrors = Partial<Record<ErrorKey, string>>

const EXTRAS_IN_URL = 'Use the address on its own, without a user name, ? or #.'

/** Characters as the server counts them: code points, not UTF-16 units. */
export function passwordLength(password: string): number {
  return Array.from(password).length
}

/** A new password's problem, or null. When `optional`, blank is fine. */
export function newPasswordError(password: string, optional: boolean): string | null {
  const length = passwordLength(password)
  if (optional && length === 0) return null
  if (length < MIN_PASSWORD_LENGTH) {
    return optional ? 'Use at least 12 characters, or leave it blank.' : 'Use at least 12 characters.'
  }
  return length > MAX_PASSWORD_LENGTH ? 'Use at most 256 characters.' : null
}

export function usernameError(name: string): string | null {
  if (name.trim() === '') return 'Choose a username.'
  return USERNAME_PATTERN.test(name) ? null : 'Use up to 64 characters, with no space at either end.'
}

/**
 * Why the server would refuse an address: 'invalid' when it isn't a full
 * http(s) address, 'extras' when it carries a user name, query or fragment.
 */
export function urlProblem(text: string): 'invalid' | 'extras' | null {
  const trimmed = text.trim()
  if (!/^https?:\/\//i.test(trimmed)) return 'invalid'
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return 'invalid'
  }
  if (!url.hostname || url.port === '0') return 'invalid'
  return url.username || url.password || url.search || url.hash ? 'extras' : null
}

/** An address's problem in words: `invalid` says what the field wants. */
export function urlError(text: string, invalid: string): string | null {
  const problem = urlProblem(text)
  return problem === 'invalid' ? invalid : problem === 'extras' ? EXTRAS_IN_URL : null
}

function numberError(field: NumberField, text: string): string | null {
  const { min, max } = NUMBER_SPECS[field]
  const digits = text.trim()
  const shown = /^\d+$/.test(digits) ? Number(digits) : null
  return shown !== null && shown >= min && shown <= max ? null : `Use a whole number from ${min} to ${max}.`
}

/** The errors saving a section would meet, keyed by setting, in the order the section shows them. */
export function validateSection(state: SettingsState, section: SectionId): SectionErrors {
  const errors: SectionErrors = {}
  const check = (field: EditableField, message: string | null) => {
    if (message !== null && isShown(state, field) && !isLocked(state.view, field)) errors[field] ??= message
  }

  if (section === 'sources') {
    if (!sourceOn(state, 'dispatcharr') && !sourceOn(state, 'ersatztv')) {
      errors.sources = 'Turn on Dispatcharr or ErsatzTV. The club needs at least one source of channels.'
    }
    check('dispatcharrUrl', urlError(fieldValue(state, 'dispatcharrUrl'), 'Enter the full address, starting with https:// or http://.'))
    check(
      'dispatcharrApiKey',
      secretFilled(secretEntry(state, 'dispatcharrApiKey')) ? null : 'Paste the API key from your Dispatcharr profile page.'
    )
    check('ersatztvBaseUrl', urlError(fieldValue(state, 'ersatztvBaseUrl'), 'Enter the full address, starting with http:// or https://.'))
  }

  if (section === 'access') {
    if (fieldValue(state, 'plexAuthEnabled') && !state.view.values.plexServerMachineId && !isLocked(state.view, 'plexAuthEnabled')) {
      errors.plexLink = 'Sign in with Plex to choose the server, or switch Plex members off.'
    }
    const logins = [
      ['adminUsername', 'adminPassword'],
      ['viewerUsername', 'viewerPassword'],
    ] as const
    for (const [name, password] of logins) {
      if (isDirty(state, name)) check(name, usernameError(fieldValue(state, name)))
      const entry = secretEntry(state, password)
      if (entry.typed) check(password, newPasswordError(entry.draft ?? '', true))
    }
    // The guest login can't share the admin's name while both can sign in
    const touched = logins.flat().some((field) => isDirty(state, field))
    const bothUsable = logins.every(([, password]) => secretFilled(secretEntry(state, password)))
    if (touched && bothUsable && fieldValue(state, 'adminUsername') === fieldValue(state, 'viewerUsername')) {
      check('viewerUsername', 'Use a different name from the admin login.')
    }
  }

  if (section === 'extras') {
    check('ziplineUrl', urlError(fieldValue(state, 'ziplineUrl'), 'Enter the Zipline address, starting with https://.'))
    check('ziplineToken', secretFilled(secretEntry(state, 'ziplineToken')) ? null : 'Paste the token from your Zipline account.')
    check('ntfyUrl', urlError(fieldValue(state, 'ntfyUrl'), 'Enter the ntfy server address, like https://ntfy.sh.'))
    check(
      'ntfyTopic',
      NTFY_TOPIC_PATTERN.test(fieldValue(state, 'ntfyTopic').trim()) ? null : 'Use only letters, numbers, - and _, up to 64 characters.'
    )
  }

  if (section === 'advanced') {
    for (const field of Object.keys(NUMBER_SPECS) as NumberField[]) {
      if (isDirty(state, field)) check(field, numberError(field, fieldValue(state, field)))
    }
    // The server's ring buffer holds whole segments
    if (isDirty(state, 'highlightSegmentSeconds') || isDirty(state, 'highlightBufferSeconds')) {
      const segment = parseNumber('highlightSegmentSeconds', fieldValue(state, 'highlightSegmentSeconds'))
      const buffer = parseNumber('highlightBufferSeconds', fieldValue(state, 'highlightBufferSeconds'))
      if (segment !== null && buffer !== null && segment > buffer) {
        check('highlightSegmentSeconds', 'Keep segments no longer than the seconds kept for clipping.')
      }
    }
    if (isDirty(state, 'ersatztvLogoOrigins')) {
      const origins = parseOrigins(fieldValue(state, 'ersatztvLogoOrigins'))
      if (origins.length > MAX_LOGO_ORIGINS) {
        check('ersatztvLogoOrigins', `Use up to ${MAX_LOGO_ORIGINS} addresses.`)
      } else if (origins.some((origin) => urlProblem(origin) !== null)) {
        check('ersatztvLogoOrigins', 'Use http:// or https:// addresses, separated by commas.')
      }
    }
  }

  return errors
}

const ERROR_ORDER: Record<SectionId, readonly ErrorKey[]> = {
  sources: ['sources', ...SECTION_FIELDS.sources],
  access: ['plexLink', ...SECTION_FIELDS.access],
  extras: SECTION_FIELDS.extras,
  advanced: SECTION_FIELDS.advanced,
}

/** The first error in the order the section shows them, to move focus to. */
export function firstError(section: SectionId, errors: SectionErrors): ErrorKey | null {
  return ERROR_ORDER[section].find((key) => errors[key] !== undefined) ?? null
}
