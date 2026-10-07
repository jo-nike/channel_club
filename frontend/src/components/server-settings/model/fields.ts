import type { ConfigField, ConfigValues, LogLevel, SecretField } from '@/types/setup'

/*
 * The settings the server lets the app change, grouped the way the setup
 * wizard and the Admin panel's Server tab show them. Each section saves with
 * its own PUT /api/admin/config.
 */

/** Compiles only when T is never: every member of a union is listed. */
type Exhaustive<T extends never> = T

export type SectionId = 'sources' | 'access' | 'extras' | 'advanced'

/** Set by linking a Plex server (POST /api/admin/plex/server); no section edits them. */
export type LinkedField = 'plexServerToken' | 'plexServerMachineId'

/** The settings a section edits. */
export type EditableField = Exclude<ConfigField, LinkedField>

/** Every setting in GET /api/admin/config's values, in the order the sections show them. */
export const CONFIG_FIELDS = [
  'dispatcharrUrl',
  'dispatcharrApiKey',
  'ersatztvBaseUrl',
  'plexAuthEnabled',
  'plexServerToken',
  'plexServerMachineId',
  'plexDefaultRole',
  'plexAdminIds',
  'localAuthEnabled',
  'adminUsername',
  'adminPassword',
  'viewerUsername',
  'viewerPassword',
  'userChannelSelection',
  'presenceVisible',
  'chatEnabled',
  'giphyApiKey',
  'highlightEnabled',
  'ziplineEnabled',
  'ziplineUrl',
  'ziplineToken',
  'ntfyEnabled',
  'ntfyUrl',
  'ntfyTopic',
  'ntfyToken',
  'mediaProcessLimit',
  'mediaProcessPerUser',
  'castHlsSegmentTime',
  'castHlsListSize',
  'castSessionTimeout',
  'highlightBufferSeconds',
  'highlightSegmentSeconds',
  'mediaRecorderLimit',
  'mediaExportMaxBytes',
  'mediaExportLimit',
  'mediaExportPerUser',
  'mediaUploadLimit',
  'mediaUploadPerUser',
  'feedbackCooldownSeconds',
  'feedbackHourlyLimit',
  'requestBodyMaxBytes',
  'logLevel',
  'ersatztvLogoOrigins',
] as const satisfies readonly ConfigField[]

export type AllConfigFieldsListed = Exhaustive<Exclude<ConfigField, (typeof CONFIG_FIELDS)[number]>>

/** The settings shown only as set or not. A form sends a string to replace one, null to remove it. */
export const SECRET_FIELDS = [
  'dispatcharrApiKey',
  'plexServerToken',
  'adminPassword',
  'viewerPassword',
  'giphyApiKey',
  'ziplineToken',
  'ntfyToken',
] as const satisfies readonly SecretField[]

export type AllSecretsListed = Exhaustive<Exclude<SecretField, (typeof SECRET_FIELDS)[number]>>

/** The secrets a section edits. */
export type EditableSecret = Exclude<SecretField, LinkedField>

/** Passwords are sent as typed; keys and tokens lose the spaces a paste brings. */
export const PASSWORD_FIELDS = ['adminPassword', 'viewerPassword'] as const satisfies readonly EditableSecret[]

const SECRETS: ReadonlySet<string> = new Set(SECRET_FIELDS)

export function isSecretField(field: ConfigField): field is SecretField {
  return SECRETS.has(field)
}

/** The whole numbers in Advanced; byte sizes are shown in MB or KB. */
export type NumberField = {
  [K in ConfigField]: ConfigValues[K] extends number ? K : never
}[ConfigField]

export interface NumberSpec {
  label: string
  unit?: 's' | 'MB' | 'KB'
  /** The server's range, in the unit shown */
  min: number
  max: number
}

/** Bytes in one shown unit (the server's sizes are powers of 1024). */
export const UNIT_BYTES = { MB: 1024 * 1024, KB: 1024 } as const

