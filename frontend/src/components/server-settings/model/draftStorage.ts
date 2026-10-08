import type { Draft, DraftValues } from './configDraft'
import { isSecretField, type EditableField } from './fields'

/*
 * A draft kept across a Plex redirect, which leaves the page. Passwords, keys
 * and tokens are never stored: a draft is written and read without them.
 */

/** The draft without any secret, as it may be stored. */
export function storableDraft(draft: Draft): Draft {
  const values: DraftValues = {}
  for (const [field, value] of Object.entries(draft.values) as [EditableField, unknown][]) {
    if (!isSecretField(field)) (values as Record<string, unknown>)[field] = value
  }
  return { values, sources: { ...draft.sources } }
}

/** A stored draft, or null when there was none or it doesn't read as one. */
export function draftFrom(draft: unknown): Draft | null {
  if (draft === null || typeof draft !== 'object') return null
  const { values, sources } = draft as Record<string, unknown>
  if (values === null || typeof values !== 'object' || sources === null || typeof sources !== 'object') return null
  return storableDraft({ values: values as DraftValues, sources: sources as Draft['sources'] })
}
