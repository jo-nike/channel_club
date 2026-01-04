import { fetchWithAuth } from '@/services/api'
import { logger } from '@/lib/logger'
import type {
  ErsatzTVChannel,
  ErsatzTVChannelsResponse,
  ErsatzTVCurrentResponse,
  ErsatzTVProgrammesResponse,
} from '@/types'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

export async function fetchErsatzTVChannels(): Promise<ErsatzTVChannel[]> {
  logger.debug('API', 'Fetching ErsatzTV channels')

  const response = await fetchWithAuth('/ersatztv/channels')

  if (!response.ok) {
    logger.error('API', `Failed to fetch ErsatzTV channels: ${response.status}`, {
      status: response.status,
      statusText: response.statusText,
    })
    if (response.status === 503) {
      throw new Error('ErsatzTV service unavailable')
    }
    throw new Error('Failed to fetch channels')
  }

  const data: ErsatzTVChannelsResponse = await response.json()
  logger.debug('API', `Fetched ${data.channels.length} ErsatzTV channels`)
  return data.channels
}

export async function fetchErsatzTVProgrammes(
  channelId: string,
  hours: number = 6
): Promise<ErsatzTVProgrammesResponse> {
  logger.debug('API', `Fetching ErsatzTV programmes for channel: ${channelId}`, {
    hours,
  })

  const response = await fetchWithAuth(
    `/ersatztv/programmes/${channelId}?hours=${hours}`
  )

  if (!response.ok) {
    logger.error('API', `Failed to fetch ErsatzTV programmes: ${response.status}`, {
      channelId,
    })
    throw new Error('Failed to fetch programmes')
  }

  return response.json()
}

export async function fetchErsatzTVCurrentProgramme(
  channelId: string
): Promise<ErsatzTVCurrentResponse> {
  logger.debug('API', `Fetching ErsatzTV current programme for channel: ${channelId}`)

  const response = await fetchWithAuth(`/ersatztv/current/${channelId}`)

  if (!response.ok) {
    logger.error('API', `Failed to fetch ErsatzTV current programme: ${response.status}`, {
      channelId,
    })
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
