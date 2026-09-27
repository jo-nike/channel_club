import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { toast } from 'sonner'
import * as api from '@/services/api'
import { useChatStore, type ChatSender } from '@/stores/chatStore'
import { useClipStore } from '@/stores/clipStore'
import { useClipThat, type ClipThatChannel } from './useClipThat'

vi.mock('@/services/api', () => ({
  createHighlightCapture: vi.fn(),
  deleteHighlightCapture: vi.fn(),
  exportHighlight: vi.fn(),
  fetchHighlightCapture: vi.fn(),
  getHighlightFeatures: vi.fn(),
  uploadHighlight: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { loading: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}))
const env = vi.hoisted(() => ({ chat: true, tv: false }))
vi.mock('@/hooks/useChatEnabled', () => ({ useChatEnabled: () => env.chat }))
vi.mock('@/hooks/useTVMode', () => ({ useTVMode: () => env.tv }))

// Pressed as the capture's last frame was recorded, so the press is at its end
const capture = { id: 'capture-1', duration: 60, bytes: 17, expiresAt: 0, pressedAt: 1_000, endsAt: 1_000 }
const exported = new Blob(['last 20s'], { type: 'video/mp4' })
const sportsnet: ClipThatChannel = { id: '42', name: 'Sportsnet' }
const sender = vi.fn<ChatSender>()
let unregister = () => {}

type ToastKind = 'loading' | 'info' | 'success' | 'error'
type ToastOptions = NonNullable<Parameters<typeof toast.info>[1]>

/** The toast as it shows now: the last update, whichever kind it was */
function currentToast() {
  let latest: { kind: ToastKind; message: unknown; options: ToastOptions; order: number } | null = null
  for (const kind of ['loading', 'info', 'success', 'error'] as const) {
    const { calls, invocationCallOrder } = vi.mocked(toast[kind]).mock
    calls.forEach(([message, options], i) => {
      const order = invocationCallOrder[i]
      if (!latest || order > latest.order) latest = { kind, message, options: options ?? {}, order }
    })
  }
  if (!latest) throw new Error('no toast shown')
  return latest as { kind: ToastKind; message: unknown; options: ToastOptions }
}

/** Clicks one of the toast's buttons, as sonner would */
function clickToast(button: 'cancel' | 'action') {
  const target = currentToast().options[button]
  if (!target || typeof target !== 'object' || !('onClick' in target)) throw new Error(`no ${button} button`)
  act(() => (target as { onClick: (event: never) => void }).onClick({} as never))
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** Renders the hook with the features answered, and returns Clip that */
async function clipThatFor(channel: ClipThatChannel | null = sportsnet) {
  const view = renderHook(({ current }) => useClipThat(current), { initialProps: { current: channel } })
  await flush()
  return view
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  env.chat = true
  env.tv = false
  useClipStore.setState({ session: null, clipping: false })
  vi.mocked(api.getHighlightFeatures).mockResolvedValue({ enabled: true, ziplineEnabled: true })
  vi.mocked(api.createHighlightCapture).mockResolvedValue(capture)
  vi.mocked(api.deleteHighlightCapture).mockResolvedValue()
  vi.mocked(api.exportHighlight).mockResolvedValue(exported)
  vi.mocked(api.fetchHighlightCapture).mockResolvedValue(exported)
  vi.mocked(api.uploadHighlight).mockResolvedValue({ url: 'https://clips.example/clip.mp4', name: 'clip.mp4' })
  sender.mockReset().mockResolvedValue('acknowledged')
  unregister = useChatStore.getState().registerSender(sender)
})

afterEach(() => {
  unregister()
  vi.useRealTimers()
})

describe('useClipThat', () => {
  describe('where it is offered', () => {
    it('is offered with clips, Zipline and chat all on', async () => {
      const { result } = await clipThatFor()
      expect(result.current).toBeTypeOf('function')
    })

    it('is not offered without Zipline to host the clip', async () => {
      vi.mocked(api.getHighlightFeatures).mockResolvedValue({ enabled: true, ziplineEnabled: false })
      const { result } = await clipThatFor()
      expect(result.current).toBeUndefined()
    })

    it('is not offered while clips are off', async () => {
      vi.mocked(api.getHighlightFeatures).mockResolvedValue({ enabled: false, ziplineEnabled: true })
      const { result } = await clipThatFor()
      expect(result.current).toBeUndefined()
    })

    it('is not offered without chat to post to, and does not ask the server', async () => {
      env.chat = false
      const { result } = await clipThatFor()
      expect(result.current).toBeUndefined()
      expect(api.getHighlightFeatures).not.toHaveBeenCalled()
    })

    it('is not offered on a TV', async () => {
      env.tv = true
      const { result } = await clipThatFor()
      expect(result.current).toBeUndefined()
    })

    it('is not offered with no channel playing', async () => {
      const { result } = await clipThatFor(null)
      expect(result.current).toBeUndefined()
    })
  })

  it('posts the last 20s to chat after a 3s countdown, then deletes the capture', async () => {
    const { result } = await clipThatFor()
    act(() => result.current?.())
    await flush()

    expect(api.createHighlightCapture).toHaveBeenCalledExactlyOnceWith('42', expect.any(AbortSignal))
    expect(api.exportHighlight).toHaveBeenCalledExactlyOnceWith(
      'capture-1', 'mp4', { startTime: 40, endTime: 60 }, expect.any(AbortSignal),
    )
    expect(currentToast()).toMatchObject({ kind: 'info', message: 'Posting in 3s', options: { description: 'Last 20s of Sportsnet' } })
    expect(useClipStore.getState().clipping).toBe(true)

    await flush(1000)
    expect(currentToast().message).toBe('Posting in 2s')
    await flush(1000)
    expect(currentToast().message).toBe('Posting in 1s')
    expect(api.uploadHighlight).not.toHaveBeenCalled()

    await flush(1000)
    expect(api.uploadHighlight).toHaveBeenCalledExactlyOnceWith(exported, 'mp4', expect.any(AbortSignal))
    expect(sender).toHaveBeenCalledExactlyOnceWith('Clip from Sportsnet (20s) https://clips.example/clip.mp4', expect.any(String))
    expect(currentToast()).toMatchObject({ kind: 'success', message: 'Clip posted to chat', options: { cancel: undefined } })
    // sonner merges updates, so closing it now must not reach the finished run
    expect(currentToast().options).toHaveProperty('onDismiss', undefined)
    expect(api.deleteHighlightCapture).toHaveBeenCalledExactlyOnceWith('capture-1')
    expect(useClipStore.getState().clipping).toBe(false)
  })

  it('ends the clip at the press when the capture runs on past it', async () => {
    // The capture's last frame came 4s after the press
    vi.mocked(api.createHighlightCapture).mockResolvedValue({ ...capture, endsAt: 1_004 })
    const { result } = await clipThatFor()
    act(() => result.current?.())
    await flush()
    expect(api.exportHighlight).toHaveBeenCalledWith('capture-1', 'mp4', { startTime: 36, endTime: 56 }, expect.any(AbortSignal))
  })

  it('sends a capture no longer than the clip as it is, without an export', async () => {
    vi.mocked(api.createHighlightCapture).mockResolvedValue({ ...capture, duration: 12 })
    const { result } = await clipThatFor()
    act(() => result.current?.())
    await flush(3000)
    expect(api.exportHighlight).not.toHaveBeenCalled()
    expect(api.fetchHighlightCapture).toHaveBeenCalledExactlyOnceWith('capture-1', expect.any(AbortSignal))
    expect(sender).toHaveBeenCalledWith('Clip from Sportsnet (12s) https://clips.example/clip.mp4', expect.any(String))
  })

  it('Cancel in the countdown stops the export and uploads nothing', async () => {
    let exportSignal: AbortSignal | undefined
    vi.mocked(api.exportHighlight).mockImplementation((_id, _format, _trim, signal) => {
      exportSignal = signal
      return new Promise(() => {})
    })
    const { result } = await clipThatFor()
    act(() => result.current?.())
    await flush(1000)

    clickToast('cancel')
    await flush(5000)

    expect(exportSignal?.aborted).toBe(true)
    expect(api.uploadHighlight).not.toHaveBeenCalled()
    expect(sender).not.toHaveBeenCalled()
    expect(api.deleteHighlightCapture).toHaveBeenCalledExactlyOnceWith('capture-1')
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(useClipStore.getState().clipping).toBe(false)
  })

  it('Cancel while capturing deletes the capture once it arrives', async () => {
    let arrive: (value: api.HighlightCapture) => void = () => {}
    vi.mocked(api.createHighlightCapture).mockImplementation(() => new Promise((resolve) => { arrive = resolve }))
    const { result } = await clipThatFor()
    act(() => result.current?.())
    await flush()
    expect(currentToast()).toMatchObject({ kind: 'loading', message: 'Capturing the last 20s…' })

    clickToast('cancel')
    arrive(capture)
    await flush(5000)

    expect(api.exportHighlight).not.toHaveBeenCalled()
    expect(api.uploadHighlight).not.toHaveBeenCalled()
    expect(api.deleteHighlightCapture).toHaveBeenCalledExactlyOnceWith('capture-1')
    expect(useClipStore.getState().clipping).toBe(false)
  })

  it('Edit opens the editor on the same capture and posts nothing', async () => {
    let exportSignal: AbortSignal | undefined
    vi.mocked(api.exportHighlight).mockImplementation((_id, _format, _trim, signal) => {
      exportSignal = signal
      return new Promise(() => {})
    })
    const { result } = await clipThatFor()
    act(() => result.current?.())
    await flush(1000)

    clickToast('action')
    await flush(5000)

    expect(useClipStore.getState().session).toEqual({ channelId: '42', channelName: 'Sportsnet', capture })
    expect(api.createHighlightCapture).toHaveBeenCalledTimes(1)
    expect(exportSignal?.aborted).toBe(true)
    expect(api.uploadHighlight).not.toHaveBeenCalled()
    expect(sender).not.toHaveBeenCalled()
    // The editor owns the capture now, and deletes it when it closes
    expect(api.deleteHighlightCapture).not.toHaveBeenCalled()
    expect(useClipStore.getState().clipping).toBe(false)
  })

  it('offers Edit from the moment there is a capture to edit, until the post starts', async () => {
    let arrive: (value: api.HighlightCapture) => void = () => {}
    vi.mocked(api.createHighlightCapture).mockImplementation(() => new Promise((resolve) => { arrive = resolve }))
    let sent: (result: 'acknowledged') => void = () => {}
    sender.mockImplementation(() => new Promise((resolve) => { sent = resolve }))
    const { result } = await clipThatFor()
    act(() => result.current?.())
    await flush()
    expect(currentToast().options.action).toBeUndefined()

    arrive(capture)
    await flush()
    expect(currentToast().options.action).toMatchObject({ label: 'Edit' })

    await flush(3000)
    expect(currentToast()).toMatchObject({ message: 'Posting to chat…', options: { action: undefined, cancel: undefined } })
    expect(currentToast().options).toHaveProperty('onDismiss', undefined)
    sent('acknowledged')
    await flush()
  })

  it('keeps the countdown toast up until it is closed', async () => {
    const { result } = await clipThatFor()
    act(() => result.current?.())
    await flush()
    const { options } = currentToast()
    expect(options).toMatchObject({ duration: Infinity })
    // sonner ignores the Cancel button of a toast that can't be dismissed
    expect(options.dismissible).not.toBe(false)
  })

  it('closing the countdown toast another way, such as a swipe, cancels too', async () => {
    const { result } = await clipThatFor()
    act(() => result.current?.())
    await flush(1000)

    act(() => currentToast().options.onDismiss?.({} as never))
    await flush(5000)

    expect(api.uploadHighlight).not.toHaveBeenCalled()
    expect(sender).not.toHaveBeenCalled()
    expect(api.deleteHighlightCapture).toHaveBeenCalledExactlyOnceWith('capture-1')
    expect(toast.success).not.toHaveBeenCalled()
    expect(useClipStore.getState().clipping).toBe(false)
  })

  it('is blocked while the clip editor is open, which owns the one capture', async () => {
    const { result } = await clipThatFor()
    useClipStore.getState().open('42', 'Sportsnet')
    act(() => result.current?.())
    await flush(5000)
    expect(api.createHighlightCapture).not.toHaveBeenCalled()
    expect(toast.loading).not.toHaveBeenCalled()
  })

  it('a second press while one runs does nothing', async () => {
    const { result } = await clipThatFor()
    act(() => result.current?.())
    await flush()
    act(() => result.current?.())
    await flush(5000)
    expect(api.createHighlightCapture).toHaveBeenCalledTimes(1)
    expect(sender).toHaveBeenCalledTimes(1)
  })

  it('reports a failed export, uploads nothing and deletes the capture', async () => {
    vi.mocked(api.exportHighlight).mockRejectedValue(new Error('Export failed on the server'))
    const { result } = await clipThatFor()
    act(() => result.current?.())
    await flush(3000)
    expect(api.uploadHighlight).not.toHaveBeenCalled()
    expect(currentToast()).toMatchObject({ kind: 'error', message: 'Export failed on the server' })
    expect(api.deleteHighlightCapture).toHaveBeenCalledExactlyOnceWith('capture-1')
    expect(useClipStore.getState().clipping).toBe(false)
  })

  it('keeps the link within reach when chat is not reachable', async () => {
    sender.mockResolvedValue('not-sent')
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { result } = await clipThatFor()
    act(() => result.current?.())
    await flush(3000)
    expect(currentToast()).toMatchObject({
      kind: 'error',
      message: "Clip not posted. You're offline or reconnecting.",
      options: { description: 'https://clips.example/clip.mp4' },
    })
    clickToast('action')
    expect(writeText).toHaveBeenCalledWith('https://clips.example/clip.mp4')
  })
})
