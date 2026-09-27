import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@/test/utils'

type CanSetVolumeModule = typeof import('./useCanSetVolume')

const volumeDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume')

// Like iOS Safari: writes are ignored and the volume always reads 1
const makeVolumeReadOnly = () => {
  Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
    configurable: true,
    get: () => 1,
    set: () => {},
  })
}

describe('useCanSetVolume', () => {
  let mod: CanSetVolumeModule

  beforeEach(async () => {
    // Detection is cached per module; start each test with a fresh one
    vi.resetModules()
    mod = await import('./useCanSetVolume')
  })

  afterEach(() => {
    if (volumeDescriptor) Object.defineProperty(HTMLMediaElement.prototype, 'volume', volumeDescriptor)
  })

  it('resolves true where script can set the volume', async () => {
    await expect(mod.detectCanSetVolume()).resolves.toBe(true)
  })

  it('resolves false where the volume setter is a no-op', async () => {
    makeVolumeReadOnly()
    await expect(mod.detectCanSetVolume()).resolves.toBe(false)
  })

  it('detects once and caches the result', async () => {
    makeVolumeReadOnly()
    const first = mod.detectCanSetVolume()
    await expect(first).resolves.toBe(false)

    if (volumeDescriptor) Object.defineProperty(HTMLMediaElement.prototype, 'volume', volumeDescriptor)
    expect(mod.detectCanSetVolume()).toBe(first)
    await expect(mod.detectCanSetVolume()).resolves.toBe(false)
  })

  it('reports true until detection resolves, then the result', async () => {
    makeVolumeReadOnly()
    const { result } = renderHook(() => mod.useCanSetVolume())

    expect(result.current).toBe(true)
    await waitFor(() => expect(result.current).toBe(false))
  })

  it('stays true on browsers that can set the volume', async () => {
    const { result } = renderHook(() => mod.useCanSetVolume())

    await mod.detectCanSetVolume()
    expect(result.current).toBe(true)
  })
})
