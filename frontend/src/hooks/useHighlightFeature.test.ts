import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useHighlightFeature } from './useHighlightFeature'
import * as api from '@/services/api'

// Mock the API service
vi.mock('@/services/api', () => ({
  getHighlightFeatureEnabled: vi.fn(),
}))

const mockGetHighlightFeatureEnabled = api.getHighlightFeatureEnabled as ReturnType<typeof vi.fn>

describe('useHighlightFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts with loading state', () => {
    mockGetHighlightFeatureEnabled.mockImplementation(() => new Promise(() => {})) // Never resolves

    const { result } = renderHook(() => useHighlightFeature())

    expect(result.current.isLoading).toBe(true)
    expect(result.current.isEnabled).toBe(false)
  })

  it('sets isEnabled to true when API returns true', async () => {
    mockGetHighlightFeatureEnabled.mockResolvedValue(true)

    const { result } = renderHook(() => useHighlightFeature())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.isEnabled).toBe(true)
  })

  it('sets isEnabled to false when API returns false', async () => {
    mockGetHighlightFeatureEnabled.mockResolvedValue(false)

    const { result } = renderHook(() => useHighlightFeature())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.isEnabled).toBe(false)
  })

  it('sets isEnabled to false when API call fails', async () => {
    mockGetHighlightFeatureEnabled.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useHighlightFeature())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.isEnabled).toBe(false)
  })

  it('calls API only once on mount', async () => {
    mockGetHighlightFeatureEnabled.mockResolvedValue(true)

    const { result, rerender } = renderHook(() => useHighlightFeature())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    // Rerender
    rerender()

    // Should still only be called once
    expect(mockGetHighlightFeatureEnabled).toHaveBeenCalledTimes(1)
  })
})
