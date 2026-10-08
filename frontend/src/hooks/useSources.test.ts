import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@/test/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { currentSources, useErsatztvKnownOn, useSources } from './useSources'

const features = (dispatcharr: boolean, ersatztv: boolean) => ({
  chat: false,
  gif: false,
  nhl: false,
  sources: { dispatcharr, ersatztv },
})

describe('useSources', () => {
  beforeEach(() => {
    useSettingsStore.setState({ serverFeatures: null })
  })

  it('counts both sources as set up until the server says, as before it could', () => {
    expect(renderHook(() => useSources()).result.current).toEqual({ dispatcharr: true, ersatztv: true })
    expect(currentSources()).toEqual({ dispatcharr: true, ersatztv: true })
    expect(renderHook(() => useErsatztvKnownOn()).result.current).toBe(false)
  })

  it('follows the server', () => {
    const { result, rerender } = renderHook(() => ({ sources: useSources(), knownOn: useErsatztvKnownOn() }))

    act(() => useSettingsStore.getState().setServerFeatures(features(false, true)))
    rerender()
    expect(result.current.sources).toEqual({ dispatcharr: false, ersatztv: true })
    expect(result.current.knownOn).toBe(true)

    act(() => useSettingsStore.getState().setServerFeatures(features(true, false)))
    rerender()
    expect(result.current.sources).toEqual({ dispatcharr: true, ersatztv: false })
    expect(result.current.knownOn).toBe(false)
    expect(currentSources()).toEqual({ dispatcharr: true, ersatztv: false })
  })
})
