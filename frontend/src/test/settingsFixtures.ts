import type { ConfigValues, ConfigView } from '@/types/setup'
import { EMPTY_DRAFT, type Draft, type SettingsState } from '@/components/server-settings/model/configDraft'

/** A fresh server's settings: the code defaults in backend/app/config.py. */
export const DEFAULT_VALUES: ConfigValues = {
  dispatcharrUrl: '',
  dispatcharrApiKey: { set: false },
  ersatztvBaseUrl: '',
  localAuthEnabled: false,
  adminUsername: 'admin',
  adminPassword: { set: false },
  viewerUsername: 'viewer',
  viewerPassword: { set: false },
  plexAuthEnabled: false,
  plexServerToken: { set: false },
  plexServerMachineId: null,
  plexAdminIds: [],
  userChannelSelection: false,
  presenceVisible: false,
  chatEnabled: false,
  giphyApiKey: { set: false },
  highlightEnabled: false,
  ziplineEnabled: false,
  ziplineUrl: '',
  ziplineToken: { set: false },
  nhlEnabled: false,
  ntfyEnabled: false,
  ntfyUrl: '',
  ntfyTopic: '',
  ntfyToken: { set: false },
  mediaProcessLimit: 8,
  mediaProcessPerUser: 2,
  castHlsSegmentTime: 4,
  castHlsListSize: 5,
  castSessionTimeout: 300,
  highlightBufferSeconds: 60,
  highlightSegmentSeconds: 10,
  mediaRecorderLimit: 4,
  mediaExportMaxBytes: 256 * 1024 * 1024,
  mediaExportLimit: 2,
  mediaExportPerUser: 1,
  mediaUploadLimit: 2,
  mediaUploadPerUser: 1,
  feedbackCooldownSeconds: 30,
  feedbackHourlyLimit: 10,
  requestBodyMaxBytes: 64 * 1024,
  logLevel: 'INFO',
  ersatztvLogoOrigins: [],
}

/** GET /api/admin/config for a server with these saved values and locks. */
export function configView(
  values: Partial<ConfigValues> = {},
  overrides: Partial<Omit<ConfigView, 'values'>> = {}
): ConfigView {
  return {
    values: { ...DEFAULT_VALUES, ...values },
    locked: {},
    environment: [],
    defaults: DEFAULT_VALUES,
    plexServerName: null,
    ffmpeg: { ffmpeg: true, ffprobe: true },
    storage: { settingsFile: '/data/settings.json', signingKey: 'settings' },
    ...overrides,
  }
}

/** Saved settings plus a draft, as a section reads them. */
export function settingsState(
  values: Partial<ConfigValues> = {},
  draft: Partial<Draft> = {},
  overrides: Partial<Omit<ConfigView, 'values'>> = {}
): SettingsState {
  return { view: configView(values, overrides), draft: { ...EMPTY_DRAFT, ...draft } }
}
