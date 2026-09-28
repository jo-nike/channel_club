import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { checkForAppUpdate, handleServiceWorkerUpdates, noticeServerBuild, offerAppUpdate, resetAppUpdate, watchForAppUpdates } from './appUpdate'

vi.mock('sonner', () => ({ toast: vi.fn() }))

function fakeRegistration() {
  return { update: vi.fn().mockResolvedValue(undefined) } as unknown as ServiceWorkerRegistration & { update: ReturnType<typeof vi.fn> }
}

// A stand-in for this tab's Workbox: records listeners so tests can fire lifecycle events
function fakeWorkbox() {
  const listeners: Record<string, (event: { isUpdate?: boolean; isExternal?: boolean }) => void> = {}
  return {
    addEventListener: (type: string, listener: (event: { isUpdate?: boolean }) => void) => { listeners[type] = listener },
    messageSkipWaiting: vi.fn(),
    fire: (type: string, event: { isUpdate?: boolean; isExternal?: boolean } = {}) => listeners[type](event),
  }
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

  describe('handleServiceWorkerUpdates', () => {
    function wire() {
      const wb = fakeWorkbox()
      const reload = vi.fn()
      handleServiceWorkerUpdates(wb as unknown as Parameters<typeof handleServiceWorkerUpdates>[0], reload)
      return { wb, reload }
    }

    it('applies a waiting worker in an idle tab and reloads when it takes control', () => {
      const { wb, reload } = wire()

      wb.fire('waiting')
      expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1)

      wb.fire('controlling', { isUpdate: true })
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it("does not reload a playing tab when another tab's automatic apply takes control", () => {
      addVideo({ playing: true })
      const { wb, reload } = wire()

      wb.fire('waiting')
      expect(wb.messageSkipWaiting).not.toHaveBeenCalled()
      expect(toast).toHaveBeenCalledWith('Channel Club was updated', expect.objectContaining({ duration: Infinity }))

      // An idle tab in the same browser applied the update; the new worker controls every tab
      wb.fire('controlling', { isUpdate: true })
      expect(reload).not.toHaveBeenCalled()

      // The viewer chooses Reload later
      const options = vi.mocked(toast).mock.calls[0][1] as { action: { onClick: () => void } }
      options.action.onClick()
      expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1)
      wb.fire('controlling', { isUpdate: true })
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('does not reload when the first worker takes control', () => {
      const { wb, reload } = wire()

      wb.fire('controlling', { isUpdate: false })

      expect(reload).not.toHaveBeenCalled()
    })
  })
})
