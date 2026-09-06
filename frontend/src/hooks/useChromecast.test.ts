import { createElement } from 'react'
import { CastButton } from '@/components/CastButton'
import { act, cleanup, fireEvent, render, screen, renderHook, waitFor } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChromecast } from './useChromecast'
import * as api from '@/services/api'
vi.mock('@/services/api', () => ({ getCastFeatureEnabled: vi.fn().mockResolvedValue(true), createCastSession: vi.fn(), stopCastSession: vi.fn().mockResolvedValue(undefined), getCastHlsUrl: (id: string) => `https://fixture/${id}`, getCastBaseUrl: () => 'https://fixture/api' }))
const listeners = new Map<string, Set<(event: { sessionState: string }) => void>>()
const session = { getCastDevice: () => ({ friendlyName: 'Fixture receiver' }), loadMedia: vi.fn().mockResolvedValue(undefined) }
const context = { setOptions: vi.fn(), getCastState: () => 'CONNECTED', getCurrentSession: () => session,
  addEventListener: (name: string, fn: (event: { sessionState: string }) => void) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn) },
  removeEventListener: (name: string, fn: (event: { sessionState: string }) => void) => listeners.get(name)?.delete(fn), requestSession: vi.fn() }
const controllerStop = vi.fn()
let remoteState = 'PLAYING'
beforeEach(() => {
  vi.clearAllMocks(); listeners.clear(); remoteState = 'PLAYING'
  vi.stubGlobal('cast', { framework: { CastContext: { getInstance: () => context }, RemotePlayer: class { isConnected = true; isMediaLoaded = true; playerState = remoteState }, RemotePlayerController: class { addEventListener() {} removeEventListener() {} stop = controllerStop }, CastContextEventType: { CAST_STATE_CHANGED: 'cast', SESSION_STATE_CHANGED: 'session' }, RemotePlayerEventType: {}, CastState: { NO_DEVICES_AVAILABLE: 'NONE', CONNECTED: 'CONNECTED' }, SessionState: { SESSION_ENDED: 'ENDED', NO_SESSION: 'NONE', SESSION_STARTED: 'STARTED', SESSION_RESUMED: 'RESUMED' } } })
  vi.stubGlobal('chrome', { cast: { media: { MediaInfo: class { constructor(public url: string) {} }, LoadRequest: class { constructor(public media: unknown) {} }, StreamType: { LIVE: 'LIVE', BUFFERED: 'BUFFERED' } } } })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('FE-07 SDK snapshot hydration (mock receiver)', () => {
  it('shows the existing receiver stop action after actual CastButton remount', async () => {
    const props = { channelId: 'a', streamType: 'mpegts' as const, isVisible: true }
    const first = render(createElement(CastButton, props))
    await screen.findByRole('button', { name: /Casting to Fixture receiver.*Click to stop/ })
    first.unmount()
    render(createElement(CastButton, { ...props, channelId: 'b' }))
    fireEvent.click(await screen.findByRole('button', { name: /Casting to Fixture receiver.*Click to stop/ }))
    await screen.findByRole('button', { name: /Connected to Fixture receiver - Click to cast/ })
    expect(context.requestSession).not.toHaveBeenCalled()
  })

  it.each(['PLAYING', 'PAUSED'])('hydrates %s on mount and player remount without events', async (state) => {
    remoteState = state
    const first = renderHook(useChromecast)
    await waitFor(() => expect(first.result.current.isLoading).toBe(false))
    expect(first.result.current).toMatchObject({ isCasting: true, isConnected: true, deviceName: 'Fixture receiver', playerState: state })
    first.unmount()
    const second = renderHook(useChromecast)
    await waitFor(() => expect(second.result.current.isLoading).toBe(false))
    expect(second.result.current).toMatchObject({ isCasting: true, isConnected: true, deviceName: 'Fixture receiver', playerState: state })
    await act(() => second.result.current.stopCasting())
    expect(second.result.current.isCasting).toBe(false)
  })
})

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const backend = (id: string) => ({ session_id: id, needs_transcoding: true, hls_url: '' })
describe('FE-08 operation ownership (mock SDK/API)', () => {
  it('releases A exactly once when replacing it with B', async () => {
    vi.mocked(api.createCastSession).mockResolvedValueOnce(backend('a')).mockResolvedValueOnce(backend('b'))
    const { result } = renderHook(useChromecast)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(() => result.current.startCasting('a', 'mpegts'))
    await act(() => result.current.startCasting('b', 'mpegts'))
    expect(api.stopCastSession).toHaveBeenCalledExactlyOnceWith('a')
    await act(() => result.current.stopCasting())
    expect(vi.mocked(api.stopCastSession).mock.calls).toEqual([['a'], ['b']])
  })
  it.each(['stop', 'disconnect', 'unmount'])('releases creation arriving after %s without loading', async (action) => {
    const creating = deferred<ReturnType<typeof backend>>()
    vi.mocked(api.createCastSession).mockReturnValue(creating.promise)
    const { result, unmount } = renderHook(useChromecast)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    let starting!: Promise<void>
    await act(async () => { starting = result.current.startCasting('late', 'mpegts') })
    if (action === 'stop') await act(() => result.current.stopCasting())
    else if (action === 'unmount') unmount()
    else act(() => listeners.get('session')?.forEach((fn) => fn({ sessionState: 'ENDED' })))
    await act(async () => { creating.resolve(backend('late')); await starting })
    expect(api.stopCastSession).toHaveBeenCalledExactlyOnceWith('late')
    expect(session.loadMedia).not.toHaveBeenCalled()
  })
  it('an obsolete create failure cannot delete the winning session', async () => {
    const creating = deferred<ReturnType<typeof backend>>()
    vi.mocked(api.createCastSession).mockReturnValueOnce(creating.promise).mockResolvedValueOnce(backend('winner'))
    const { result } = renderHook(useChromecast)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    let old!: Promise<void>
    await act(async () => { old = result.current.startCasting('old', 'mpegts') })
    await act(() => result.current.startCasting('winner', 'mpegts'))
    await act(async () => { creating.reject(new Error('old failed')); await old })
    expect(api.stopCastSession).not.toHaveBeenCalled()
    expect(result.current.isCasting).toBe(true)
    await act(() => result.current.stopCasting())
  })
  it('serializes receiver loads so an older late success cannot replace the winning media', async () => {
    const loading = deferred<void>()
    session.loadMedia.mockReturnValueOnce(loading.promise).mockResolvedValueOnce(undefined)
    vi.mocked(api.createCastSession).mockResolvedValueOnce(backend('a')).mockResolvedValueOnce(backend('b'))
    const { result } = renderHook(useChromecast)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    let a!: Promise<void>; let b!: Promise<void>
    await act(async () => { a = result.current.startCasting('a', 'mpegts') })
    await act(async () => { b = result.current.startCasting('b', 'mpegts') })
    expect(session.loadMedia).toHaveBeenCalledTimes(1)
    await act(async () => { loading.resolve(); await Promise.all([a, b]) })
    expect(session.loadMedia).toHaveBeenCalledTimes(2)
    expect(session.loadMedia.mock.calls[1][0].media.url).toContain('/b')
    expect(api.stopCastSession).toHaveBeenCalledExactlyOnceWith('a')
    await act(() => result.current.stopCasting())
  })
  it('releases an out-of-order successful creation without replacing the winner', async () => {
    const creating = deferred<ReturnType<typeof backend>>()
    vi.mocked(api.createCastSession).mockReturnValueOnce(creating.promise).mockResolvedValueOnce(backend('winner'))
    const { result } = renderHook(useChromecast)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    let old!: Promise<void>
    await act(async () => { old = result.current.startCasting('old', 'mpegts') })
    await act(() => result.current.startCasting('winner', 'mpegts'))
    await act(async () => { creating.resolve(backend('late')); await old })
    expect(api.stopCastSession).toHaveBeenCalledExactlyOnceWith('late')
    expect(session.loadMedia).toHaveBeenCalledTimes(1)
    expect(session.loadMedia.mock.calls[0][0].media.url).toContain('/winner')
    await act(() => result.current.stopCasting())
  })
  it('completes Stop even when an issued receiver load succeeds afterward', async () => {
    const loading = deferred<void>()
    session.loadMedia.mockReturnValueOnce(loading.promise)
    const { result } = renderHook(useChromecast)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    let starting!: Promise<void>
    await act(async () => { starting = result.current.startCasting('hls', 'hls', 'https://fixture/live.m3u8') })
    await act(() => result.current.stopCasting())
    expect(controllerStop).toHaveBeenCalledTimes(1)
    await act(async () => { loading.resolve(); await starting })
    expect(controllerStop).toHaveBeenCalledTimes(2)
    expect(result.current.isCasting).toBe(false)
  })
  it('the public diagnostic cast replaces and releases a prior backend session', async () => {
    vi.mocked(api.createCastSession).mockResolvedValueOnce(backend('diagnostic-predecessor'))
    const { result } = renderHook(useChromecast)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(() => result.current.startCasting('a', 'mpegts'))
    await act(() => result.current.castTestStream())
    expect(api.stopCastSession).toHaveBeenCalledExactlyOnceWith('diagnostic-predecessor')
    await act(() => result.current.stopCasting())
  })

})
