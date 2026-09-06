import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

describe('service worker migration', () => {
  it('holds activation until all old runtime caches are deleted', async () => {
    let activation: ((event: { waitUntil: (promise: Promise<unknown>) => void }) => void) | undefined
    const remove = vi.fn().mockResolvedValue(true)
    runInNewContext(readFileSync('public/sw-migration.js', 'utf8'), {
      self: { addEventListener: (_: string, callback: typeof activation) => { activation = callback } },
      caches: { delete: remove },
    })
    let completion: Promise<unknown> | undefined
    activation!({ waitUntil: (promise) => { completion = promise } })
    await completion
    expect(remove.mock.calls.map(([name]) => name)).toEqual(['api-cache', 'static-assets', 'image-cache'])
  })
})
// Runtime routing is exercised by scripts/check-service-worker.mjs against the
// actual production worker in Chrome, rather than duplicating regexes here.
