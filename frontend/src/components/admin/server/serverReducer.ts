import type {
  ConfigPatch,
  ConfigView,
  ConnectionTestResult,
  PlexAccount,
  PlexMember,
  PlexServer,
  TestKind,
} from '@/types/setup'
import {
  afterSave,
  draftDefaults,
  EMPTY_DRAFT,
  setField,
  setSourceOn,
  type Draft,
  type DraftValueOf,
  type PlainField,
  type SettingsState,
  type SourceKind,
} from '@/components/server-settings/model/configDraft'
import type { FormError, SettingsErrorKey } from '@/components/server-settings/model/failures'
import { ADVANCED_GROUPS, SECTION_FIELDS, type EditableField, type SectionId } from '@/components/server-settings/model/fields'
import { EMPTY_PLEX, plexSignedIn, type PlexSignIn } from '@/components/server-settings/model/plexSignIn'
import { testsAfterSave, type TestRecord } from '@/components/server-settings/model/testResults'

/*
 * The Admin panel's Server tab: the server's settings with the admin's
 * unsaved changes over them, and each section's own save. A section saves
 * only its settings; a problem saving one stays with it.
 */

export const SECTIONS = ['sources', 'access', 'extras', 'advanced'] as const satisfies readonly SectionId[]

export type SectionErrors = Partial<Record<SettingsErrorKey, string>>

/** A section's save: its errors, a problem with the section as a whole, and how the save went. */
export interface SectionState {
  errors: SectionErrors
  formError: FormError | null
  busy: boolean
  /** Saved, and nothing changed in it since */
  saved: boolean
}

export interface ServerState {
  settings: SettingsState | null
  /** A draft brought back from before a Plex redirect, applied when the settings load */
  pendingDraft: Draft | null
  sections: Record<SectionId, SectionState>
  tests: Partial<Record<TestKind, TestRecord>>
  /** The linked server's members; 'failed' when plex.tv wouldn't list them */
  members: readonly PlexMember[] | 'failed' | null
  /** The Plex sign-in a server is linked from */
  plex: PlexSignIn
  /** Re-link Plex is open: signing in to link the server again, or another one */
  relinking: boolean
  /** A server link is on its way */
  linking: boolean
}

const IDLE: SectionState = { errors: {}, formError: null, busy: false, saved: false }

/** Where the tab opens: with the draft and Re-link a Plex redirect left, if it left them. */
export function initialServerState(resumed?: { draft: Draft; relinking: boolean } | null): ServerState {
  return {
    settings: null,
    pendingDraft: resumed?.draft ?? null,
    sections: { sources: IDLE, access: IDLE, extras: IDLE, advanced: IDLE },
    tests: {},
    members: null,
    plex: EMPTY_PLEX,
    relinking: resumed?.relinking ?? false,
    linking: false,
  }
}

/** The section each setting is saved with. */
export const SECTION_OF = Object.fromEntries(
  SECTIONS.flatMap((section) => SECTION_FIELDS[section].map((field) => [field, section]))
) as Record<EditableField, SectionId>

const ADVANCED_PLAIN = ADVANCED_GROUPS.flatMap((group): readonly PlainField[] => group.fields)

export type ServerAction =
  | { type: 'configLoaded'; view: ConfigView }
  | { type: 'setField'; field: EditableField; value: DraftValueOf<EditableField> }
  | { type: 'setSource'; kind: SourceKind; on: boolean }
  | { type: 'resetAdvanced' }
  | { type: 'busy'; section: SectionId }
  | { type: 'failed'; section: SectionId; errors?: SectionErrors; formError?: FormError | null }
  | { type: 'saved'; section: SectionId; patch: ConfigPatch; view: ConfigView }
  | { type: 'linking' }
  | { type: 'linked'; view: ConfigView }
  | { type: 'members'; members: readonly PlexMember[] | 'failed' }
  | { type: 'testStarted'; kind: TestKind; fingerprint: string }
  | { type: 'testFinished'; kind: TestKind; fingerprint: string; result?: ConnectionTestResult; error?: string }
  | { type: 'plexSignedIn'; token: string; account: PlexAccount; servers: readonly PlexServer[] }
  | { type: 'plexSignedOut' }
  | { type: 'pickServer'; machineId: string }
  | { type: 'relink'; open: boolean }

function without(errors: SectionErrors, ...keys: SettingsErrorKey[]): SectionErrors {
  if (!keys.some((key) => key in errors)) return errors
  const next = { ...errors }
  for (const key of keys) delete next[key]
  return next
}

