import type { ConfigField, ConfigPatch, ConfigValues, ConfigView } from '@/types/setup'
import {
  isSecretField,
  NUMBER_SPECS,
  PASSWORD_FIELDS,
  SECTION_FIELDS,
  UNIT_BYTES,
  type EditableField,
  type EditableSecret,
  type NumberField,
  type SectionId,
} from './fields'

/*
 * The admin's unsaved changes (the draft) over what the server has saved (the
 * view). Pure functions: the setup wizard and the Admin panel hold the state.
 * What a setting shows: the environment's value when locked, else the draft,
 * else the saved value.
 */

/**
 * A draft value for each kind of setting. Numbers are the text typed, in the
 * unit shown; the logo sources are text too. A string replaces a secret and
 * null removes it.
 */
export type DraftValueOf<K extends EditableField> = K extends EditableSecret
  ? string | null
  : K extends NumberField | 'ersatztvLogoOrigins'
    ? string
    : ConfigValues[K]

export type DraftValues = { [K in EditableField]?: DraftValueOf<K> }

/** The settings that aren't secrets. */
export type PlainField = Exclude<EditableField, EditableSecret>

/** Where channels come from. The server keeps only an address: a source is on when it has one. */
export type SourceKind = 'dispatcharr' | 'ersatztv'

export const SOURCE_KINDS = ['dispatcharr', 'ersatztv'] as const satisfies readonly SourceKind[]

export const SOURCE_URL = {
  dispatcharr: 'dispatcharrUrl',
  ersatztv: 'ersatztvBaseUrl',
} as const satisfies Record<SourceKind, PlainField>

export interface Draft {
  values: DraftValues
  /** A source's switch once flipped; until then it follows the saved address */
  sources: Partial<Record<SourceKind, boolean>>
}

export const EMPTY_DRAFT: Draft = { values: {}, sources: {} }

/** The saved settings and the unsaved changes: everything a section reads. */
export interface SettingsState {
  view: ConfigView
  draft: Draft
}

type BooleanField = { [K in PlainField]: ConfigValues[K] extends boolean ? K : never }[PlainField]

/** The switches a setting sits behind: it is shown, checked and saved only while they are all on. */
const GATES: Partial<Record<EditableField, readonly (SourceKind | BooleanField)[]>> = {
  dispatcharrUrl: ['dispatcharr'],
  dispatcharrApiKey: ['dispatcharr'],
  ersatztvBaseUrl: ['ersatztv'],
  ersatztvApiKey: ['ersatztv'],
  plexAdminIds: ['plexAuthEnabled'],
  adminUsername: ['localAuthEnabled'],
  adminPassword: ['localAuthEnabled'],
  viewerUsername: ['localAuthEnabled'],
  viewerPassword: ['localAuthEnabled'],
  giphyApiKey: ['chatEnabled'],
  ziplineEnabled: ['highlightEnabled'],
  ziplineUrl: ['highlightEnabled', 'ziplineEnabled'],
  ziplineToken: ['highlightEnabled', 'ziplineEnabled'],
  ntfyUrl: ['ntfyEnabled'],
  ntfyTopic: ['ntfyEnabled'],
  ntfyToken: ['ntfyEnabled'],
}

/** Addresses and the ntfy topic lose surrounding spaces when saved, as the server would. */
const TRIMMED: ReadonlySet<EditableField> = new Set([
  'dispatcharrUrl',
  'ersatztvBaseUrl',
  'ziplineUrl',
  'ntfyUrl',
  'ntfyTopic',
])

const PASSWORDS: ReadonlySet<EditableField> = new Set(PASSWORD_FIELDS)

/** The environment variables that lock a setting, or null when the app can change it. */
export function lockedBy(view: ConfigView, field: ConfigField): readonly string[] | null {
  const names = view.locked[field]
  return names !== undefined && names.length > 0 ? names : null
}

export function isLocked(view: ConfigView, field: ConfigField): boolean {
  return lockedBy(view, field) !== null
}

function unitBytes(field: NumberField): number {
  const unit = NUMBER_SPECS[field].unit
  return unit === 'MB' || unit === 'KB' ? UNIT_BYTES[unit] : 1
}

/** A number as its field shows it: bytes in MB or KB. */
export function formatNumber(field: NumberField, value: number): string {
  const shown = value / unitBytes(field)
  return String(Number.isInteger(shown) ? shown : Math.round(shown * 100) / 100)
}

/** Typed text as the number the server stores, or null when it isn't a whole number. */
export function parseNumber(field: NumberField, text: string): number | null {
  const digits = text.trim()
  return /^\d+$/.test(digits) ? Number(digits) * unitBytes(field) : null
}

export function formatOrigins(origins: readonly string[]): string {
  return origins.join(', ')
}

/** Typed logo sources, split at commas and spaces. */
export function parseOrigins(text: string): string[] {
  return text.split(/[\s,]+/).filter((origin) => origin !== '')
}

/** A setting of `values` in draft form. */
function asDraft<K extends PlainField>(values: ConfigValues, field: K): DraftValueOf<K> {
  const value = values[field]
  if (field === 'ersatztvLogoOrigins') return formatOrigins(value as string[]) as DraftValueOf<K>
  if (typeof value === 'number') return formatNumber(field as NumberField, value) as DraftValueOf<K>
  return value as DraftValueOf<K>
}

/** What a setting shows: the saved value when it is locked or untouched, otherwise the draft. */
export function fieldValue<K extends PlainField>(state: SettingsState, field: K): DraftValueOf<K> {
  const draft = state.draft.values[field]
  if (draft !== undefined && !isLocked(state.view, field)) return draft as DraftValueOf<K>
  return asDraft(state.view.values, field)
}

