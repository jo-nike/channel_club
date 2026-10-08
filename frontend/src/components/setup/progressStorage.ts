import type { Draft } from '@/components/server-settings/model/configDraft'
import { draftFrom, storableDraft } from '@/components/server-settings/model/draftStorage'
import { readStored, removeStored, writeStored } from '@/lib/storage'
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

const local = () => localStorage
const session = () => sessionStorage

export function loadProgress(): Progress | null {
  const value = readStored(local, PROGRESS_KEY)
  return isProgress(value) ? { step: value.step, reached: value.reached } : null
}

export function saveProgress(progress: Progress): void {
  writeStored(local, PROGRESS_KEY, { step: progress.step, reached: progress.reached })
}

export function clearProgress(): void {
  removeStored(local, PROGRESS_KEY)
}

export function stashForRedirect(stash: Stash): void {
  writeStored(session, STASH_KEY, {
    step: stash.step,
    reached: stash.reached,
    account: { method: stash.account.method, username: stash.account.username },
    draft: stash.draft && storableDraft(stash.draft),
  })
}

/** The stash left before a Plex redirect, or null. Reading leaves it; clearStash() removes it. */
export function loadStash(): Stash | null {
  const value = readStored(session, STASH_KEY)
  if (!isProgress(value)) return null
  const { account, draft } = value as unknown as Record<string, unknown>
  if (account === null || typeof account !== 'object' || typeof draft !== 'object') return null
  const { method, username } = account as Record<string, unknown>
  if ((method !== 'plex' && method !== 'password') || typeof username !== 'string') return null
  return { step: value.step, reached: value.reached, account: { method, username }, draft: draftFrom(draft) }
}

export function clearStash(): void {
  removeStored(session, STASH_KEY)
}
