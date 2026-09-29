import { useAuthStore } from '@/stores/authStore'
import { logger } from '@/lib/logger'
import type {
  AppSettings,
  Channel,
  EPGProgrammesResponse,
  EPGResponse,
  GroupedChannelsResponse,
  NowPlayingBulkResponse,
  Program,
} from '@/types'

import { API_URL, apiAssetUrl } from './apiBase'

/**
 * Get absolute API URL for Chromecast.
 * Chromecast needs absolute URLs since it can't use browser's origin, so this
 * constructs one from window.location.
 */
export function getCastBaseUrl(): string {
  // Construct absolute URL from current location
  const hostname = window.location.hostname
  const protocol = window.location.protocol

  // If we're on default ports (80/443), don't append port
  if (window.location.port === '' || window.location.port === '80' || window.location.port === '443') {
    return `${protocol}//${hostname}/api`
  }

  // In dev, the frontend runs on a different port than the backend, so we
  // need to use the backend port (default 8001) instead of the frontend port
  // (5173). VITE_BACKEND_PORT is a dev-only override; prod falls through below.
  if (import.meta.env.DEV) {
    const backendPort = import.meta.env.VITE_BACKEND_PORT || '8001'
    return `${protocol}//${hostname}:${backendPort}/api`
  }

  // In prod, the backend serves the frontend, so reuse the current host:port
  return `${protocol}//${window.location.host}/api`
}

export interface LoginRequest {
  username: string
  password: string
}

export interface TokenResponse {
  accessToken: string
  tokenType: string
  role: 'admin' | 'viewer'
}

export interface AuthConfig {
  localAuthEnabled: boolean
  plexAuthEnabled: boolean
}

