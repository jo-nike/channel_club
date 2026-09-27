import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAudioStore, unmutedVolume } from './audioStore'

const readSaved = () => JSON.parse(localStorage.getItem('audio-storage') ?? 'null')

describe('audioStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useAudioStore.setState({ volume: 1, muted: false, savedMuteNotice: false, previewHolds: 0 })
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

  describe('unmutedVolume', () => {
    it('keeps an audible level and raises one below 0.1 to 0.25', () => {
      expect(unmutedVolume(0.3)).toBe(0.3)
      expect(unmutedVolume(0.1)).toBe(0.1)
      expect(unmutedVolume(0.05)).toBe(0.25)
      expect(unmutedVolume(0)).toBe(0.25)
    })
  })

  describe('savedMuteNotice', () => {
    it.each([
      ['setMuted(false)', () => useAudioStore.getState().setMuted(false)],
      ['setMuted(true)', () => useAudioStore.getState().setMuted(true)],
      ['setVolume', () => useAudioStore.getState().setVolume(0.6)],
      ['dismissSavedMuteNotice', () => useAudioStore.getState().dismissSavedMuteNotice()],
    ])('%s clears it: any audio choice this session replaces the saved one', (_name, choose) => {
      useAudioStore.setState({ volume: 0.3, muted: true, savedMuteNotice: true })
      choose()
      expect(useAudioStore.getState().savedMuteNotice).toBe(false)
    })

    it('is never saved', () => {
      useAudioStore.setState({ volume: 0.3, muted: true, savedMuteNotice: true })
      expect(readSaved()).toEqual({ state: { volume: 0.3, muted: true }, version: 1 })
    })
  })

  describe('preview hold', () => {
    it('counts holds, so the player stays silent until the last preview ends', () => {
      const { acquirePreview, releasePreview } = useAudioStore.getState()
      acquirePreview()
      acquirePreview()
      releasePreview()
      expect(useAudioStore.getState().previewHolds).toBe(1)
      releasePreview()
      expect(useAudioStore.getState().previewHolds).toBe(0)
    })

    it('never goes below zero', () => {
      useAudioStore.getState().releasePreview()
      expect(useAudioStore.getState().previewHolds).toBe(0)
    })

    it('leaves the saved level and mute alone', () => {
      useAudioStore.setState({ volume: 0.3, muted: false })
      useAudioStore.getState().acquirePreview()
      expect(useAudioStore.getState()).toMatchObject({ volume: 0.3, muted: false })
      useAudioStore.getState().releasePreview()
      expect(useAudioStore.getState()).toMatchObject({ volume: 0.3, muted: false })
    })

    it('is never saved and never writes audio-storage', () => {
      useAudioStore.getState().setVolume(0.4)
      vi.mocked(localStorage.setItem).mockClear()

      useAudioStore.getState().acquirePreview()
      useAudioStore.getState().releasePreview()

      expect(localStorage.setItem).not.toHaveBeenCalled()
      expect(readSaved()).toEqual({ state: { volume: 0.4, muted: false }, version: 1 })
    })

    it('is not picked up from another window', async () => {
      useAudioStore.getState().acquirePreview()
      localStorage.setItem('audio-storage', JSON.stringify({ state: { volume: 0.6, muted: true }, version: 1 }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'audio-storage' }))
      await vi.waitFor(() => expect(useAudioStore.getState()).toMatchObject({ volume: 0.6, muted: true }))
      expect(useAudioStore.getState().previewHolds).toBe(1)
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

  describe('page load', () => {
    const loadFresh = async () => {
      vi.resetModules()
      return (await import('./audioStore')).useAudioStore
    }

    it('flags a saved mute for the sound-off notice', async () => {
      localStorage.setItem('audio-storage', JSON.stringify({ state: { volume: 0.4, muted: true }, version: 1 }))
      const store = await loadFresh()
      expect(store.getState()).toMatchObject({ volume: 0.4, muted: true, savedMuteNotice: true })
    })

    it('flags nothing when the saved state is unmuted', async () => {
      localStorage.setItem('audio-storage', JSON.stringify({ state: { volume: 0.4, muted: false }, version: 1 }))
      const store = await loadFresh()
      expect(store.getState().savedMuteNotice).toBe(false)
    })

    it('flags nothing with nothing stored', async () => {
      const store = await loadFresh()
      expect(store.getState().savedMuteNotice).toBe(false)
    })

    it('flags a legacy level of 0, which was a mute', async () => {
      localStorage.setItem('ui-storage', JSON.stringify({ state: { volume: 0 }, version: 0 }))
      const store = await loadFresh()
      expect(store.getState().savedMuteNotice).toBe(true)
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
