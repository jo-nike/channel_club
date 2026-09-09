import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getFeedbackFeatureEnabled, submitFeedback } from './feedbackApi'

vi.mock('./api', () => ({
  fetchWithAuth: vi.fn(),
}))

import { fetchWithAuth } from './api'

describe('feedbackApi service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getFeedbackFeatureEnabled', () => {
    it('returns the server flag', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ enabled: true }),
      } as Response)

      await expect(getFeedbackFeatureEnabled()).resolves.toBe(true)
      expect(fetchWithAuth).toHaveBeenCalledWith('/feedback/feature')
    })

    it('returns false on request error', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValueOnce({ ok: false, status: 500 } as Response)

      await expect(getFeedbackFeatureEnabled()).resolves.toBe(false)
    })
  })

  describe('submitFeedback', () => {
    const payload = {
      type: 'bug' as const,
      message: 'The guide is blank',
      contact: '',
      context: { userAgent: 'UA', viewport: '1x1', path: '/', sessionId: 'abc', appVersion: '1.0.0' },
    }

    it('posts the payload as JSON', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValueOnce({ ok: true } as Response)

      await submitFeedback(payload)

      expect(fetchWithAuth).toHaveBeenCalledWith('/feedback', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    })

    it('throws the server detail on failure', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ detail: 'Please wait 30s before sending more feedback' }),
      } as Response)

      await expect(submitFeedback(payload)).rejects.toThrow('Please wait 30s before sending more feedback')
    })

    it('falls back to a generic message when the detail is not a string', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ detail: [{ msg: 'field required' }] }),
      } as Response)

      await expect(submitFeedback(payload)).rejects.toThrow('Could not send feedback. Please try again.')
    })

    it('falls back to a generic message when the body is not JSON', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error('not json')),
      } as Response)

      await expect(submitFeedback(payload)).rejects.toThrow('Could not send feedback. Please try again.')
    })
  })
})
