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
let remoteState = 'PLAYING'
beforeEach(() => {
  vi.clearAllMocks(); listeners.clear(); remoteState = 'PLAYING'
  vi.stubGlobal('cast', { framework: { CastContext: { getInstance: () => context }, RemotePlayer: class { isConnected = true; isMediaLoaded = true; playerState = remoteState }, RemotePlayerController: class { addEventListener() {} removeEventListener() {} stop() {} }, CastContextEventType: { CAST_STATE_CHANGED: 'cast', SESSION_STATE_CHANGED: 'session' }, RemotePlayerEventType: {}, CastState: { NO_DEVICES_AVAILABLE: 'NONE', CONNECTED: 'CONNECTED' }, SessionState: { SESSION_ENDED: 'ENDED', NO_SESSION: 'NONE', SESSION_STARTED: 'STARTED', SESSION_RESUMED: 'RESUMED' } } })
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
