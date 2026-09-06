import { useAuthStore } from '@/stores/authStore'
import { logger } from '@/lib/logger'
import type {
  AppSettings,
  Channel,
  EPGResponse,
  GroupedChannelsResponse,
  NowPlayingBulkResponse,
  Program,
} from '@/types'

import { API_URL } from './apiBase'

/**
 * Get absolute API URL for Chromecast.
 * Chromecast needs absolute URLs since it can't use browser's origin.
 * Uses VITE_CAST_BASE_URL if set, otherwise constructs from window.location.
 */
export function getCastBaseUrl(): string {
  // Explicit cast URL takes priority
  if (import.meta.env.VITE_CAST_BASE_URL) {
    return import.meta.env.VITE_CAST_BASE_URL
  }

  // If API_URL is already absolute, use it
  if (API_URL.startsWith('http://') || API_URL.startsWith('https://')) {
    return API_URL
  }

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

export async function fetchWithAuth(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  logger.debug('API', `Request: ${options.method || 'GET'} ${endpoint}`)

  const token = localStorage.getItem('token')
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
    if (useAuthStore.getState().generation === generation && localStorage.getItem('token') === token) {
      useAuthStore.getState().logout()
    }
    throw new Error('Session expired')
  }

  return response
}

export async function healthCheck(): Promise<{ status: string }> {
  const response = await fetch(`${API_URL}/health`)
  return response.json()
}

export async function fetchChannels(): Promise<Channel[]> {
  logger.debug('API', 'Fetching channels')

  const response = await fetchWithAuth('/channels')

  if (!response.ok) {
    logger.error('API', `Failed to fetch channels: ${response.status}`, {
      status: response.status,
      statusText: response.statusText,
    })
    if (response.status === 503) {
      throw new Error('Channel service unavailable')
    }
    throw new Error('Failed to fetch channels')
  }

  const data = await response.json()
  logger.debug('API', `Fetched ${data.length} channels`)
  return data
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
      throw new Error('Only admins can clear the channel')
    }
    throw new Error('Failed to clear channel')
  }

  logger.info('API', 'Channel cleared')
}

export async function fetchNowPlaying(channelId: string): Promise<EPGResponse> {
  logger.debug('API', `Fetching now playing for channel: ${channelId}`)

  const response = await fetchWithAuth(`/epg/now-playing?channel_id=${channelId}`)

  if (!response.ok) {
    logger.error('API', `Failed to fetch EPG: ${response.status}`, { channelId })
    throw new Error('Failed to fetch EPG')
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
}

export interface HighlightStatusResponse {
  enabled: boolean
  recording: boolean
  bufferSeconds: number
  maxBufferSeconds: number
}

export async function getHighlightFeatureEnabled(): Promise<boolean> {
  logger.debug('API', 'Checking highlight feature status')

  const response = await fetchWithAuth('/highlight/feature')

  if (!response.ok) {
    logger.error('API', `Failed to check highlight feature: ${response.status}`)
    return false
  }

  const data: HighlightFeatureResponse = await response.json()
  logger.debug('API', `Highlight feature enabled: ${data.enabled}`)
  return data.enabled
}

export async function getHighlightStatus(channelId: string): Promise<HighlightStatusResponse> {
  logger.debug('API', `Fetching highlight status for channel: ${channelId}`)

  const response = await fetchWithAuth(`/highlight/status/${channelId}`)

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

export async function saveHighlight(
  channelId: string,
  format: HighlightFormat = 'mp4',
  trimOptions?: TrimOptions
): Promise<Blob> {
  logger.debug('API', `Saving highlight for channel: ${channelId} (format: ${format}, trim: ${JSON.stringify(trimOptions)})`)

  const token = localStorage.getItem('token')
  const headers: Record<string, string> = {}

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  // Build URL with query params
  const params = new URLSearchParams({ format })
  if (trimOptions?.startTime !== undefined && trimOptions.startTime > 0) {
    params.append('start_time', trimOptions.startTime.toString())
  }
  if (trimOptions?.endTime !== undefined) {
    params.append('end_time', trimOptions.endTime.toString())
  }

  const response = await fetch(`${API_URL}/highlight/${channelId}?${params}`, {
    method: 'POST',
    headers,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to save highlight' }))
    logger.error('API', `Failed to save highlight: ${response.status}`, { detail: error.detail })
    throw new Error(error.detail || 'Failed to save highlight')
  }

  logger.info('API', `Highlight saved for channel: ${channelId} (format: ${format})`)
  return response.blob()
}

/** Convert the exact preview bytes; never recapture the rolling live buffer. */
export async function exportHighlight(
  preview: Blob,
  format: HighlightFormat,
  trimOptions?: TrimOptions
): Promise<Blob> {
  const params = new URLSearchParams({ format })
  if (trimOptions) {
    params.set('start_time', String(trimOptions.startTime))
    params.set('end_time', String(trimOptions.endTime))
  }
  const response = await fetchWithAuth(`/highlight/export?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'video/mp4' },
    body: preview,
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to export highlight' }))
    throw new Error(error.detail || 'Failed to export highlight')
  }
  return response.blob()
}

export async function saveHighlightWebM(channelId: string): Promise<Blob> {
  return saveHighlight(channelId, 'webm')
}

// Chromecast API

export interface CastFeatureResponse {
  enabled: boolean
}

export interface CastSessionRequest {
  channel_id: string
  stream_type: 'hls' | 'mpegts'
  stream_url?: string
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
  streamUrl?: string
): Promise<CastSessionResponse> {
  logger.debug('API', `Creating cast session for channel: ${channelId} (type: ${streamType})`)

  const body: CastSessionRequest = {
    channel_id: channelId,
    stream_type: streamType,
  }
  if (streamUrl) {
    body.stream_url = streamUrl
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
  const token = localStorage.getItem('token')
  const baseUrl = getCastBaseUrl()
  return `${baseUrl}/cast/hls/${sessionId}/playlist.m3u8${token ? `?token=${token}` : ''}`
}
