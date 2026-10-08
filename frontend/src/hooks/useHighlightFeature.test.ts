import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@/test/utils'
import { useSettingsStore } from '@/stores/settingsStore'
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

  it('checks again when the server features may have changed', async () => {
    mockGetHighlightFeatureEnabled.mockResolvedValueOnce(false)
    const { result } = renderHook(() => useHighlightFeature())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isEnabled).toBe(false)

    mockGetHighlightFeatureEnabled.mockResolvedValueOnce(true)
    act(() => useSettingsStore.getState().noteFeaturesChanged())

    await waitFor(() => expect(result.current.isEnabled).toBe(true))
    expect(mockGetHighlightFeatureEnabled).toHaveBeenCalledTimes(2)
  })

  it('keeps the newest answer when an older one arrives late', async () => {
    let answerFirst: (enabled: boolean) => void = () => {}
    mockGetHighlightFeatureEnabled.mockReturnValueOnce(new Promise<boolean>((resolve) => { answerFirst = resolve }))
    mockGetHighlightFeatureEnabled.mockResolvedValueOnce(true)
    const { result } = renderHook(() => useHighlightFeature())

    act(() => useSettingsStore.getState().noteFeaturesChanged())
    await waitFor(() => expect(result.current.isEnabled).toBe(true))
    await act(async () => answerFirst(false))

    expect(result.current.isEnabled).toBe(true)
  })
})
