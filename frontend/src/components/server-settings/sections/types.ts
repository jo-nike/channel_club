import type { TestKind } from '@/types/setup'
import type { DraftValueOf, SettingsState, SourceKind } from '../model/configDraft'
import type { EditableField } from '../model/fields'
import type { TestRecord } from '../model/testResults'
import type { ErrorKey, SectionErrors } from '../model/validation'

/** Every section reads the saved settings and the draft, and reports each change. */
export interface SectionProps {
  state: SettingsState
  errors: SectionErrors
  onField: <K extends EditableField>(field: K, value: DraftValueOf<K>) => void
  /** Prefixes every id, so a setting's control is `${idPrefix}-${field}` */
  idPrefix: string
}

/** The sections with connection tests take the tests run so far and start new ones. */
export interface TestProps {
  tests: Partial<Record<TestKind, TestRecord>>
  onTest: (kind: TestKind) => void
}

export type SourceChange = (kind: SourceKind, on: boolean) => void

/** The id of the control to focus for an error: the setting's own, or what fixes a section-wide one. */
export function errorTargetId(idPrefix: string, key: ErrorKey): string {
  if (key === 'sources') return `${idPrefix}-source-dispatcharr`
  if (key === 'plexLink') return `${idPrefix}-plex-link`
  return `${idPrefix}-${key}`
}
