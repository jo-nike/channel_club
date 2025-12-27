import { useAuthStore } from '@/stores/authStore'
import type { Channel } from '@/types'

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

export async function login(credentials: LoginRequest): Promise<TokenResponse> {
  const response = await fetch(`${API_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Login failed' }))
    throw new Error(error.detail || 'Invalid credentials')
  }

  return response.json()
}

export async function fetchWithAuth(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
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
  const response = await fetchWithAuth('/channels')

  if (!response.ok) {
    if (response.status === 503) {
      throw new Error('Channel service unavailable')
    }
    throw new Error('Failed to fetch channels')
  }

  return response.json()
}

export async function setCurrentChannel(channel: Channel): Promise<Channel> {
  const response = await fetchWithAuth('/channels/current', {
    method: 'PUT',
    body: JSON.stringify(channel),
  })

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error('Only admins can change the channel')
    }
    throw new Error('Failed to set channel')
  }

  return response.json()
}

export async function fetchCurrentChannel(): Promise<Channel | null> {
  const response = await fetchWithAuth('/channels/current')

  if (!response.ok) {
    throw new Error('Failed to fetch current channel')
  }

  const data = await response.json()
  return data.currentChannel
}
