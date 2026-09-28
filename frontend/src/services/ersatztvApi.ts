import { fetchWithAuth } from '@/services/api'
import { logger } from '@/lib/logger'
import type {
  ErsatzTVChannel,
  ErsatzTVChannelsResponse,
  ErsatzTVCurrentResponse,
  ErsatzTVProgrammesResponse,
} from '@/types'

import { API_URL, apiAssetUrl } from './apiBase'

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

/**
 * Open a stream session for a channel and return its playlist URL. The URL
 * carries no session token: the session id in its path is the capability, so
 * nothing secret reaches proxy logs or a Chromecast.
 */
export async function createErsatzTVStreamSession(channelId: string): Promise<string> {
  logger.debug('API', `Opening ErsatzTV stream session for channel: ${channelId}`)

  const response = await fetchWithAuth('/ersatztv/session', {
    method: 'POST',
    body: JSON.stringify({ channelId }),
  })

  if (!response.ok) {
    logger.error('API', `Failed to open ErsatzTV stream session: ${response.status}`, {
      channelId,
    })
    if (response.status === 503) {
      throw new Error('ErsatzTV service unavailable')
    }
    throw new Error('Failed to open stream')
  }

  const { url } = (await response.json()) as { url: string }
  const resolved = apiAssetUrl(url)
  if (!resolved) throw new Error('Failed to open stream')
  return resolved
}

export function getErsatzTVLogoUrl(channelId: string): string {
  return `${API_URL}/ersatztv/logos/${channelId}`
}
