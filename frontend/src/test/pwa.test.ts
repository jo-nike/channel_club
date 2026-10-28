import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

type LifecycleEvent = { waitUntil: (promise: Promise<unknown>) => void }

// Run the migration script against fake worker globals and return its listeners
function loadMigration(caches: Record<string, unknown>, skipWaiting = vi.fn()) {
  const listeners: Record<string, (event: LifecycleEvent) => void> = {}
  runInNewContext(readFileSync('public/sw-migration.js', 'utf8'), {
    self: {
      addEventListener: (type: string, callback: (event: LifecycleEvent) => void) => { listeners[type] = callback },
      skipWaiting,
    },
    caches,
  })
  return listeners
}

async function dispatch(listener: (event: LifecycleEvent) => void) {
  let completion: Promise<unknown> | undefined
  listener({ waitUntil: (promise) => { completion = promise } })
  await completion
}

describe('service worker migration', () => {
  it('holds activation until all old runtime caches are deleted', async () => {
    const remove = vi.fn().mockResolvedValue(true)
    const listeners = loadMigration({ delete: remove })
    await dispatch(listeners.activate)
    expect(remove.mock.calls.map(([name]) => name)).toEqual(['api-cache', 'static-assets', 'image-cache'])
  })

  it('takes over once, from the autoUpdate worker, and records that it has', async () => {
    const skipWaiting = vi.fn()
    const open = vi.fn().mockResolvedValue({})
    const listeners = loadMigration({ has: vi.fn().mockResolvedValue(false), open }, skipWaiting)
    await dispatch(listeners.install)
    expect(open).toHaveBeenCalledWith('prompt-mode-migrated')
    expect(skipWaiting).toHaveBeenCalledTimes(1)
  })

  it('leaves later updates waiting for the prompt', async () => {
    const skipWaiting = vi.fn()
    const listeners = loadMigration({ has: vi.fn().mockResolvedValue(true), open: vi.fn() }, skipWaiting)
    await dispatch(listeners.install)
    expect(skipWaiting).not.toHaveBeenCalled()
  })
})
