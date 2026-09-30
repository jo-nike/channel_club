import { useEffect, useEffectEvent, useReducer, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { toast } from 'sonner'
import {
  getAdminConfig,
  getPlexMembers,
  linkPlexServer,
  listPlexServers,
  SetupApiError,
  testConnection,
  updateAdminConfig,
} from '@/services/setupApi'
import type { ConfigView, ConfigWarning, PlexServersResponse, TestKind } from '@/types/setup'
import {
  EMPTY_DRAFT,
  fieldValue,
  sectionPatch,
  type DraftValueOf,
  type SettingsState,
  type SourceKind,
} from '@/components/server-settings/model/configDraft'
import {
  linkFailure,
  plexErrorMessage,
  RETYPE_SECRET,
  saveFailure,
  secretToRetype,
  testErrorMessage,
  warningText,
  type SettingsFailure,
} from '@/components/server-settings/model/failures'
import type { EditableField, SectionId } from '@/components/server-settings/model/fields'
import type { PlexSignIn } from '@/components/server-settings/model/plexSignIn'
import { testFingerprint, testInputError, testValues } from '@/components/server-settings/model/testResults'
import { firstError, validateSection } from '@/components/server-settings/model/validation'
import { errorTargetId } from '@/components/server-settings/sections/types'
import { initialServerState, SECTION_OF, serverReducer } from './serverReducer'
import { clearServerTabStash, serverTabReturn, stashServerTab } from './serverStash'

/** Every setting's control in the Server tab is `server-${field}`. */
export const SERVER_ID_PREFIX = 'server'

/** Re-link Plex's button, where focus goes once the server is linked again. */
export const RELINK_BUTTON_ID = 'server-plex-relink'

const NOT_AN_ADMIN = "Only an admin can change the server's settings."

/** A 401: the app is signing this browser out, and the panel goes with it. */
function signedOut(err: unknown): boolean {
  return err instanceof SetupApiError && err.status === 401
}

/** A 403 refusing who asked, not what they asked. */
function adminRefusal(err: unknown): SettingsFailure | null {
  return err instanceof SetupApiError && err.status === 403 && err.code === undefined
    ? { formError: { message: NOT_AN_ADMIN } }
    : null
}

/** Whether saving Who can join links a Plex server first: Plex members on, none linked, one picked. */
function linkPending(settings: SettingsState, plex: PlexSignIn): boolean {
  return fieldValue(settings, 'plexAuthEnabled') && !settings.view.values.plexServerMachineId && plex.token !== null && plex.machineId !== null
}

/**
 * The Admin panel's Server tab: the server's settings, each section's own
 * save, connection tests, and linking a Plex server again. Unsaved changes
 * live here as long as the tab is mounted.
 */
export function useServerSettings() {
  // Back from a Plex redirect sign-in: the draft and Re-link as they were
  const [state, dispatch] = useReducer(serverReducer, null, () => initialServerState(serverTabReturn()))
  const [configError, setConfigError] = useState<string | null>(null)
  const [configAttempt, setConfigAttempt] = useState(0)
  // The test running for each kind; a new one of a kind stops the last
  const testsRunning = useRef<Partial<Record<TestKind, AbortController>>>({})

  // The stash has been read; a later reload shouldn't bring it back
  useEffect(() => clearServerTabStash(), [])

  const onConfigFailed = useEffectEvent((err: unknown) => {
    if (!signedOut(err)) setConfigError(adminRefusal(err)?.formError?.message ?? (err instanceof Error ? err.message : "Couldn't load the server settings"))
  })

  const needsConfig = state.settings === null
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

  // The linked server's members, to tick admins among
  const linkedServer = state.settings?.view.values.plexServerMachineId ?? null
  useEffect(() => {
    if (!linkedServer) return
    const controller = new AbortController()
    getPlexMembers(controller.signal)
      .then((members) => dispatch({ type: 'members', members }))
      .catch(() => {
        if (!controller.signal.aborted) dispatch({ type: 'members', members: 'failed' })
      })
    return () => controller.abort()
  }, [linkedServer])

  // Tests still running when the tab goes have nobody to tell
  useEffect(() => {
    const running = testsRunning.current
    return () => {
      for (const controller of Object.values(running)) controller.abort()
    }
  }, [])

  /** Show what's wrong with a section; focus moves to `focusId` once its error shows. */
  const fail = (section: SectionId, failure: SettingsFailure, focusId?: string) => {
    flushSync(() => dispatch({ type: 'failed', section, ...failure }))
    if (focusId) document.getElementById(focusId)?.focus()
  }

  const showWarnings = (warnings: readonly ConfigWarning[]) => {
    for (const warning of warnings) toast.warning(warningText(warning))
  }

  /** Check a section, then save what changed; true once saved, or with nothing to save. */
  const saveSection = async (settings: SettingsState, section: SectionId): Promise<boolean> => {
    const errors = validateSection(settings, section)
    const first = firstError(section, errors)
    if (first) {
      fail(section, { errors }, errorTargetId(SERVER_ID_PREFIX, first))
      return false
    }
    const patch = sectionPatch(settings, section)
    if (!patch) return true
    dispatch({ type: 'busy', section })
    try {
      const update = await updateAdminConfig(patch)
      dispatch({ type: 'saved', section, patch, view: update.config })
      showWarnings(update.warnings)
      return true
    } catch (err) {
      if (!signedOut(err)) {
        const failure = adminRefusal(err) ?? saveFailure(err, section)
        const field = failure.errors ? firstError(section, failure.errors) : null
        fail(section, failure, field ? errorTargetId(SERVER_ID_PREFIX, field) : undefined)
      }
      return false
    }
  }

  /** Link the Plex server picked; the settings with it linked, or null when that failed. */
  const linkServer = async (): Promise<ConfigView | null> => {
    const { token, machineId } = state.plex
    if (!token || !machineId) return null
    dispatch({ type: 'linking' })
    try {
      const update = await linkPlexServer({ authToken: token, machineId })
      // Rendered at once, so focus can move to what replaces the sign-in
      flushSync(() => dispatch({ type: 'linked', view: update.config }))
      showWarnings(update.warnings)
      return update.config
    } catch (err) {
      if (!signedOut(err)) {
        if (err instanceof SetupApiError && err.code === 'plex_token') dispatch({ type: 'plexSignedOut' })
        fail('access', adminRefusal(err) ?? linkFailure(err), errorTargetId(SERVER_ID_PREFIX, 'plexLink'))
      }
      return null
    }
  }

  /** Save a section, linking a Plex server picked on Who can join first. */
  const save = async (section: SectionId) => {
    const { settings } = state
    if (!settings || state.sections[section].busy || state.linking) return
    let current = settings
    if (section === 'access' && linkPending(settings, state.plex)) {
      const view = await linkServer()
      if (!view) return
      current = { ...settings, view }
    }
    await saveSection(current, section)
  }

  /** Re-link Plex: link the server picked with the new sign-in. */
  const relink = async () => {
    if (state.linking) return
    const view = await linkServer()
    if (!view) return
    toast.success(`Linked to ${view.plexServerName ?? 'the Plex server'}`)
    document.getElementById(RELINK_BUTTON_ID)?.focus()
  }

  /** Test a connection with the values shown: first the inputs it needs, then the server's verdict. */
  const runTest = async (kind: TestKind) => {
    const settings = state.settings
    if (!settings) return
    const missing = testInputError(settings, kind)
    if (missing) {
      return fail(SECTION_OF[missing.field], { errors: { [missing.field]: missing.message } }, errorTargetId(SERVER_ID_PREFIX, missing.field))
    }

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
      if (signedOut(err)) return
      // A saved secret isn't sent to a new address: it goes on its field
      const secret = secretToRetype(err)
      if (secret) {
        dispatch({ type: 'testFinished', kind, fingerprint })
        return fail(SECTION_OF[secret], { errors: { [secret]: RETYPE_SECRET } }, errorTargetId(SERVER_ID_PREFIX, secret))
      }
      dispatch({ type: 'testFinished', kind, fingerprint, error: adminRefusal(err)?.formError?.message ?? testErrorMessage(err) })
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
      dispatch({ type: 'failed', section: 'access', errors: { plex: plexErrorMessage(err) } })
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
    save,
    setField: <K extends EditableField>(field: K, value: DraftValueOf<K>) =>
      dispatch({ type: 'setField', field, value: value as DraftValueOf<EditableField> }),
    setSource: (kind: SourceKind, on: boolean) => dispatch({ type: 'setSource', kind, on }),
    resetAdvanced: () => dispatch({ type: 'resetAdvanced' }),
    runTest,
    plexSignIn,
    plexSignedOut: () => dispatch({ type: 'plexSignedOut' }),
    pickServer: (machineId: string) => dispatch({ type: 'pickServer', machineId }),
    refreshServers,
    openRelink: () => dispatch({ type: 'relink', open: true }),
    closeRelink: () => dispatch({ type: 'relink', open: false }),
    relink,
    /** Keep the unsaved draft (never a secret) and Re-link while the page is away at Plex. */
    stashForRedirect: () =>
      stashServerTab({ draft: state.settings?.draft ?? state.pendingDraft ?? EMPTY_DRAFT, relinking: state.relinking }),
  }
}

export type ServerSettingsApi = ReturnType<typeof useServerSettings>
