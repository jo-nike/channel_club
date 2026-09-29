import type { Draft, DraftValues } from '@/components/server-settings/model/configDraft'
import { isSecretField, type EditableField } from '@/components/server-settings/model/fields'
import { isStepId, STEPS, type StepId } from './steps'
import type { AccountMethod } from './wizardReducer'

/*
 * What survives a reload: where the admin had got to (localStorage, so another
 * tab resumes there too) and, across a Plex redirect, the step and the unsaved
 * draft (sessionStorage, this tab only). Passwords, keys and the Plex token are
 * never stored. Storage can be blocked, so every read and write may fail
 * quietly.
 */

const PROGRESS_KEY = 'channel-club:setup-progress'
const STASH_KEY = 'channel-club:setup-stash'

export interface Progress {
  step: StepId
  reached: number
}

/** The wizard as it was when the page left for Plex. */
export interface Stash extends Progress {
  account: { method: AccountMethod; username: string }
  /** Null before the claim: there are no settings to change yet */
  draft: Draft | null
}

function isProgress(value: unknown): value is Progress {
  if (value === null || typeof value !== 'object') return false
  const { step, reached } = value as Record<string, unknown>
  return isStepId(step) && typeof reached === 'number' && Number.isInteger(reached) && reached >= 0 && reached < STEPS.length
}

function read(storage: () => Storage, key: string): unknown {
  try {
    const text = storage().getItem(key)
    return text === null ? null : JSON.parse(text)
  } catch {
    return null
  }
}

function write(storage: () => Storage, key: string, value: unknown): void {
  try {
    storage().setItem(key, JSON.stringify(value))
  } catch {
    // Storage blocked or full: the wizard just won't resume there
  }
}

function remove(storage: () => Storage, key: string): void {
  try {
    storage().removeItem(key)
  } catch {
    // Storage blocked: nothing was stored
  }
}

const local = () => localStorage
const session = () => sessionStorage

export function loadProgress(): Progress | null {
  const value = read(local, PROGRESS_KEY)
  return isProgress(value) ? { step: value.step, reached: value.reached } : null
}

export function saveProgress(progress: Progress): void {
  write(local, PROGRESS_KEY, { step: progress.step, reached: progress.reached })
}

export function clearProgress(): void {
  remove(local, PROGRESS_KEY)
}

/** The draft without any secret: those are never stored. */
function withoutSecrets(draft: Draft): Draft {
  const values: DraftValues = {}
  for (const [field, value] of Object.entries(draft.values) as [EditableField, unknown][]) {
    if (!isSecretField(field)) (values as Record<string, unknown>)[field] = value
  }
  return { values, sources: { ...draft.sources } }
}

export function stashForRedirect(stash: Stash): void {
  write(session, STASH_KEY, {
    step: stash.step,
    reached: stash.reached,
    account: { method: stash.account.method, username: stash.account.username },
    draft: stash.draft && withoutSecrets(stash.draft),
  })
}

/** The stash left before a Plex redirect, or null. Reading leaves it; clearStash() removes it. */
export function loadStash(): Stash | null {
  const value = read(session, STASH_KEY)
  if (!isProgress(value)) return null
  const { account, draft } = value as unknown as Record<string, unknown>
  if (account === null || typeof account !== 'object' || typeof draft !== 'object') return null
  const { method, username } = account as Record<string, unknown>
  if ((method !== 'plex' && method !== 'password') || typeof username !== 'string') return null
  return { step: value.step, reached: value.reached, account: { method, username }, draft: draftFrom(draft) }
}

/** A stored draft, or null when there was none or it doesn't read as one. */
function draftFrom(draft: object | null): Draft | null {
  if (draft === null) return null
  const { values, sources } = draft as Record<string, unknown>
  if (values === null || typeof values !== 'object' || sources === null || typeof sources !== 'object') return null
  return withoutSecrets({ values: values as DraftValues, sources: sources as Draft['sources'] })
}

export function clearStash(): void {
  remove(session, STASH_KEY)
}