export async function login(credentials: LoginRequest): Promise<TokenResponse> {
  logger.debug('API', `Login attempt for user: ${credentials.username}`)

  const response = await fetch(`${API_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Login failed' }))
    logger.error('API', `Login failed for user: ${credentials.username}`, {
      status: response.status,
      detail: error.detail,
    })
    throw new Error(error.detail || 'Invalid credentials')
  }

  logger.info('API', `Login successful for user: ${credentials.username}`)
  return response.json()
}

export type RefreshResult =
  | { ok: true; token: string; role: 'admin' | 'viewer' }
  // expired: the sign-in is over (expired, past the 30-day cap, or no longer allowed);
  // temporary: rate limit, server or network trouble, worth trying again later
  | { ok: false; reason: 'expired' | 'temporary' }

/** Swap a session token for a fresh one. Only a 401 means the sign-in is over. */
export async function refreshSession(token: string): Promise<RefreshResult> {
  let response: Response
  try {
    response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    return { ok: false, reason: 'temporary' }
  }
  if (response.status === 401) return { ok: false, reason: 'expired' }
  if (!response.ok) {
    logger.warn('API', `Session refresh failed: ${response.status}`)
    return { ok: false, reason: 'temporary' }
  }
  const data: unknown = await response.json().catch(() => null)
  if (!data || typeof data !== 'object' || !('accessToken' in data) || typeof data.accessToken !== 'string'
    || !('role' in data) || (data.role !== 'admin' && data.role !== 'viewer')) {
    return { ok: false, reason: 'temporary' }
  }
  return { ok: true, token: data.accessToken, role: data.role }
}

/** The stored token, or the in-memory one when site storage is blocked (signed in for this page only). */
export function getAuthToken(): string | null {
  try {
    return localStorage.getItem('token')
  } catch {
    return useAuthStore.getState().token
  }
}

export async function fetchWithAuth(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  logger.debug('API', `Request: ${options.method || 'GET'} ${endpoint}`)

  const token = getAuthToken()
  const generation = useAuthStore.getState().generation

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  })

  // Handle 401 - unauthorized
  if (response.status === 401) {
    logger.error('API', `Session expired: ${endpoint}`, { status: 401 })
    // Clear auth state and redirect to login
    if (useAuthStore.getState().generation === generation && getAuthToken() === token) {
      useAuthStore.getState().logout()
    }
    throw new Error('Session expired')
  }

  return response
}

export interface ApplicationHealth {
  status: 'ok'
  version: string
  buildId: string
  revision: string
}

export async function healthCheck(signal?: AbortSignal): Promise<ApplicationHealth> {
  const response = await fetch(`${API_URL}/health`, { signal, cache: 'no-store' })
  if (!response.ok) throw new Error('Application health unavailable')
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object' || !('status' in data) || data.status !== 'ok'
    || !('version' in data) || typeof data.version !== 'string' || !data.version
    || !('buildId' in data) || typeof data.buildId !== 'string' || !data.buildId
    || !('revision' in data) || typeof data.revision !== 'string' || !data.revision) {
    throw new Error('Invalid application health response')
  }
  return data as ApplicationHealth
}

export async function fetchGroupedChannels(): Promise<GroupedChannelsResponse> {
  logger.debug('API', 'Fetching grouped channels')

  const response = await fetchWithAuth('/channels/grouped')

  if (!response.ok) {
    logger.error('API', `Failed to fetch grouped channels: ${response.status}`, {
      status: response.status,
      statusText: response.statusText,
    })
    if (response.status === 503) {
      throw new Error('Channel service unavailable')
    }
    throw new Error('Failed to fetch grouped channels')
  }

  const data: GroupedChannelsResponse = await response.json()
  const totalChannels = data.groups.reduce((sum, g) => sum + g.channels.length, 0) + data.ungrouped.length
  logger.debug('API', `Fetched ${data.groups.length} groups with ${totalChannels} total channels`)
  return data
}

export async function setCurrentChannel(channel: Channel): Promise<Channel> {
  logger.debug('API', `Setting current channel: ${channel.name}`)

  const response = await fetchWithAuth('/channels/current', {
    method: 'PUT',
    body: JSON.stringify(channel),
  })

  if (!response.ok) {
    logger.error('API', `Failed to set channel: ${response.status}`, {
      status: response.status,
      statusText: response.statusText,
      channel: channel.name,
    })
    if (response.status === 403) {
      throw new Error('Only admins can change the channel')
    }
    throw new Error('Failed to set channel')
  }

  logger.info('API', `Channel changed to: ${channel.name}`)
  return response.json()
}

export async function fetchCurrentChannel(): Promise<Channel | null> {
  logger.debug('API', 'Fetching current channel')

  const response = await fetchWithAuth('/channels/current')

  if (!response.ok) {
    logger.error('API', `Failed to fetch current channel: ${response.status}`)
    throw new Error('Failed to fetch current channel')
  }

  const data = await response.json()
  return data.currentChannel
}

export async function clearCurrentChannel(): Promise<void> {
  logger.debug('API', 'Clearing current channel')

  const response = await fetchWithAuth('/channels/current', {
    method: 'DELETE',
  })

  if (!response.ok) {
    logger.error('API', `Failed to clear channel: ${response.status}`, {
      status: response.status,
      statusText: response.statusText,
    })
    if (response.status === 403) {
      throw new Error('Only admins can stop live TV')
    }
    throw new Error('Could not stop live TV')
  }

  logger.info('API', 'Channel cleared')
}

export async function fetchNowPlaying(channelId: string, channelName?: string): Promise<EPGResponse> {
  logger.debug('API', `Fetching now playing for channel: ${channelId}`)

  // The name lets the server fall back to the guide's display names when the
  // id doesn't match; both need encoding
  const params = new URLSearchParams({ channel_id: channelId })
  if (channelName) params.set('channel_name', channelName)
  const response = await fetchWithAuth(`/epg/now-playing?${params}`)

  if (!response.ok) {
    logger.error('API', `Failed to fetch EPG: ${response.status}`, { channelId })
    throw new Error('Failed to fetch EPG')
  }

  return response.json()
}

/**
 * A live channel's schedule, from programmes that ended in the last 30
 * minutes to those starting within `hours` from now.
 */
export async function fetchLiveProgrammes(
  channelId: string,
  channelName?: string,
  hours = 12
): Promise<EPGProgrammesResponse> {
  logger.debug('API', `Fetching programmes for channel: ${channelId}`)

  // Same guide id and name fallback as fetchNowPlaying
  const params = new URLSearchParams({ channel_id: channelId, hours: String(hours) })
  if (channelName) params.set('channel_name', channelName)
  const response = await fetchWithAuth(`/epg/programmes?${params}`)

  if (!response.ok) {
    logger.error('API', `Failed to fetch programmes: ${response.status}`, { channelId })
    throw new Error('Failed to fetch programmes')
  }

  return response.json()
}

export async function fetchNowPlayingAll(): Promise<Record<string, Program>> {
  logger.debug('API', 'Fetching now playing for all channels')

  const response = await fetchWithAuth('/epg/now-playing/all')

  if (!response.ok) {
    logger.error('API', `Failed to fetch bulk EPG: ${response.status}`)
    throw new Error('Failed to fetch EPG')
  }

  const data: NowPlayingBulkResponse = await response.json()
  logger.debug('API', `Fetched now playing for ${Object.keys(data.nowPlaying).length} channels`)
  return data.nowPlaying
}

export async function fetchAppSettings(): Promise<AppSettings> {
  logger.debug('API', 'Fetching app settings')

  const response = await fetchWithAuth('/settings')

  if (!response.ok) {
    logger.error('API', `Failed to fetch app settings: ${response.status}`)
    throw new Error('Failed to fetch settings')
  }

  return response.json()
}

export async function updateAppSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  logger.debug('API', `Updating app settings: ${JSON.stringify(settings)}`)

  const response = await fetchWithAuth('/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  })

  if (!response.ok) {
    logger.error('API', `Failed to update app settings: ${response.status}`)
    if (response.status === 403) {
      throw new Error('Only admins can change settings')
    }
    throw new Error('Failed to update settings')
  }

  logger.info('API', 'App settings updated')
  return response.json()
}

export async function getAuthConfig(): Promise<AuthConfig> {
  logger.debug('API', 'Fetching auth config')

  const response = await fetch(`${API_URL}/auth/config`)
  if (!response.ok) {
    logger.error('API', `Failed to get auth config: ${response.status}`)
    throw new Error('Failed to get auth config')
  }
  return response.json()
}

export async function loginWithPlex(authToken: string): Promise<TokenResponse> {
  logger.debug('API', 'Attempting Plex login')

  const response = await fetch(`${API_URL}/auth/plex`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authToken }),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({ detail: 'Plex authentication failed' }))
    logger.error('API', 'Plex login failed', {
      status: response.status,
      detail: data.detail,
    })
    throw new Error(data.detail || 'Plex authentication failed')
  }

  logger.info('API', 'Plex login successful')
  return response.json()
}

// Highlight Capture API

export interface HighlightFeatureResponse {
  enabled: boolean
  ziplineEnabled: boolean
}

export interface HighlightStatusResponse {
  enabled: boolean
  recording: boolean
  ready?: boolean
  bufferSeconds: number
  maxBufferSeconds: number
}

export async function getHighlightFeatures(signal?: AbortSignal): Promise<HighlightFeatureResponse> {
  const response = await fetchWithAuth('/highlight/feature', { signal })
  if (!response.ok) return { enabled: false, ziplineEnabled: false }
  return response.json()
}

export async function getHighlightFeatureEnabled(): Promise<boolean> {
  return (await getHighlightFeatures()).enabled
}

export async function getHighlightStatus(channelId: string, signal?: AbortSignal): Promise<HighlightStatusResponse> {
  logger.debug('API', `Fetching highlight status for channel: ${channelId}`)

  const response = await fetchWithAuth(`/highlight/status/${channelId}`, { signal })

  if (!response.ok) {
    logger.error('API', `Failed to fetch highlight status: ${response.status}`)
    return { enabled: false, recording: false, bufferSeconds: 0, maxBufferSeconds: 60 }
  }

  return response.json()
}

export type HighlightFormat = 'mp4' | 'webm'

export interface TrimOptions {
  startTime?: number
  endTime?: number
}

export interface HighlightCapture {
  id: string
  duration: number
  bytes: number
  expiresAt: number
  /** Server time of the capture request (Unix seconds) */
  pressedAt: number
  /** When the capture's last frame was recorded (Unix seconds); the press is at duration - (endsAt - pressedAt) */
  endsAt: number
  /** "/api/..." path the editor's <video> streams by range; a capability that carries no session token */
  previewUrl: string
}

/** Snapshot the recent buffer server-side; the editor streams it by URL instead of downloading it. */
export async function createHighlightCapture(channelId: string, signal?: AbortSignal): Promise<HighlightCapture> {
  const response = await fetchWithAuth(`/highlight/${channelId}/capture`, { method: 'POST', signal })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Could not capture clip' }))
    throw new Error(error.detail || 'Could not capture clip')
  }
  return response.json()
}

/** The untrimmed MP4 is the capture itself; fetch it only when the user downloads it. */
export async function fetchHighlightCapture(captureId: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetchWithAuth(`/highlight/capture/${captureId}`, { signal })
  if (!response.ok) throw new Error('This capture is no longer available. Capture again to retry.')
  return response.blob()
}

/**
 * A single-use link, valid for a minute, that the browser's download manager can follow for the
 * untrimmed capture. Like the capture's previewUrl it carries no session token, so none ends up in
 * download history or proxy logs.
 */
export async function createCaptureDownloadUrl(captureId: string, signal?: AbortSignal): Promise<string> {
  const response = await fetchWithAuth(`/highlight/capture/${captureId}/download-token`, { method: 'POST', signal })
  if (!response.ok) throw new Error('This capture is no longer available. Capture again to retry.')
  const { url } = await response.json() as { url: string }
  const resolved = apiAssetUrl(url)
  if (!resolved) throw new Error('The download link was not valid. Please try again.')
  return resolved
}

/** Free server disk as soon as the editor closes; expiry covers anything missed. */
export async function deleteHighlightCapture(captureId: string): Promise<void> {
  try {
    await fetchWithAuth(`/highlight/capture/${captureId}`, { method: 'DELETE', keepalive: true })
  } catch {
    // Best effort only.
  }
}

/** Convert the exact snapshot the user previewed; never recapture the rolling live buffer. */
export async function exportHighlight(
  captureId: string,
  format: HighlightFormat,
  trimOptions?: TrimOptions,
  signal?: AbortSignal
): Promise<Blob> {
  const params = new URLSearchParams({ capture: captureId, format })
  if (trimOptions) {
    if (trimOptions.startTime !== undefined) params.set('start_time', String(trimOptions.startTime))
    if (trimOptions.endTime !== undefined) params.set('end_time', String(trimOptions.endTime))
  }
  const response = await fetchWithAuth(`/highlight/export?${params}`, { method: 'POST', signal })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to export highlight' }))
    throw new Error(error.detail || 'Failed to export highlight')
  }
  return response.blob()
}

export interface UploadedHighlight { url: string; name: string }

export async function uploadHighlight(clip: Blob, format: HighlightFormat, signal?: AbortSignal): Promise<UploadedHighlight> {
  const response = await fetchWithAuth(`/highlight/upload?format=${format}`, {
    method: 'POST', headers: { 'Content-Type': `video/${format}` }, body: clip, signal,
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Upload failed. Check Zipline before retrying.' }))
    throw new Error(error.detail || 'Upload failed. Check Zipline before retrying.')
  }
  return response.json()
}

// Chromecast API

export interface CastFeatureResponse {
  enabled: boolean
}

export interface CastSessionRequest {
  channel_id: string
  stream_type: 'hls' | 'mpegts'
  follows_live: boolean
}

export interface CastSessionResponse {
  session_id: string
  hls_url: string
  needs_transcoding: boolean
}

export async function getCastFeatureEnabled(): Promise<boolean> {
  logger.debug('API', 'Checking cast feature status')

  const response = await fetchWithAuth('/cast/feature')

  if (!response.ok) {
    logger.error('API', `Failed to check cast feature: ${response.status}`)
    return false
  }

  const data: CastFeatureResponse = await response.json()
  logger.debug('API', `Cast feature enabled: ${data.enabled}`)
  return data.enabled
}

export async function createCastSession(
  channelId: string,
  streamType: 'hls' | 'mpegts',
  followsLive = false
): Promise<CastSessionResponse> {
  logger.debug('API', `Creating cast session for channel: ${channelId} (type: ${streamType})`)

  // The server resolves the channel's source itself
  const body: CastSessionRequest = {
    channel_id: channelId,
    stream_type: streamType,
    follows_live: followsLive,
  }

  const response = await fetchWithAuth('/cast/session', {
    method: 'POST',
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to create cast session' }))
    logger.error('API', `Failed to create cast session: ${response.status}`, { detail: error.detail })
    throw new Error(error.detail || 'Failed to create cast session')
  }

  const data: CastSessionResponse = await response.json()
  logger.info('API', `Cast session created: ${data.session_id}`)
  return data
}

export async function stopCastSession(sessionId: string): Promise<void> {
  logger.debug('API', `Stopping cast session: ${sessionId}`)

  const response = await fetchWithAuth(`/cast/session/${sessionId}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    logger.error('API', `Failed to stop cast session: ${response.status}`)
    // Don't throw - session might already be cleaned up
  } else {
    logger.info('API', `Cast session stopped: ${sessionId}`)
  }
}

/**
 * Get the full URL for an HLS stream from a cast session.
 * Uses absolute URL so Chromecast can access it.
 */
export function getCastHlsUrl(sessionId: string): string {
  // No ?token=: the session id is the capability, the route never reads a token,
  // and a JWT here would end up in proxy logs and on the cast device.
  const baseUrl = getCastBaseUrl()
  return `${baseUrl}/cast/hls/${sessionId}/playlist.m3u8`
}