/** A secret as a form shows it. */
export interface SecretEntry {
  /** Typed to replace it; null once Remove was pressed; undefined while untouched */
  draft: string | null | undefined
  /** A new one is typed (a key or token with more than spaces, a password with anything) */
  typed: boolean
  saved: boolean
  locked: boolean
}

export function secretEntry(state: SettingsState, field: EditableSecret): SecretEntry {
  const locked = isLocked(state.view, field)
  const draft = locked ? undefined : state.draft.values[field]
  const typed = typeof draft === 'string' && (PASSWORDS.has(field) ? draft !== '' : draft.trim() !== '')
  return { draft, typed, saved: state.view.values[field].set, locked }
}

/** The setting will have this secret once saved: a new one is typed, or the saved one stays. */
export function secretFilled(entry: SecretEntry): boolean {
  return entry.typed || (entry.draft !== null && entry.saved)
}

export function sourceOn(state: SettingsState, kind: SourceKind): boolean {
  const url = SOURCE_URL[kind]
  if (isLocked(state.view, url)) return true
  return state.draft.sources[kind] ?? state.view.values[url] !== ''
}

/** Whether every switch a setting sits behind is on. */
export function isShown(state: SettingsState, field: EditableField): boolean {
  return (GATES[field] ?? []).every((gate) =>
    gate === 'dispatcharr' || gate === 'ersatztv' ? sourceOn(state, gate) : fieldValue(state, gate) === true
  )
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i])
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return sameList([...new Set(a)].sort(), [...new Set(b)].sort())
}

/** Whether saving would change a setting. Locked settings and untouched secrets never change. */
export function isDirty(state: SettingsState, field: EditableField): boolean {
  const draft = state.draft.values[field]
  if (draft === undefined || isLocked(state.view, field)) return false
  if (isSecretField(field)) {
    const entry = secretEntry(state, field)
    return entry.typed || (entry.draft === null && entry.saved)
  }
  const saved = state.view.values[field]
  if (field === 'ersatztvLogoOrigins') return !sameList(parseOrigins(draft as string), saved as string[])
  if (field === 'plexAdminIds') return !sameSet(draft as string[], saved as string[])
  if (typeof saved === 'number') return parseNumber(field as NumberField, draft as string) !== saved
  return draft !== saved
}

function patchValue(state: SettingsState, field: EditableField): unknown {
  const draft = state.draft.values[field]
  if (typeof draft === 'string') {
    if (field === 'ersatztvLogoOrigins') return parseOrigins(draft)
    if (typeof state.view.values[field] === 'number') return parseNumber(field as NumberField, draft)
    if (isSecretField(field)) return PASSWORDS.has(field) ? draft : draft.trim()
    if (TRIMMED.has(field)) return draft.trim()
  }
  return draft
}

/**
 * The PUT body that saves a section: its changed settings that are shown and
 * not locked, never an untouched secret, and an empty address for a source
 * switched off. Null when saving would change nothing. Check the section
 * with validateSection first.
 */
export function sectionPatch(state: SettingsState, section: SectionId): ConfigPatch | null {
  const patch: Record<string, unknown> = {}
  for (const field of SECTION_FIELDS[section]) {
    if (isShown(state, field) && isDirty(state, field)) patch[field] = patchValue(state, field)
  }
  if (section === 'sources') {
    for (const kind of SOURCE_KINDS) {
      const url = SOURCE_URL[kind]
      if (!sourceOn(state, kind) && state.view.values[url] !== '') patch[url] = ''
    }
  }
  return Object.keys(patch).length > 0 ? (patch as ConfigPatch) : null
}

/** After a save: the server's new view, and the draft without what was saved. */
export function afterSave(state: SettingsState, patch: ConfigPatch, view: ConfigView): SettingsState {
  const values: DraftValues = { ...state.draft.values }
  for (const field of Object.keys(patch) as EditableField[]) delete values[field]
  const sources = { ...state.draft.sources }
  for (const kind of SOURCE_KINDS) {
    // A switch that agrees with the saved address needs no override
    if (sources[kind] === (view.values[SOURCE_URL[kind]] !== '')) delete sources[kind]
  }
  return { view, draft: { values, sources } }
}

export function setField<K extends EditableField>(draft: Draft, field: K, value: DraftValueOf<K>): Draft {
  return { ...draft, values: { ...draft.values, [field]: value } }
}

export function setSourceOn(draft: Draft, kind: SourceKind, on: boolean): Draft {
  return { ...draft, sources: { ...draft.sources, [kind]: on } }
}

/** The draft with these settings back at the server's defaults; locked ones stay as they are. */
export function draftDefaults(state: SettingsState, fields: readonly PlainField[]): Draft {
  let draft = state.draft
  for (const field of fields) {
    if (!isLocked(state.view, field)) draft = setField(draft, field, asDraft(state.view.defaults, field))
  }
  return draft
}

/** Whether a setting as shown differs from the server's default (Advanced marks it "changed"). */
export function differsFromDefault(state: SettingsState, field: PlainField): boolean {
  const shown = fieldValue(state, field)
  const fallback = state.view.defaults[field]
  if (field === 'ersatztvLogoOrigins') return !sameList(parseOrigins(shown as string), fallback as string[])
  if (typeof fallback === 'number') return parseNumber(field as NumberField, shown as string) !== fallback
  if (Array.isArray(fallback)) return !sameSet(shown as string[], fallback)
  return shown !== asDraft(state.view.defaults, field)
}

/** 32 characters that can't be misread for one another. */
const TOPIC_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789'

/** A fresh ntfy topic nobody could guess: 12 random characters, 60 bits. */
export function newNtfyTopic(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return `channel-club-${Array.from(bytes, (byte) => TOPIC_CHARS[byte % TOPIC_CHARS.length]).join('')}`
}
