import { fetchWithAuth } from './api'
import { logger } from '@/lib/logger'

export type FeedbackType = 'bug' | 'suggestion' | 'other'

export interface FeedbackContext {
  userAgent: string
  viewport: string
  path: string
  sessionId: string
  appVersion: string
}

export interface FeedbackPayload {
  type: FeedbackType
  message: string
  contact?: string
  context?: FeedbackContext
}

export interface FeedbackFeatureResponse {
  enabled: boolean
}

const FALLBACK_ERROR = 'Could not send feedback. Please try again.'

/**
 * Check if the feedback feature is configured on the server.
 */
export async function getFeedbackFeatureEnabled(): Promise<boolean> {
  logger.debug('Feedback', 'Checking feedback feature status')

  const response = await fetchWithAuth('/feedback/feature')

  if (!response.ok) {
    logger.error('Feedback', `Failed to check feedback feature: ${response.status}`)
    return false
  }

  const data: FeedbackFeatureResponse = await response.json()
  logger.debug('Feedback', `Feedback feature enabled: ${data.enabled}`)
  return data.enabled
}

/**
 * Send one report. Throws with the server's explanation on failure.
 */
export async function submitFeedback(payload: FeedbackPayload): Promise<void> {
  logger.debug('Feedback', `Submitting ${payload.type} feedback`)

  const response = await fetchWithAuth('/feedback', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const error: { detail?: unknown } = await response.json().catch(() => ({}))
    const detail = typeof error.detail === 'string' ? error.detail : FALLBACK_ERROR
    logger.error('Feedback', `Failed to send feedback: ${response.status}`, { detail })
    throw new Error(detail)
  }

  logger.debug('Feedback', 'Feedback sent')
}
