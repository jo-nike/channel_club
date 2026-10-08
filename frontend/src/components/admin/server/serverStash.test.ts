import { describe, it, expect, beforeEach } from 'vitest'
import { PLEX_PENDING_PIN_KEY } from '@/services/plexAuth'
import { clearServerTabStash, serverTabReturn, stashServerTab } from './serverStash'

const STASH_KEY = 'channel-club:server-tab-stash'

describe('serverStash', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('keeps the draft without secrets, and Re-link, while a Plex sign-in waits', () => {
    stashServerTab({
      draft: { values: { plexAuthEnabled: true, giphyApiKey: 'a key', viewerPassword: 'a guest password' }, sources: { ersatztv: true } },
      relinking: true,
    })
    sessionStorage.setItem(PLEX_PENDING_PIN_KEY, '42')

    expect(serverTabReturn()).toEqual({ draft: { values: { plexAuthEnabled: true }, sources: { ersatztv: true } }, relinking: true })
    expect(sessionStorage.getItem(STASH_KEY)).not.toContain('a key')
    // Reading leaves it for the next reader
    expect(serverTabReturn()).not.toBeNull()

    clearServerTabStash()
    expect(serverTabReturn()).toBeNull()
  })

  it('is nothing to go back to without a Plex sign-in waiting', () => {
    stashServerTab({ draft: { values: {}, sources: {} }, relinking: false })
    expect(serverTabReturn()).toBeNull()
  })

  it("ignores a stash that doesn't read as one", () => {
    sessionStorage.setItem(PLEX_PENDING_PIN_KEY, '42')
    for (const stored of ['{"draft": null, "relinking": false}', '{"draft": {"values": {}, "sources": {}}}', 'not json']) {
      sessionStorage.setItem(STASH_KEY, stored)
      expect(serverTabReturn()).toBeNull()
    }
  })
})
