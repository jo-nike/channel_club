import type {
  ConfigPatch,
  ConfigView,
  ConnectionTestResult,
  EnvLock,
  PlexAccount,
  PlexMember,
  PlexServer,
  SetupFacts,
  TestKind,
} from '@/types/setup'
import {
  afterSave,
  draftDefaults,
  EMPTY_DRAFT,
  isLocked,
  setField,
  setSourceOn,
  SOURCE_KINDS,
  SOURCE_URL,
  type Draft,
  type DraftValueOf,
  type PlainField,
  type SettingsState,
  type SourceKind,
} from '@/components/server-settings/model/configDraft'
import { ADVANCED_GROUPS, type EditableField } from '@/components/server-settings/model/fields'
import { testsAfterSave, type TestRecord } from '@/components/server-settings/model/testResults'
import type { ErrorKey } from '@/components/server-settings/model/validation'
import { FIRST_CLAIMED_STEP, STEPS, stepIndex, type StepId } from './steps'

export type AccountMethod = 'plex' | 'password'

/** The claim form: which sign-in, and for a password, the account to make. */
export interface AccountDraft {
  method: AccountMethod
  username: string
  password: string
  confirm: string
}

/** Plex as the claim form holds it. The token stays in memory: it is never stored. */
export interface PlexSignIn {
  token: string | null
  account: PlexAccount | null
  servers: readonly PlexServer[]
  machineId: string | null
}

/** The admin at the screen, once the club is claimed. */
export interface WizardAdmin {
  signIn: AccountMethod
  username: string
  plexId: string | null
}

export type AccountField = 'username' | 'password' | 'confirm'
export type WizardErrorKey = ErrorKey | AccountField | 'plex'

/** A problem with a step as a whole. `signIn`: offer to go to the sign-in page instead. */
export interface FormError {
  message: string
  signIn?: boolean
}

export type Busy = null | 'claim' | 'save' | 'link' | 'complete'

export interface WizardState {
  setupState: 'unclaimed' | 'claimed'
  done: boolean
  step: StepId
  /** The furthest step open in the rail (an index into STEPS) */
  reached: number
  /** What the environment sets, from the setup status (only listed while unclaimed) */
  envLocked: readonly EnvLock[]
  account: AccountDraft
  plex: PlexSignIn
  admin: WizardAdmin | null
  /** The server's settings and the draft over them, once claimed and loaded */
  settings: SettingsState | null
  /** A draft brought back from before a Plex redirect, applied when the settings load */
  pendingDraft: Draft | null
  members: readonly PlexMember[] | 'loading' | 'failed' | null
  errors: Partial<Record<WizardErrorKey, string>>
  formError: FormError | null
  busy: Busy
  tests: Partial<Record<TestKind, TestRecord>>
  facts: SetupFacts | null
}

/** Where the wizard starts: from the setup status, stored progress or a Plex redirect's stash. */
export interface WizardStart {
  setupState: 'unclaimed' | 'claimed'
  envLocked?: readonly EnvLock[]
  step?: StepId
  reached?: number
  account?: Partial<Pick<AccountDraft, 'method' | 'username'>>
  admin?: WizardAdmin | null
  draft?: Draft | null
}

export const EMPTY_PLEX: PlexSignIn = { token: null, account: null, servers: [], machineId: null }

export function initialWizardState(start: WizardStart): WizardState {
  const claimed = start.setupState === 'claimed'
  // Before the claim nothing past Your account is open; after it, Channels at least
  const reached = claimed
    ? Math.max(start.reached ?? FIRST_CLAIMED_STEP, FIRST_CLAIMED_STEP)
    : Math.min(start.reached ?? 0, stepIndex('account'))
  const wanted = start.step ? stepIndex(start.step) : claimed ? FIRST_CLAIMED_STEP : 0
  const index = Math.min(Math.max(wanted, claimed ? FIRST_CLAIMED_STEP : 0), reached)
  return {
    setupState: start.setupState,
    done: false,
    step: STEPS[index],
    reached,
    envLocked: start.envLocked ?? [],
    account: { method: 'plex', username: 'admin', password: '', confirm: '', ...start.account },
    plex: EMPTY_PLEX,
    admin: start.admin ?? null,
    settings: null,
    pendingDraft: start.draft ?? null,
    members: null,
    errors: {},
    formError: null,
    busy: null,
    tests: {},
    facts: null,
  }
}

/**
 * A fresh draft for the settings the server has. With no source set up yet,
 * Dispatcharr starts switched on, as the wizard first shows it.
 */
export function startingDraft(view: ConfigView): Draft {
  const anySource = SOURCE_KINDS.some((kind) => view.values[SOURCE_URL[kind]] !== '' || isLocked(view, SOURCE_URL[kind]))
  return anySource ? EMPTY_DRAFT : { ...EMPTY_DRAFT, sources: { dispatcharr: true } }
}

/** The first online server, or the first one. */
function defaultServer(servers: readonly PlexServer[]): string | null {
  return (servers.find((server) => server.online) ?? servers[0])?.machineId ?? null
}

const ADVANCED_PLAIN = ADVANCED_GROUPS.flatMap((group): readonly PlainField[] => group.fields)

