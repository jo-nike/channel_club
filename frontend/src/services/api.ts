import { useAuthStore } from '@/stores/authStore'
import { logger } from '@/lib/logger'
import type { Channel, EPGResponse } from '@/types'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

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
    useAuthStore.getState().logout()
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

export async function fetchNowPlaying(channelId: string): Promise<EPGResponse> {
  logger.debug('API', `Fetching now playing for channel: ${channelId}`)

  const response = await fetchWithAuth(`/epg/now-playing?channel_id=${channelId}`)

  if (!response.ok) {
    logger.error('API', `Failed to fetch EPG: ${response.status}`, { channelId })
    throw new Error('Failed to fetch EPG')
  }

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
    const data = await response.json()
    logger.error('API', 'Plex login failed', {
      status: response.status,
      detail: data.detail,
    })
    throw new Error(data.detail || 'Plex authentication failed')
  }

  logger.info('API', 'Plex login successful')
  return response.json()
}