/** A section edited: its errors in `keys` go, and so does a problem saving it and its Saved. */
function edited(state: ServerState, section: SectionId, ...keys: SettingsErrorKey[]): ServerState['sections'] {
  const current = state.sections[section]
  return { ...state.sections, [section]: { ...current, errors: without(current.errors, ...keys), formError: null, saved: false } }
}

function withSection(state: ServerState, section: SectionId, change: Partial<SectionState>): ServerState['sections'] {
  return { ...state.sections, [section]: { ...state.sections[section], ...change } }
}

export function serverReducer(state: ServerState, action: ServerAction): ServerState {
  switch (action.type) {
    case 'configLoaded':
      return {
        ...state,
        settings: { view: action.view, draft: state.settings?.draft ?? state.pendingDraft ?? EMPTY_DRAFT },
        pendingDraft: null,
      }
    case 'setField': {
      if (!state.settings) return state
      const draft = setField(state.settings.draft, action.field, action.value)
      const keys: SettingsErrorKey[] = action.field === 'plexAuthEnabled' ? [action.field, 'plexLink', 'plex'] : [action.field]
      return { ...state, settings: { ...state.settings, draft }, sections: edited(state, SECTION_OF[action.field], ...keys) }
    }
    case 'setSource': {
      if (!state.settings) return state
      const draft = setSourceOn(state.settings.draft, action.kind, action.on)
      const fields: SettingsErrorKey[] = action.kind === 'dispatcharr' ? ['dispatcharrUrl', 'dispatcharrApiKey'] : ['ersatztvBaseUrl']
      // A source switched on answers "turn on a source"; one switched off drops its own errors
      return { ...state, settings: { ...state.settings, draft }, sections: edited(state, 'sources', ...(action.on ? ['sources' as const] : fields)) }
    }
    case 'resetAdvanced':
      if (!state.settings) return state
      return {
        ...state,
        settings: { ...state.settings, draft: draftDefaults(state.settings, ADVANCED_PLAIN) },
        sections: edited(state, 'advanced', ...ADVANCED_PLAIN),
      }
    case 'busy':
      return { ...state, sections: withSection(state, action.section, { busy: true, formError: null, saved: false }) }
    case 'failed':
      return {
        ...state,
        linking: false,
        sections: withSection(state, action.section, { errors: action.errors ?? {}, formError: action.formError ?? null, busy: false }),
      }
    case 'saved': {
      if (!state.settings) return state
      const settings = afterSave(state.settings, action.patch, action.view)
      return {
        ...state,
        settings,
        tests: testsAfterSave(state.tests, state.settings, settings),
        sections: withSection(state, action.section, { errors: {}, formError: null, busy: false, saved: true }),
      }
    }
    case 'linking':
      return { ...state, linking: true, sections: edited(state, 'access', 'plexLink', 'plex') }
    case 'linked':
      if (!state.settings) return state
      // The Plex sign-in has done its job: the server keeps its own token now
      return {
        ...state,
        settings: { ...state.settings, view: action.view },
        plex: EMPTY_PLEX,
        relinking: false,
        linking: false,
        sections: withSection(state, 'access', { errors: without(state.sections.access.errors, 'plexLink', 'plex') }),
      }
    case 'members':
      return { ...state, members: action.members }
    case 'testStarted':
      return { ...state, tests: { ...state.tests, [action.kind]: { fingerprint: action.fingerprint, running: true } } }
    case 'testFinished': {
      // Only the latest test of a kind reports
      if (state.tests[action.kind]?.fingerprint !== action.fingerprint) return state
      const record: TestRecord = { fingerprint: action.fingerprint, running: false, result: action.result, error: action.error }
      return { ...state, tests: { ...state.tests, [action.kind]: record } }
    }
    case 'plexSignedIn':
      return {
        ...state,
        plex: plexSignedIn(state.plex, action.token, action.account, action.servers),
        sections: withSection(state, 'access', { errors: without(state.sections.access.errors, 'plex') }),
      }
    case 'plexSignedOut':
      return { ...state, plex: EMPTY_PLEX }
    case 'pickServer':
      return {
        ...state,
        plex: { ...state.plex, machineId: action.machineId },
        sections: withSection(state, 'access', { errors: without(state.sections.access.errors, 'plex', 'plexLink') }),
      }
    case 'relink':
      return action.open
        ? { ...state, relinking: true }
        : {
            ...state,
            relinking: false,
            plex: EMPTY_PLEX,
            sections: withSection(state, 'access', { errors: without(state.sections.access.errors, 'plexLink', 'plex') }),
          }
  }
}
