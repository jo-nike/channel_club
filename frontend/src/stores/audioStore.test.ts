import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAudioStore } from './audioStore'

const readSaved = () => JSON.parse(localStorage.getItem('audio-storage') ?? 'null')

describe('audioStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useAudioStore.setState({ volume: 1, muted: false })
    localStorage.clear()
  })

  describe('setVolume', () => {
    it('snaps the level to hundredths', () => {
      useAudioStore.getState().setVolume(0.333)
      expect(useAudioStore.getState().volume).toBe(0.33)
    })

    it('snaps away keyboard float drift', () => {
      useAudioStore.getState().setVolume(0.2 + 0.1)
      expect(useAudioStore.getState().volume).toBe(0.3)
    })

    it('clamps to 0..1', () => {
      useAudioStore.getState().setVolume(1.4)
      expect(useAudioStore.getState().volume).toBe(1)
    })

    it('mutes below 0.01 and keeps the previous level', () => {
      useAudioStore.getState().setVolume(0.3)
      useAudioStore.getState().setVolume(0.004)
      expect(useAudioStore.getState()).toMatchObject({ volume: 0.3, muted: true })
      useAudioStore.getState().setVolume(0)
      expect(useAudioStore.getState()).toMatchObject({ volume: 0.3, muted: true })
    })

    it('unmutes when an audible level is chosen', () => {
      useAudioStore.setState({ volume: 0.3, muted: true })
      useAudioStore.getState().setVolume(0.6)
      expect(useAudioStore.getState()).toMatchObject({ volume: 0.6, muted: false })
    })
  })

  describe('setMuted', () => {
    it('mutes without touching the level', () => {
      useAudioStore.setState({ volume: 0.3, muted: false })
      useAudioStore.getState().setMuted(true)
      expect(useAudioStore.getState()).toMatchObject({ volume: 0.3, muted: true })
    })

    it('unmutes at the saved level', () => {
      useAudioStore.setState({ volume: 0.3, muted: true })
      useAudioStore.getState().setMuted(false)
      expect(useAudioStore.getState()).toMatchObject({ volume: 0.3, muted: false })
    })

    it('unmuting below 0.1 raises the level to 0.25', () => {
      useAudioStore.setState({ volume: 0.05, muted: true })
      useAudioStore.getState().setMuted(false)
      expect(useAudioStore.getState()).toMatchObject({ volume: 0.25, muted: false })
    })
  })

  describe('persistence', () => {
    it('saves volume and mute under audio-storage', () => {
      useAudioStore.getState().setVolume(0.4)
      useAudioStore.getState().setMuted(true)
      expect(useAudioStore.persist.getOptions().name).toBe('audio-storage')
      expect(readSaved()).toEqual({ state: { volume: 0.4, muted: true }, version: 1 })
    })

    it('picks up a change saved by another window', async () => {
      localStorage.setItem('audio-storage', JSON.stringify({ state: { volume: 0.6, muted: true }, version: 1 }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'audio-storage' }))
      await vi.waitFor(() => expect(useAudioStore.getState()).toMatchObject({ volume: 0.6, muted: true }))
    })

    it('ignores storage events for other keys', async () => {
      localStorage.setItem('audio-storage', JSON.stringify({ state: { volume: 0.6, muted: true }, version: 1 }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'ui-storage' }))
      await Promise.resolve()
      expect(useAudioStore.getState()).toMatchObject({ volume: 1, muted: false })
    })
  })

  describe('seed from the legacy ui-storage volume', () => {
    const loadFresh = async () => {
      vi.resetModules()
      return (await import('./audioStore')).useAudioStore
    }

    it('seeds the saved level and writes it at once', async () => {
      localStorage.setItem('ui-storage', JSON.stringify({ state: { volume: 0.3 }, version: 0 }))
      const store = await loadFresh()
      expect(store.getState()).toMatchObject({ volume: 0.3, muted: false })
      expect(readSaved()).toEqual({ state: { volume: 0.3, muted: false }, version: 1 })
    })

    it('treats a legacy level of 0 as muted at 0.5', async () => {
      localStorage.setItem('ui-storage', JSON.stringify({ state: { volume: 0 }, version: 0 }))
      const store = await loadFresh()
      expect(store.getState()).toMatchObject({ volume: 0.5, muted: true })
      expect(readSaved()?.state).toEqual({ volume: 0.5, muted: true })
    })

    it('does not seed once audio-storage exists', async () => {
      localStorage.setItem('audio-storage', JSON.stringify({ state: { volume: 0.7, muted: false }, version: 1 }))
      localStorage.setItem('ui-storage', JSON.stringify({ state: { volume: 0.3 }, version: 0 }))
      const store = await loadFresh()
      expect(store.getState()).toMatchObject({ volume: 0.7, muted: false })
    })

    it('starts at full volume, unmuted, with nothing stored', async () => {
      const store = await loadFresh()
      expect(store.getState()).toMatchObject({ volume: 1, muted: false })
      expect(localStorage.getItem('audio-storage')).toBeNull()
    })

    it('ignores unreadable ui-storage', async () => {
      localStorage.setItem('ui-storage', '{not json')
      const store = await loadFresh()
      expect(store.getState()).toMatchObject({ volume: 1, muted: false })
    })
  })
})
