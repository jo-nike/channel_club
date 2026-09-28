import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { checkForAppUpdate, noticeServerBuild, offerAppUpdate, resetAppUpdate, watchForAppUpdates } from './appUpdate'

vi.mock('sonner', () => ({ toast: vi.fn() }))

function fakeRegistration() {
  return { update: vi.fn().mockResolvedValue(undefined) } as unknown as ServiceWorkerRegistration & { update: ReturnType<typeof vi.fn> }
}

function addVideo({ playing }: { playing: boolean }) {
  const video = document.createElement('video')
  Object.defineProperty(video, 'paused', { value: !playing })
  document.body.appendChild(video)
}

describe('app updates', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(toast).mockClear()
  })

  afterEach(() => {
    resetAppUpdate()
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  describe('noticeServerBuild', () => {
    it('checks for an update when the server runs a different build', () => {
      const registration = fakeRegistration()
      watchForAppUpdates(registration)

      noticeServerBuild('build-b', 'build-a')

      expect(registration.update).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['the same build', 'build-a', 'build-a'],
      ['a dev server', 'dev', 'build-a'],
      ['a dev bundle', 'build-b', 'dev'],
      ['an older server with no build id', undefined, 'build-a'],
    ])('does nothing for %s', (_case, server, client) => {
      const registration = fakeRegistration()
      watchForAppUpdates(registration)

      noticeServerBuild(server, client)

      expect(registration.update).not.toHaveBeenCalled()
    })
  })

  it('checks for an update every hour', () => {
    const registration = fakeRegistration()
    watchForAppUpdates(registration)

    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(registration.update).toHaveBeenCalledTimes(1)
  })

  it('ignores a check before the worker is registered', () => {
    expect(() => checkForAppUpdate()).not.toThrow()
  })

  describe('offerAppUpdate', () => {
    it('applies the update at once when nothing is playing', () => {
      addVideo({ playing: false })
      const updateSW = vi.fn().mockResolvedValue(undefined)

      offerAppUpdate(updateSW)

      expect(updateSW).toHaveBeenCalledWith(true)
      expect(toast).not.toHaveBeenCalled()
    })

    it('never reloads a tab with a playing video; it offers Reload instead', () => {
      addVideo({ playing: true })
      const updateSW = vi.fn().mockResolvedValue(undefined)

      offerAppUpdate(updateSW)

      expect(updateSW).not.toHaveBeenCalled()
      expect(toast).toHaveBeenCalledWith('Channel Club was updated', expect.objectContaining({ duration: Infinity }))

      // The viewer chooses Reload
      const options = vi.mocked(toast).mock.calls[0][1] as { action: { label: string; onClick: () => void } }
      expect(options.action.label).toBe('Reload')
      options.action.onClick()
      expect(updateSW).toHaveBeenCalledWith(true)
    })
  })
})
