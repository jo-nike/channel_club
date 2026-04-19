import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useNhlMappingStore } from './nhlMappingStore'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
  }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

describe('nhlMappingStore', () => {
  beforeEach(() => {
    useNhlMappingStore.setState({ overrides: {} })
    localStorageMock.clear()
  })

  it('setOverride records a network -> channelId binding', () => {
    useNhlMappingStore.getState().setOverride('ESPN', 'chan-1')
    expect(useNhlMappingStore.getState().overrides).toEqual({ ESPN: 'chan-1' })
  })

  it('setOverride replaces an existing binding for the same network', () => {
    useNhlMappingStore.getState().setOverride('ESPN', 'chan-1')
    useNhlMappingStore.getState().setOverride('ESPN', 'chan-2')
    expect(useNhlMappingStore.getState().overrides).toEqual({ ESPN: 'chan-2' })
  })

  it('clearOverride removes one network without touching others', () => {
    useNhlMappingStore.setState({ overrides: { ESPN: 'a', SN: 'b' } })
    useNhlMappingStore.getState().clearOverride('ESPN')
    expect(useNhlMappingStore.getState().overrides).toEqual({ SN: 'b' })
  })

  it('clearAll empties the mapping', () => {
    useNhlMappingStore.setState({ overrides: { ESPN: 'a', SN: 'b' } })
    useNhlMappingStore.getState().clearAll()
    expect(useNhlMappingStore.getState().overrides).toEqual({})
  })

  it('persists under the nhl-mapping-storage key', () => {
    expect(useNhlMappingStore.persist.getOptions().name).toBe('nhl-mapping-storage')
  })
})