export const NUMBER_SPECS: Record<NumberField, NumberSpec> = {
  mediaProcessLimit: { label: 'Casts at once', min: 1, max: 64 },
  mediaProcessPerUser: { label: 'Casts per person', min: 1, max: 64 },
  castHlsSegmentTime: { label: 'Segment length', unit: 's', min: 1, max: 30 },
  castHlsListSize: { label: 'Segments in the playlist', min: 2, max: 30 },
  castSessionTimeout: { label: 'End an idle cast after', unit: 's', min: 30, max: 86400 },
  highlightBufferSeconds: { label: 'Seconds kept for clipping', unit: 's', min: 10, max: 600 },
  highlightSegmentSeconds: { label: 'Recording segment length', unit: 's', min: 1, max: 60 },
  mediaRecorderLimit: { label: 'Channels recording at once', min: 1, max: 32 },
  mediaExportMaxBytes: { label: 'Largest export', unit: 'MB', min: 1, max: 2048 },
  mediaExportLimit: { label: 'Exports at once', min: 1, max: 16 },
  mediaExportPerUser: { label: 'Exports per person', min: 1, max: 16 },
  mediaUploadLimit: { label: 'Uploads at once', min: 1, max: 16 },
  mediaUploadPerUser: { label: 'Uploads per person', min: 1, max: 16 },
  feedbackCooldownSeconds: { label: 'Wait between reports', unit: 's', min: 0, max: 3600 },
  feedbackHourlyLimit: { label: 'Reports per person per hour', min: 1, max: 1000 },
  requestBodyMaxBytes: { label: 'Largest request', unit: 'KB', min: 32, max: 16384 },
}

export const LOG_LEVELS = [
  'TRACE',
  'DEBUG',
  'INFO',
  'SUCCESS',
  'WARNING',
  'ERROR',
  'CRITICAL',
] as const satisfies readonly LogLevel[]

export type AllLogLevelsListed = Exhaustive<Exclude<LogLevel, (typeof LOG_LEVELS)[number]>>

/** The server keeps at most this many extra logo sources. */
export const MAX_LOGO_ORIGINS = 20

/** Advanced settings in the groups Review shows them in. */
export const ADVANCED_GROUPS = [
  {
    title: 'Chromecast',
    fields: ['mediaProcessLimit', 'mediaProcessPerUser', 'castHlsSegmentTime', 'castHlsListSize', 'castSessionTimeout'],
  },
  {
    title: 'Clips',
    fields: [
      'highlightBufferSeconds',
      'highlightSegmentSeconds',
      'mediaRecorderLimit',
      'mediaExportMaxBytes',
      'mediaExportLimit',
      'mediaExportPerUser',
      'mediaUploadLimit',
      'mediaUploadPerUser',
    ],
  },
  { title: 'Feedback', fields: ['feedbackCooldownSeconds', 'feedbackHourlyLimit'] },
  { title: 'Server', fields: ['requestBodyMaxBytes', 'logLevel', 'ersatztvLogoOrigins'] },
] as const satisfies readonly { title: string; fields: readonly EditableField[] }[]

export type AdvancedField = (typeof ADVANCED_GROUPS)[number]['fields'][number]

/** The settings each section edits, in the order it shows them. */
export const SECTION_FIELDS = {
  sources: ['dispatcharrUrl', 'dispatcharrApiKey', 'ersatztvBaseUrl'],
  access: [
    'plexAuthEnabled',
    'plexDefaultRole',
    'plexAdminIds',
    'localAuthEnabled',
    'adminUsername',
    'adminPassword',
    'viewerUsername',
    'viewerPassword',
    'userChannelSelection',
    'presenceVisible',
  ],
  extras: [
    'chatEnabled',
    'giphyApiKey',
    'highlightEnabled',
    'ziplineEnabled',
    'ziplineUrl',
    'ziplineToken',
    'ntfyEnabled',
    'ntfyUrl',
    'ntfyTopic',
    'ntfyToken',
  ],
  advanced: ADVANCED_GROUPS.flatMap((group): readonly AdvancedField[] => group.fields),
} as const satisfies Record<SectionId, readonly EditableField[]>

type SectionField = (typeof SECTION_FIELDS)[SectionId][number]

export type AllEditableFieldsInASection = Exhaustive<Exclude<EditableField, SectionField>>
export type AllNumbersInAdvanced = Exhaustive<Exclude<NumberField, AdvancedField>>