export type WizardAction =
  | { type: 'goTo'; step: StepId }
  | { type: 'advance' }
  | { type: 'setMethod'; method: AccountMethod }
  | { type: 'setAccount'; field: AccountField; value: string }
  | { type: 'plexSignedIn'; token: string; account: PlexAccount; servers: readonly PlexServer[] }
  | { type: 'plexSignedOut' }
  | { type: 'pickServer'; machineId: string }
  | { type: 'claimed'; admin: WizardAdmin }
  | { type: 'configLoaded'; view: ConfigView }
  | { type: 'setField'; field: EditableField; value: DraftValueOf<EditableField> }
  | { type: 'setSource'; kind: SourceKind; on: boolean }
  | { type: 'resetAdvanced' }
  | { type: 'failed'; errors?: Partial<Record<WizardErrorKey, string>>; formError?: FormError | null }
  | { type: 'busy'; busy: Busy }
  | { type: 'saved'; patch: ConfigPatch; view: ConfigView }
  | { type: 'linked'; view: ConfigView }
  | { type: 'members'; members: readonly PlexMember[] | 'loading' | 'failed' }
  | { type: 'testStarted'; kind: TestKind; fingerprint: string }
  | { type: 'testFinished'; kind: TestKind; fingerprint: string; result?: ConnectionTestResult; error?: string }
  | { type: 'completed'; facts: SetupFacts }

function without<K extends string>(errors: Partial<Record<K, string>>, ...keys: K[]): Partial<Record<K, string>> {
  if (!keys.some((key) => key in errors)) return errors
  const next = { ...errors }
  for (const key of keys) delete next[key]
  return next
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'goTo': {
      // Moving about never saves or checks anything; steps not reached stay shut
      if (state.done || stepIndex(action.step) > state.reached) return state
      return { ...state, step: action.step, errors: {}, formError: null }
    }
    case 'advance': {
      const next = stepIndex(state.step) + 1
      // Your account is passed only by claiming the club
      if (next >= STEPS.length || (state.setupState === 'unclaimed' && next > stepIndex('account'))) return state
      return { ...state, step: STEPS[next], reached: Math.max(state.reached, next), errors: {}, formError: null, busy: null }
    }
    case 'setMethod':
      return {
        ...state,
        account: { ...state.account, method: action.method },
        errors: without(state.errors, 'plex', 'username', 'password', 'confirm'),
        formError: null,
      }
    case 'setAccount':
      return { ...state, account: { ...state.account, [action.field]: action.value }, errors: without(state.errors, action.field) }
    case 'plexSignedIn': {
      const kept = state.plex.machineId !== null && action.servers.some((server) => server.machineId === state.plex.machineId)
      return {
        ...state,
        plex: {
          token: action.token,
          account: action.account,
          servers: action.servers,
          machineId: kept ? state.plex.machineId : defaultServer(action.servers),
        },
        errors: without(state.errors, 'plex'),
        formError: null,
      }
    }
    case 'plexSignedOut':
      return { ...state, plex: EMPTY_PLEX }
    case 'pickServer':
      return { ...state, plex: { ...state.plex, machineId: action.machineId }, errors: without(state.errors, 'plex') }
    case 'claimed': {
      const next = FIRST_CLAIMED_STEP
      return {
        ...state,
        setupState: 'claimed',
        admin: action.admin,
        step: STEPS[next],
        reached: Math.max(state.reached, next),
        // The password has done its job; don't keep it about
        account: { ...state.account, password: '', confirm: '' },
        errors: {},
        formError: null,
        busy: null,
      }
    }
    case 'configLoaded':
      return {
        ...state,
        settings: {
          view: action.view,
          draft: state.settings?.draft ?? state.pendingDraft ?? startingDraft(action.view),
        },
        pendingDraft: null,
      }
    case 'setField': {
      if (!state.settings) return state
      const draft = setField(state.settings.draft, action.field, action.value)
      const cleared = action.field === 'plexAuthEnabled' ? without(state.errors, action.field, 'plexLink') : without(state.errors, action.field)
      return { ...state, settings: { ...state.settings, draft }, errors: cleared }
    }
    case 'setSource': {
      if (!state.settings) return state
      const draft = setSourceOn(state.settings.draft, action.kind, action.on)
      const fields: WizardErrorKey[] = action.kind === 'dispatcharr' ? ['dispatcharrUrl', 'dispatcharrApiKey'] : ['ersatztvBaseUrl']
      // A source switched on answers "turn on a source"; one switched off drops its own errors
      return {
        ...state,
        settings: { ...state.settings, draft },
        errors: without(state.errors, ...(action.on ? ['sources' as const] : fields)),
      }
    }
    case 'resetAdvanced':
      if (!state.settings) return state
      return {
        ...state,
        settings: { ...state.settings, draft: draftDefaults(state.settings, ADVANCED_PLAIN) },
        errors: without(state.errors, ...ADVANCED_PLAIN),
      }
    case 'failed':
      return { ...state, errors: action.errors ?? {}, formError: action.formError ?? null, busy: null }
    case 'busy':
      return { ...state, busy: action.busy, formError: action.busy ? null : state.formError }
    case 'saved': {
      if (!state.settings) return state
      const settings = afterSave(state.settings, action.patch, action.view)
      return { ...state, settings, tests: testsAfterSave(state.tests, state.settings, settings), busy: null }
    }
    case 'linked':
      if (!state.settings) return state
      // The Plex sign-in has done its job: the server keeps its own token now
      return {
        ...state,
        settings: { ...state.settings, view: action.view },
        plex: EMPTY_PLEX,
        busy: null,
        errors: without(state.errors, 'plexLink'),
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
    case 'completed':
      return { ...state, done: true, facts: action.facts, busy: null, reached: STEPS.length - 1, errors: {}, formError: null }
  }
}
