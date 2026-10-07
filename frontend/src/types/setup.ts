/**
 * First-run setup (/api/setup/*) and the server settings the app can change
 * (/api/admin/config, /api/admin/plex/*).
 *
 * Written by hand to mirror the server's models (backend/app/models/setup.py
 * and backend/app/models/admin_config.py); the committed OpenAPI snapshot
 * backend/tests/snapshots/openapi.json changes with them. Where a name here
 * differs from the server's, the server's model is named in the comment.
 */

/**
 * unclaimed: nobody has set up the club, and the first visitor to /setup
 * becomes its admin. claimed: the admin exists and is still in the wizard.
 * complete: setup is done, or sign-in comes from the server's environment.
 */
export type SetupState = 'unclaimed' | 'claimed' | 'complete'

/** A variable the server's environment sets. */
export interface EnvLock {
  env: string
  /** The setting it locks in the app (camelCase), or null when only the environment sets it */
  field: string | null
}

/** GET /api/setup/status (server: SetupStatusResponse). Public, so names only. */
export interface SetupStatus {
  setupState: SetupState
  /** Filled only while setup is unclaimed; afterwards the admin reads GET /api/admin/config */
  envLocked: EnvLock[]
}

/** The plex.tv account a token belongs to. */
export interface PlexAccount {
  username: string
}

/** A Plex Media Server the signed-in account owns, for the server picker. */
export interface PlexServer {
  machineId: string
  name: string
  online: boolean
  lastSeenAt?: string | null
  /** People the server is shared with; null when plex.tv's user list couldn't be read */
  memberCount?: number | null
}

/** POST /api/setup/plex/servers */
export interface PlexServersResponse {
  account: PlexAccount
  servers: PlexServer[]
}

/** Claim the club with a local admin account. */
export interface PasswordClaim {
  method: 'password'
  username: string
  password: string
}

/** Claim the club with a Plex account and one of its own servers. */
export interface PlexClaim {
  method: 'plex'
  authToken: string
  machineId: string
}

/** Body of POST /api/setup/account */
export type SetupAccountRequest = PasswordClaim | PlexClaim

/** Which extras are on when setup finishes. */
export interface SetupFeatures {
  chat: boolean
  gifs: boolean
  clips: boolean
  nhl: boolean
  feedback: boolean
}

/** POST /api/setup/complete (server: SetupCompleteResponse): facts for the On air screen. */
export interface SetupFacts {
  /** null when the source isn't set up or didn't answer in time */
  dispatcharrChannels: number | null
  ersatztvChannels: number | null
  /** The Plex server whose members can join, when Plex sign-in is on */
  plexServerName: string | null
  features: SetupFeatures
}

/** A secret as the server shows it: whether it is set, never its value. */
export interface SecretState {
  set: boolean
}

export type PlexRole = 'viewer' | 'admin'

export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'CRITICAL'

/** Every setting the app can change, as the server runs with it now. Byte sizes are in bytes. */
export interface ConfigValues {
  // Sources
  dispatcharrUrl: string
  dispatcharrApiKey: SecretState
  ersatztvBaseUrl: string
  // Who can join
  localAuthEnabled: boolean
  adminUsername: string
  adminPassword: SecretState
  viewerUsername: string
  viewerPassword: SecretState
  plexAuthEnabled: boolean
  plexServerToken: SecretState
  plexServerMachineId: string | null
  /** 'viewer' or 'admin', unless the environment set something else */
  plexDefaultRole: string
  plexAdminIds: string[]
  userChannelSelection: boolean
  presenceVisible: boolean
  // Extras
  chatEnabled: boolean
  giphyApiKey: SecretState
  highlightEnabled: boolean
  ziplineEnabled: boolean
  ziplineUrl: string
  ziplineToken: SecretState
  nhlEnabled: boolean
  ntfyEnabled: boolean
  ntfyUrl: string
  ntfyTopic: string
  ntfyToken: SecretState
  // Advanced
  mediaProcessLimit: number
  mediaProcessPerUser: number
  castHlsSegmentTime: number
  castHlsListSize: number
  castSessionTimeout: number
  highlightBufferSeconds: number
  highlightSegmentSeconds: number
  mediaRecorderLimit: number
  mediaExportMaxBytes: number
  mediaExportLimit: number
  mediaExportPerUser: number
  mediaUploadLimit: number
  mediaUploadPerUser: number
  feedbackCooldownSeconds: number
  feedbackHourlyLimit: number
  requestBodyMaxBytes: number
  logLevel: LogLevel
  ersatztvLogoOrigins: string[]
}

