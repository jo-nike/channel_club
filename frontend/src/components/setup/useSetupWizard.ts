import { useEffect, useEffectEvent, useReducer, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { decodeTokenPayload, getTokenSubject } from '@/lib/jwt'
import { scrollBehavior } from '@/lib/motion'
import { hasPendingPlexPin } from '@/services/plexAuth'
import {
  claimSetup,
  completeSetup,
  getAdminConfig,
  getPlexMembers,
  linkPlexServer,
  listPlexServers,
  SetupApiError,
  testConnection,
  updateAdminConfig,
} from '@/services/setupApi'
import { useAuthStore } from '@/stores/authStore'
import type { ConfigView, ConfigWarning, EnvLock, PlexServersResponse, SetupAccountRequest, TestKind } from '@/types/setup'
import {
  fieldValue,
  sectionPatch,
  type DraftValueOf,
  type SettingsState,
  type SourceKind,
} from '@/components/server-settings/model/configDraft'
import type { EditableField, SectionId } from '@/components/server-settings/model/fields'
import {
  linkFailure,
  NOT_OWNER,
  plexErrorMessage,
  RETYPE_SECRET,
  saveFailure,
  secretToRetype,
  testErrorMessage,
  warningText,
  type FormError,
} from '@/components/server-settings/model/failures'
import { testFingerprint, testInputError, testValues } from '@/components/server-settings/model/testResults'
import { firstError, newPasswordError, usernameError, validateSection } from '@/components/server-settings/model/validation'
import { errorTargetId } from '@/components/server-settings/sections/types'
import { clearProgress, clearStash, loadProgress, loadStash, saveProgress, stashForRedirect } from './progressStorage'
import { stepIndex, STEPS, type StepId } from './steps'
import {
  initialWizardState,
  wizardReducer,
  type AccountDraft,
  type AccountField,
  type AccountMethod,
  type WizardAdmin,
  type WizardErrorKey,
  type WizardState,
} from './wizardReducer'

/** Every setting's control in the wizard is `setup-${field}`. */
export const ID_PREFIX = 'setup'

/** The claim form's controls that an error moves focus to. */
export const ACCOUNT_CONTROL = {
  username: 'setup-account-username',
  password: 'setup-account-password',
  confirm: 'setup-account-confirm',
  plexSignIn: 'setup-plex-signin',
  plexSwitch: 'setup-plex-signin-switch',
} as const

/** The callout for a problem with the step as a whole. */
export const FORM_ERROR_ID = 'setup-form-error'

const ENV_MANAGED = "Sign-in is set in this server's environment, so there's nothing to set up."

export interface Failure {
  errors?: Partial<Record<WizardErrorKey, string>>
  formError?: FormError
}

/** What a failed finish shows. */
export function completeFailure(err: unknown): Failure {
  if (err instanceof SetupApiError && err.code === 'env_managed') return { formError: { message: ENV_MANAGED, signIn: true } }
  return { formError: { message: err instanceof Error ? err.message : "Couldn't finish setting up." } }
}

/** What the password form would get wrong, in the order it shows the fields. */
export function accountErrors(account: AccountDraft): Partial<Record<AccountField, string>> {
  const errors: Partial<Record<AccountField, string>> = {}
  const name = usernameError(account.username)
  if (name) errors.username = name
  const password = newPasswordError(account.password, false)
  if (password) errors.password = password
  else if (account.confirm !== account.password) errors.confirm = "The passwords don't match."
  return errors
}

/** What the claim form shows when the claim fails, in the wizard's own words. */
export function claimFailure(err: unknown, account: AccountDraft): Failure {
  if (!(err instanceof SetupApiError)) {
    return { formError: { message: err instanceof Error ? err.message : "Couldn't create your account." } }
  }
  switch (err.code) {
    case 'already_claimed':
      return { formError: { message: 'Someone else set up this club first.', signIn: true } }
    case 'env_managed':
      return { formError: { message: ENV_MANAGED, signIn: true } }
    case 'plex_token':
      return { errors: { plex: plexErrorMessage(err) } }
    case 'plex_unavailable':
    case 'busy':
      return { formError: { message: plexErrorMessage(err) } }
    case 'not_owner':
      return { errors: { plex: NOT_OWNER } }
    case 'write_failed':
      return { formError: { message: "The server couldn't save your account. Check that its data folder can be written to, then try again." } }
  }
  const { username, password } = err.fieldErrors
  if (username !== undefined || password !== undefined) {
    const errors: Partial<Record<AccountField, string>> = {}
    if (username !== undefined) errors.username = usernameError(account.username) ?? username
    if (password !== undefined) errors.password = newPasswordError(account.password, false) ?? password
    return { errors }
  }
  return { formError: { message: err.message } }
}

export interface WizardProps {
  setupState: 'unclaimed' | 'claimed'
  /** What the environment sets, from the setup status (listed only while unclaimed) */
  envLocked: readonly EnvLock[]
  /** The admin signed in, once the club is claimed */
  admin: WizardAdmin | null
}

/**
 * Where the wizard opens: at the step the page left from for Plex's
 * redirect sign-in, else (once claimed) where the admin had got to.
 */
function openingState(props: WizardProps): WizardState {
  const stash = hasPendingPlexPin() ? loadStash() : null
  const resumed = stash ?? (props.setupState === 'claimed' ? loadProgress() : null)
  return initialWizardState({ ...props, ...resumed })
}

const SESSION_ENDED = 'Sign in again to finish setting up.'
const NOT_AN_ADMIN = 'Only an admin can set up Channel Club.'

/** What Open Channel Club saves, in order, with the step each is edited on. */
const SAVE_ORDER = [
  ['sources', 'sources'],
  ['access', 'access'],
  ['extras', 'extras'],
  ['advanced', 'review'],
] as const satisfies readonly (readonly [SectionId, StepId])[]

/** Whether Continue has a Plex server to link first: Plex members on, none linked, one picked. */
function linkPending(settings: SettingsState, plex: WizardState['plex']): boolean {
  return fieldValue(settings, 'plexAuthEnabled') && !settings.view.values.plexServerMachineId && plex.token !== null && plex.machineId !== null
}

/**
 * The setup wizard's state and what it does: moving between steps, claiming
 * the club, loading the server's settings once it is claimed, testing
 * connections and saving each step.
 */
export function useSetupWizard(props: WizardProps) {
  const [state, dispatch] = useReducer(wizardReducer, props, openingState)
  const [configError, setConfigError] = useState<string | null>(null)
  const [configAttempt, setConfigAttempt] = useState(0)
  // The test running for each kind; a new one of a kind stops the last
  const testsRunning = useRef<Partial<Record<TestKind, AbortController>>>({})
  const setAuth = useAuthStore((s) => s.setAuth)
  const navigate = useNavigate()

  // The stash has been read; a later reload shouldn't bring it back
  useEffect(() => clearStash(), [])

  useEffect(() => {
    if (state.done) clearProgress()
    else if (state.setupState === 'claimed') saveProgress({ step: state.step, reached: state.reached })
  }, [state.setupState, state.step, state.reached, state.done])

  /** Leave for the app with a message. Its toaster starts listening as it mounts, so the page changes first. */
  const leave = async (message: string) => {
    await navigate('/', { replace: true, flushSync: true })
    toast.error(message)
  }

  /**
   * Handle a 401, or a 403 refusing the admin, from an admin call: this
   * session can't finish setup. A 403 with a code refuses what was asked
   * (a Plex server that isn't yours), not who asked.
   */
  const sessionEnded = (err: unknown): boolean => {
    if (!(err instanceof SetupApiError)) return false
    if (err.status !== 401 && (err.status !== 403 || err.code !== undefined)) return false
    void leave(err.status === 401 ? SESSION_ENDED : NOT_AN_ADMIN)
    return true
  }

  const onConfigFailed = useEffectEvent((err: unknown) => {
    if (!sessionEnded(err)) setConfigError(err instanceof Error ? err.message : "Couldn't load the server settings")
  })

  const needsConfig = state.setupState === 'claimed' && state.settings === null
  useEffect(() => {
    if (!needsConfig) return
    const controller = new AbortController()
    getAdminConfig(controller.signal)
      .then((view) => dispatch({ type: 'configLoaded', view }))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) onConfigFailed(err)
      })
    return () => controller.abort()
  }, [needsConfig, configAttempt])

  const onMembersFailed = useEffectEvent((err: unknown) => {
    if (!sessionEnded(err)) dispatch({ type: 'members', members: 'failed' })
  })

  // The linked server's members, to tick admins among
  const linkedServer = state.settings?.view.values.plexServerMachineId ?? null
  useEffect(() => {
    if (!linkedServer) return
    const controller = new AbortController()
    getPlexMembers(controller.signal)
      .then((members) => dispatch({ type: 'members', members }))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) onMembersFailed(err)
      })
    return () => controller.abort()
  }, [linkedServer])

  // Tests still running when the wizard closes have nobody to tell
  useEffect(() => {
    const running = testsRunning.current
    return () => {
      for (const controller of Object.values(running)) controller.abort()
    }
  }, [])

  /**
   * Show what's wrong, on `step` when that isn't the one open (Review sends
   * a problem to where it's fixed). Focus moves to `focusId` once its error
   * shows, so the error is read with it; a problem with the whole step is
   * scrolled into view.
   */
  const fail = (failure: Failure, focusId?: string, step?: StepId) => {
    flushSync(() => {
      if (step && step !== state.step) dispatch({ type: 'goTo', step })
      dispatch({ type: 'failed', ...failure })
    })
    if (focusId) document.getElementById(focusId)?.focus()
    else if (failure.formError) {
      document.getElementById(FORM_ERROR_ID)?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
    }
  }

  const claim = async () => {
    const { account, plex } = state
    let request: SetupAccountRequest
    if (account.method === 'password') {
      const errors = accountErrors(account)
      const first = (['username', 'password', 'confirm'] as const).find((field) => errors[field] !== undefined)
      if (first) return fail({ errors }, ACCOUNT_CONTROL[first])
      request = { method: 'password', username: account.username, password: account.password }
    } else {
      if (!plex.token) return fail({ errors: { plex: 'Sign in with Plex to continue.' } }, ACCOUNT_CONTROL.plexSignIn)
      // A server is picked whenever the account owns one
      if (!plex.machineId) {
        return fail({ errors: { plex: 'Sign in with a Plex account that owns a server to continue.' } }, ACCOUNT_CONTROL.plexSwitch)
      }
      request = { method: 'plex', authToken: plex.token, machineId: plex.machineId }
    }

    dispatch({ type: 'busy', busy: 'claim' })
    try {
      const session = await claimSetup(request)
      const plexId = decodeTokenPayload(session.accessToken)?.plex_id
      let admin: WizardAdmin
      if (request.method === 'password') {
        setAuth(session.accessToken, session.role, request.username)
        admin = { signIn: 'password', username: request.username, plexId: null }
      } else {
        // As at sign-in, a Plex session's name comes from its token
        setAuth(session.accessToken, session.role)
        admin = {
          signIn: 'plex',
          username: getTokenSubject(session.accessToken) ?? plex.account?.username ?? '',
          plexId: typeof plexId === 'string' ? plexId : null,
        }
      }
      dispatch({ type: 'claimed', admin })
    } catch (err) {
      const failure = claimFailure(err, account)
      if (err instanceof SetupApiError && err.code === 'plex_token') dispatch({ type: 'plexSignedOut' })
      const field = (['username', 'password'] as const).find((key) => failure.errors?.[key] !== undefined)
      fail(failure, field && ACCOUNT_CONTROL[field])
    }
  }

  const showWarnings = (warnings: readonly ConfigWarning[]) => {
    for (const warning of warnings) toast.warning(warningText(warning))
  }

  /**
   * Check a section, then save what changed; true once saved, or with
   * nothing to save. A failure shows on `step`, where the section is edited.
   */
  const saveSection = async (settings: SettingsState, section: SectionId, step: StepId): Promise<boolean> => {
    const errors = validateSection(settings, section)
    const first = firstError(section, errors)
    if (first) {
      fail({ errors }, errorTargetId(ID_PREFIX, first), step)
      return false
    }
    const patch = sectionPatch(settings, section)
    if (!patch) return true
    dispatch({ type: 'busy', busy: 'save' })
    try {
      const update = await updateAdminConfig(patch)
      dispatch({ type: 'saved', patch, view: update.config })
      showWarnings(update.warnings)
      return true
    } catch (err) {
      if (!sessionEnded(err)) {
        const failure = saveFailure(err, section)
        const field = failure.errors ? firstError(section, failure.errors) : null
        fail(failure, field ? errorTargetId(ID_PREFIX, field) : undefined, step)
      }
      return false
    }
  }

  /** Link the Plex server picked; the settings with it linked, or null when that failed. */
  const linkServer = async (): Promise<ConfigView | null> => {
    const { token, machineId } = state.plex
    if (!token || !machineId) return null
    dispatch({ type: 'busy', busy: 'link' })
    try {
      const update = await linkPlexServer({ authToken: token, machineId })
      dispatch({ type: 'linked', view: update.config })
      showWarnings(update.warnings)
      return update.config
    } catch (err) {
      if (!sessionEnded(err)) {
        if (err instanceof SetupApiError && err.code === 'plex_token') dispatch({ type: 'plexSignedOut' })
        fail(linkFailure(err), errorTargetId(ID_PREFIX, 'plexLink'), 'access')
      }
      return null
    }
  }

  /** Save a section, linking a Plex server picked on Who can join first. */
  const saveSettings = async (settings: SettingsState, section: SectionId, step: StepId): Promise<boolean> => {
    if (section === 'access' && linkPending(settings, state.plex)) {
      const view = await linkServer()
      if (!view) return false
      settings = { ...settings, view }
    }
    return saveSection(settings, section, step)
  }

  /**
   * Open Channel Club: save what's still unsaved, in step order, then
   * finish setup. No section's checks read another's settings, so each
   * checks the settings as Review had them.
   */
  const openClub = async () => {
    const settings = state.settings
    if (!settings) return
    for (const [section, step] of SAVE_ORDER) {
      if (!(await saveSettings(settings, section, step))) return
    }
    dispatch({ type: 'busy', busy: 'complete' })
    try {
      const facts = await completeSetup()
      dispatch({ type: 'completed', facts })
    } catch (err) {
      if (!sessionEnded(err)) fail(completeFailure(err))
    }
  }

  /** Continue: each step checks and keeps what it needs before the next opens. */
  const submit = async () => {
    if (state.busy) return
    const { step } = state
    if (step === 'welcome' || (step === 'account' && state.setupState === 'claimed')) {
      dispatch({ type: 'advance' })
    } else if (step === 'account') {
      await claim()
    } else if (step === 'review') {
      await openClub()
    } else if (state.settings && (await saveSettings(state.settings, step, step))) {
      dispatch({ type: 'advance' })
    }
  }

  /** Test a connection with the values shown: first the inputs it needs, then the server's verdict. */
  const runTest = async (kind: TestKind) => {
    const settings = state.settings
    if (!settings) return
    const missing = testInputError(settings, kind)
    if (missing) return fail({ errors: { [missing.field]: missing.message } }, errorTargetId(ID_PREFIX, missing.field))

    const fingerprint = testFingerprint(settings, kind)
    testsRunning.current[kind]?.abort()
    const controller = new AbortController()
    testsRunning.current[kind] = controller
    dispatch({ type: 'testStarted', kind, fingerprint })
    try {
      const result = await testConnection(kind, testValues(settings, kind), controller.signal)
      dispatch({ type: 'testFinished', kind, fingerprint, result })
    } catch (err) {
      // A test stopped for a newer one reports for inputs no longer shown, which the reducer drops
      if (sessionEnded(err)) return
      // A saved secret isn't sent to a new address: it goes on its field
      const secret = secretToRetype(err)
      if (secret) {
        dispatch({ type: 'testFinished', kind, fingerprint })
        return fail({ errors: { [secret]: RETYPE_SECRET } }, errorTargetId(ID_PREFIX, secret))
      }
      dispatch({ type: 'testFinished', kind, fingerprint, error: testErrorMessage(err) })
    }
  }

  /** Take a Plex sign-in: list the servers the account owns. Throws an Error worded for the form. */
  const plexSignIn = async (token: string, signal?: AbortSignal) => {
    let found: PlexServersResponse
    try {
      found = await listPlexServers(token, signal)
    } catch (err) {
      throw signal?.aborted ? err : new Error(plexErrorMessage(err))
    }
    if (!signal?.aborted) dispatch({ type: 'plexSignedIn', token, account: found.account, servers: found.servers })
  }

  /** List the servers again, say after adding one on plex.tv. */
  const refreshServers = async () => {
    const token = state.plex.token
    if (!token) return
    try {
      const found = await listPlexServers(token)
      dispatch({ type: 'plexSignedIn', token, account: found.account, servers: found.servers })
    } catch (err) {
      if (err instanceof SetupApiError && err.code === 'plex_token') dispatch({ type: 'plexSignedOut' })
      dispatch({ type: 'failed', errors: { plex: plexErrorMessage(err) } })
    }
  }

  return {
    state,
    /** Why the server's settings didn't load; retryConfig tries again */
    configError,
    retryConfig: () => {
      setConfigError(null)
      setConfigAttempt((attempt) => attempt + 1)
    },
    submit,
    goTo: (step: StepId) => dispatch({ type: 'goTo', step }),
    back: () => {
      const index = stepIndex(state.step)
      if (index > 0) dispatch({ type: 'goTo', step: STEPS[index - 1] })
    },
    setMethod: (method: AccountMethod) => dispatch({ type: 'setMethod', method }),
    setAccount: (field: AccountField, value: string) => dispatch({ type: 'setAccount', field, value }),
    setField: <K extends EditableField>(field: K, value: DraftValueOf<K>) =>
      dispatch({ type: 'setField', field, value: value as DraftValueOf<EditableField> }),
    setSource: (kind: SourceKind, on: boolean) => dispatch({ type: 'setSource', kind, on }),
    resetAdvanced: () => dispatch({ type: 'resetAdvanced' }),
    runTest,
    plexSignIn,
    plexSignedOut: () => dispatch({ type: 'plexSignedOut' }),
    pickServer: (machineId: string) => dispatch({ type: 'pickServer', machineId }),
    refreshServers,
    /** Keep the step and the unsaved draft (never a secret) while the page is away at Plex. */
    stashForRedirect: () =>
      stashForRedirect({
        step: state.step,
        reached: state.reached,
        account: { method: state.account.method, username: state.account.username },
        draft: state.settings?.draft ?? state.pendingDraft,
      }),
  }
}

export type SetupWizardApi = ReturnType<typeof useSetupWizard>
