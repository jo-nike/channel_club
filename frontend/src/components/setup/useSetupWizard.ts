import { useEffect, useEffectEvent, useReducer, useState } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { decodeTokenPayload, getTokenSubject } from '@/lib/jwt'
import { scrollBehavior } from '@/lib/motion'
import { hasPendingPlexPin } from '@/services/plexAuth'
import { claimSetup, getAdminConfig, listPlexServers, SetupApiError } from '@/services/setupApi'
import { useAuthStore } from '@/stores/authStore'
import type { EnvLock, PlexServersResponse, SetupAccountRequest } from '@/types/setup'
import { newPasswordError, usernameError } from '@/components/server-settings/model/validation'
import { clearProgress, clearStash, loadProgress, loadStash, saveProgress, stashForRedirect } from './progressStorage'
import { stepIndex, STEPS, type StepId } from './steps'
import {
  initialWizardState,
  wizardReducer,
  type AccountDraft,
  type AccountField,
  type AccountMethod,
  type FormError,
  type WizardAdmin,
  type WizardErrorKey,
  type WizardState,
} from './wizardReducer'

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

/** The server words these codes for logs; the wizard says them its own way. */
const PLEX_CALL_COPY: Partial<Record<string, string>> = {
  plex_token: "Plex didn't accept that sign-in. Sign in with Plex again.",
  plex_unavailable: "Plex isn't responding. Try again in a moment.",
  busy: 'Setup is busy talking to Plex. Try again in a moment.',
}

/** Why listing the Plex servers failed, for the form. */
export function plexErrorMessage(err: unknown): string {
  if (err instanceof SetupApiError) return (err.code !== undefined ? PLEX_CALL_COPY[err.code] : undefined) ?? err.message
  return err instanceof Error ? err.message : "Couldn't list your Plex servers."
}

export interface Failure {
  errors?: Partial<Record<WizardErrorKey, string>>
  formError?: FormError
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
      return { formError: { message: "Sign-in is set in this server's environment, so there's nothing to set up.", signIn: true } }
    case 'plex_token':
      return { errors: { plex: plexErrorMessage(err) } }
    case 'plex_unavailable':
    case 'busy':
      return { formError: { message: plexErrorMessage(err) } }
    case 'not_owner':
      return { errors: { plex: "That Plex server isn't one of yours. Pick one you own." } }
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

/**
 * The setup wizard's state and what it does: moving between steps, claiming
 * the club, and loading the server's settings once it is claimed.
 */
export function useSetupWizard(props: WizardProps) {
  const [state, dispatch] = useReducer(wizardReducer, props, openingState)
  const [configError, setConfigError] = useState<string | null>(null)
  const [configAttempt, setConfigAttempt] = useState(0)
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

  /** Handle a 401 or 403 from an admin call: this session can't finish setup. */
  const sessionEnded = (err: unknown): boolean => {
    if (!(err instanceof SetupApiError) || (err.status !== 401 && err.status !== 403)) return false
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

  /**
   * Show what's wrong. Focus moves to `focusId` once its error shows, so the
   * error is read with it; a problem with the whole step is scrolled into view.
   */
  const fail = (failure: Failure, focusId?: string) => {
    flushSync(() => dispatch({ type: 'failed', ...failure }))
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

  /** Continue: each step checks and keeps what it needs before the next opens. */
  const submit = async () => {
    if (state.busy) return
    if (state.step === 'welcome' || (state.step === 'account' && state.setupState === 'claimed')) {
      dispatch({ type: 'advance' })
    } else if (state.step === 'account') {
      await claim()
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
