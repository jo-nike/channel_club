import { fetchWithAuth } from '@/services/api'
import type {
  ErsatzTVChannel,
  ErsatzTVChannelsResponse,
  ErsatzTVCurrentResponse,
  ErsatzTVProgrammesResponse,
} from '@/types'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

export async function fetchErsatzTVChannels(): Promise<ErsatzTVChannel[]> {
  const response = await fetchWithAuth('/ersatztv/channels')

  if (!response.ok) {
    if (response.status === 503) {
      throw new Error('ErsatzTV service unavailable')
    }
    throw new Error('Failed to fetch channels')
  }

  const data: ErsatzTVChannelsResponse = await response.json()
  return data.channels
}

export async function fetchErsatzTVProgrammes(
  channelId: string,
  hours: number = 6
): Promise<ErsatzTVProgrammesResponse> {
  const response = await fetchWithAuth(
    `/ersatztv/programmes/${channelId}?hours=${hours}`
  )

  if (!response.ok) {
    throw new Error('Failed to fetch programmes')
  }

  return response.json()
}

export async function fetchErsatzTVCurrentProgramme(
  channelId: string
): Promise<ErsatzTVCurrentResponse> {
  const response = await fetchWithAuth(`/ersatztv/current/${channelId}`)

  if (!response.ok) {
    throw new Error('Failed to fetch current programme')
  }

  return response.json()
}

export function getErsatzTVStreamUrl(channelId: string): string {
  const token = localStorage.getItem('token')
  // Return proxied stream URL with auth
  return `${API_URL}/ersatztv/stream/${channelId}?token=${token}`
}

export function getErsatzTVLogoUrl(channelId: string): string {
  return `${API_URL}/ersatztv/logos/${channelId}`
}
