import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@/test/utils'
import { fetchGroupedChannels } from '@/services/api'
import { useSettingsStore } from '@/stores/settingsStore'
import { useChannelCatalogueLoad } from './useChannelCatalogue'

vi.mock('@/services/api', () => ({ fetchGroupedChannels: vi.fn() }))

const tsn = { id: '1', name: 'TSN', streamUrl: 'http://s/1', guideId: '1' }

describe('useChannelCatalogueLoad', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchGroupedChannels).mockResolvedValue({ groups: [], ungrouped: [tsn] })
    useSettingsStore.setState({ serverFeatures: null })
  })

  it('loads the catalogue while Dispatcharr is set up', async () => {
    const { result } = renderHook(() => useChannelCatalogueLoad())

    await waitFor(() => expect(result.current.catalogue?.get('1')).toEqual(tsn))
    expect(result.current.failed).toBe(false)
  })

  it('fetches nothing and is empty, not failed, without Dispatcharr', () => {
    useSettingsStore.setState({
      serverFeatures: { chat: false, gif: false, nhl: false, sources: { dispatcharr: false, ersatztv: true } },
    })
    const { result } = renderHook(() => useChannelCatalogueLoad())

    expect(fetchGroupedChannels).not.toHaveBeenCalled()
    expect(result.current.catalogue?.size).toBe(0)
    expect(result.current.failed).toBe(false)
  })
})
