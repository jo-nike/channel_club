import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@/test/utils'
import { useFeedbackFeature } from './useFeedbackFeature'
import * as api from '@/services/feedbackApi'

vi.mock('@/services/feedbackApi', () => ({
  getFeedbackFeatureEnabled: vi.fn(),
}))

const mockGetFeedbackFeatureEnabled = api.getFeedbackFeatureEnabled as ReturnType<typeof vi.fn>

describe('useFeedbackFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts disabled while loading', () => {
    mockGetFeedbackFeatureEnabled.mockImplementation(() => new Promise(() => {}))

    const { result } = renderHook(() => useFeedbackFeature())

    expect(result.current.isLoading).toBe(true)
    expect(result.current.isEnabled).toBe(false)
  })

  it('enables when the server says so', async () => {
    mockGetFeedbackFeatureEnabled.mockResolvedValue(true)

    const { result } = renderHook(() => useFeedbackFeature())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isEnabled).toBe(true)
  })

  it('stays disabled when the server says no', async () => {
    mockGetFeedbackFeatureEnabled.mockResolvedValue(false)

    const { result } = renderHook(() => useFeedbackFeature())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isEnabled).toBe(false)
  })

  it('stays disabled when the request fails', async () => {
    mockGetFeedbackFeatureEnabled.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useFeedbackFeature())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isEnabled).toBe(false)
  })

  it('calls the API once on mount', async () => {
    mockGetFeedbackFeatureEnabled.mockResolvedValue(true)

    const { result, rerender } = renderHook(() => useFeedbackFeature())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    rerender()

    expect(mockGetFeedbackFeatureEnabled).toHaveBeenCalledTimes(1)
  })
})