export type ConfigField = keyof ConfigValues

/** The settings that are secrets: shown only as {set}, sent as a string to set or null to remove. */
export type SecretField = {
  [K in ConfigField]: ConfigValues[K] extends SecretState ? K : never
}[ConfigField]

/** A variable the server's environment sets, for the Admin panel's list. */
export interface EnvVariable {
  env: string
  /** The setting it locks in the app, or null when only the environment sets it */
  field: string | null
  /** null for a secret, which is only ever shown as set */
  value: string | null
  secret: boolean
}

/** Whether the tools clips and casting need are on the server's path. */
export interface FfmpegTools {
  ffmpeg: boolean
  ffprobe: boolean
}

/** Where the settings live, for the "Handled for you" list. */
export interface ConfigStorage {
  /** null when the server has no state file, so settings can't be saved */
  settingsFile: string | null
  signingKey: 'environment' | 'settings'
}

/** GET /api/admin/config (server: AdminConfigResponse) */
export interface ConfigView {
  values: ConfigValues
  /** Each setting the environment locks, with the variables that lock its group */
  locked: Partial<Record<ConfigField, string[]>>
  environment: EnvVariable[]
  defaults: ConfigValues
  plexServerName: string | null
  ffmpeg: FfmpegTools
  storage: ConfigStorage
}

/** Something saved that won't work yet, e.g. Zipline on while clips are off. */
export interface ConfigWarning {
  code: 'zipline_unavailable' | 'feedback_unavailable'
  message: string
}

/** PUT /api/admin/config and POST /api/admin/plex/server (server: ConfigUpdateResponse) */
export interface ConfigUpdate {
  config: ConfigView
  warnings: ConfigWarning[]
}

/**
 * Body of PUT /api/admin/config: only the settings to change. A secret left
 * out keeps its saved value, null removes it, and a string replaces it. The
 * Plex server and its token are linked through POST /api/admin/plex/server.
 */
export type ConfigPatch = {
  [K in Exclude<ConfigField, 'plexServerToken' | 'plexServerMachineId' | 'plexDefaultRole'>]?:
    ConfigValues[K] extends SecretState ? string | null : ConfigValues[K]
} & { plexDefaultRole?: PlexRole }

/** What POST /api/admin/config/test can check (server: ProbeKind). */
export type TestKind = 'dispatcharr' | 'ersatztv' | 'giphy' | 'zipline' | 'ntfy'

/** Why a test failed (server: ProbeReason); the app words it. */
export type TestFailureReason = 'unreachable' | 'timeout' | 'auth' | 'not_found' | 'http' | 'invalid'

/**
 * The draft values a test uses (server: ProbeValues). Anything left out is
 * the saved value; a saved secret is only reused for the same address origin.
 */
export type TestValues = Partial<Record<
  | 'dispatcharrUrl'
  | 'dispatcharrApiKey'
  | 'ersatztvBaseUrl'
  | 'giphyApiKey'
  | 'ziplineUrl'
  | 'ziplineToken'
  | 'ntfyUrl'
  | 'ntfyTopic'
  | 'ntfyToken',
  string
>>

/** What a successful test found (server: ProbeCounts). */
export interface TestCounts {
  channels?: number | null
  groups?: number | null
  guideDays?: number | null
  username?: string | null
}

/** A connection test's outcome (server: ProbeResult). A failure is still HTTP 200. */
export interface ConnectionTestResult {
  ok: boolean
  reason?: TestFailureReason | null
  counts?: TestCounts
}

/** A member of the linked Plex server, for ticking admins (server: PlexMemberView). */
export interface PlexMember {
  plexId: string
  username: string
  managed: boolean
  owner: boolean
  admin: boolean
}

/** Body of POST /api/admin/plex/server: link (or re-link) one of your own servers. */
export interface PlexServerLink {
  authToken: string
  machineId: string
}
