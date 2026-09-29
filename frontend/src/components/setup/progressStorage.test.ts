import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { clearProgress, clearStash, loadProgress, loadStash, saveProgress, stashForRedirect } from './progressStorage'

const PROGRESS_KEY = 'channel-club:setup-progress'
const STASH_KEY = 'channel-club:setup-stash'
const PASS = 'hunter two'
const KEY = 'api key one'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('progress', () => {
  it('keeps the step and how far setup got', () => {
    expect(loadProgress()).toBeNull()

    saveProgress({ step: 'extras', reached: 4 })

    expect(JSON.parse(localStorage.getItem(PROGRESS_KEY)!)).toEqual({ step: 'extras', reached: 4 })
    expect(loadProgress()).toEqual({ step: 'extras', reached: 4 })

    clearProgress()
    expect(loadProgress()).toBeNull()
  })

  it.each([
    ['broken JSON', '{"step":'],
    ['an unknown step', '{"step":"done","reached":2}'],
    ['a step count past the last', '{"step":"sources","reached":6}'],
    ['a fraction', '{"step":"sources","reached":2.5}'],
    ['a negative count', '{"step":"sources","reached":-1}'],
    ['null', 'null'],
  ])('reads nothing from %s', (_what, stored) => {
    localStorage.setItem(PROGRESS_KEY, stored)
    expect(loadProgress()).toBeNull()
  })

  it('carries on without it when storage is blocked', () => {
    const blocked = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    }
    vi.mocked(localStorage.getItem).mockImplementationOnce(blocked)
    vi.mocked(localStorage.setItem).mockImplementationOnce(blocked)
    vi.mocked(localStorage.removeItem).mockImplementationOnce(blocked)

    expect(loadProgress()).toBeNull()
    expect(() => saveProgress({ step: 'sources', reached: 2 })).not.toThrow()
    expect(() => clearProgress()).not.toThrow()
  })
})

describe('the stash kept across a Plex redirect', () => {
  it('keeps the step, the sign-in chosen and the draft, in this tab only, and never a secret', () => {
    stashForRedirect({
      step: 'access',
      reached: 3,
      account: { method: 'password', username: 'sam' },
      draft: {
        values: { adminPassword: PASS, dispatcharrApiKey: KEY, viewerUsername: 'guest', chatEnabled: true },
        sources: { ersatztv: true },
      },
    })

    const stored = sessionStorage.getItem(STASH_KEY)!
    expect(stored).not.toContain(PASS)
    expect(stored).not.toContain(KEY)
    expect(localStorage.getItem(STASH_KEY)).toBeNull()
    expect(loadStash()).toEqual({
      step: 'access',
      reached: 3,
      account: { method: 'password', username: 'sam' },
      draft: { values: { viewerUsername: 'guest', chatEnabled: true }, sources: { ersatztv: true } },
    })
  })

  it('keeps no draft before the claim', () => {
    stashForRedirect({ step: 'account', reached: 1, account: { method: 'plex', username: 'admin' }, draft: null })
    expect(loadStash()).toEqual({ step: 'account', reached: 1, account: { method: 'plex', username: 'admin' }, draft: null })
  })

  it('drops a secret that got into storage some other way', () => {
    sessionStorage.setItem(
      STASH_KEY,
      JSON.stringify({ step: 'sources', reached: 2, account: { method: 'plex', username: 'admin' }, draft: { values: { ntfyToken: KEY, ntfyTopic: 'club' }, sources: {} } })
    )
    expect(loadStash()?.draft).toEqual({ values: { ntfyTopic: 'club' }, sources: {} })
  })

  it('stays until cleared, so reading it twice finds it twice', () => {
    stashForRedirect({ step: 'account', reached: 1, account: { method: 'plex', username: 'admin' }, draft: null })
    expect(loadStash()).not.toBeNull()
    expect(loadStash()).not.toBeNull()

    clearStash()
    expect(loadStash()).toBeNull()
  })

  it.each([
    ['broken JSON', '{"step"'],
    ['no account', '{"step":"account","reached":1,"draft":null}'],
    ['an unknown sign-in', '{"step":"account","reached":1,"account":{"method":"oidc","username":"sam"},"draft":null}'],
    ['a username that is not text', '{"step":"account","reached":1,"account":{"method":"plex","username":7},"draft":null}'],
    ['no draft at all', '{"step":"account","reached":1,"account":{"method":"plex","username":"sam"}}'],
    ['a bad step', '{"step":"done","reached":1,"account":{"method":"plex","username":"sam"},"draft":null}'],
  ])('reads nothing from a stash with %s', (_what, stored) => {
    sessionStorage.setItem(STASH_KEY, stored)
    expect(loadStash()).toBeNull()
  })

  it("keeps the step from a stash whose draft doesn't read as one", () => {
    sessionStorage.setItem(STASH_KEY, '{"step":"access","reached":3,"account":{"method":"plex","username":"sam"},"draft":{"values":null}}')
    expect(loadStash()).toEqual({ step: 'access', reached: 3, account: { method: 'plex', username: 'sam' }, draft: null })
  })

  it('carries on without it when storage is blocked', () => {
    const blocked = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked)

    expect(() => stashForRedirect({ step: 'account', reached: 1, account: { method: 'plex', username: 'admin' }, draft: null })).not.toThrow()
    expect(loadStash()).toBeNull()
    expect(() => clearStash()).not.toThrow()
  })
})
