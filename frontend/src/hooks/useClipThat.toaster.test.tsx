import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, renderHook, screen } from '@/test/utils'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import * as api from '@/services/api'
import { useChatStore, type ChatSender } from '@/stores/chatStore'
import { useClipStore } from '@/stores/clipStore'
import { useClipThat } from './useClipThat'

// The toast's buttons as people press them, through the app's real Toaster:
// sonner decides which of them reach the run (useClipThat.test.ts mocks it)

vi.mock('@/services/api', () => ({
  createHighlightCapture: vi.fn(),
  deleteHighlightCapture: vi.fn(),
  exportHighlight: vi.fn(),
  fetchHighlightCapture: vi.fn(),
  getHighlightFeatures: vi.fn(),
  uploadHighlight: vi.fn(),
}))
vi.mock('@/hooks/useChatEnabled', () => ({ useChatEnabled: () => true }))
vi.mock('@/hooks/useTVMode', () => ({ useTVMode: () => false }))

const capture = { id: 'capture-1', duration: 60, bytes: 17, expiresAt: 0, pressedAt: 1_000, endsAt: 1_000 }
const exported = new Blob(['last 20s'], { type: 'video/mp4' })
const sender = vi.fn<ChatSender>()
let unregister = () => {}

// sonner draws each toast update from a zero-delay timeout, and a fake timeout
// set while the clock runs falls due a millisecond later: run it that far too
async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    await vi.advanceTimersByTimeAsync(1)
  })
}

/** Shows the Toaster, presses Clip that, and waits for the countdown */
async function startCountdown(toasterProps: Parameters<typeof Toaster>[0] = {}) {
  render(<Toaster {...toasterProps} />)
  const { result } = renderHook(() => useClipThat({ id: '42', name: 'Sportsnet' }))
  await flush()
  act(() => result.current?.())
  await flush()
  expect(screen.getByText('Posting in 3s')).toBeInTheDocument()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  useClipStore.setState({ session: null, clipping: false })
  vi.mocked(api.getHighlightFeatures).mockResolvedValue({ enabled: true, ziplineEnabled: true })
  vi.mocked(api.createHighlightCapture).mockResolvedValue(capture)
  vi.mocked(api.deleteHighlightCapture).mockResolvedValue()
  vi.mocked(api.exportHighlight).mockResolvedValue(exported)
  vi.mocked(api.uploadHighlight).mockResolvedValue({ url: 'https://clips.example/clip.mp4', name: 'clip.mp4' })
  sender.mockReset().mockResolvedValue('acknowledged')
  unregister = useChatStore.getState().registerSender(sender)
})

afterEach(() => {
  act(() => { toast.dismiss() })
  unregister()
  vi.useRealTimers()
})

describe('useClipThat with the real Toaster', () => {
  it('posts the clip once the countdown runs out', async () => {
    await startCountdown()
    await flush(3000)
    expect(api.uploadHighlight).toHaveBeenCalledTimes(1)
    expect(sender).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Clip posted to chat')).toBeInTheDocument()
  })

  it('Cancel in the countdown closes the toast and uploads and posts nothing', async () => {
    await startCountdown()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await flush(5000)

    expect(api.uploadHighlight).not.toHaveBeenCalled()
    expect(sender).not.toHaveBeenCalled()
    expect(api.deleteHighlightCapture).toHaveBeenCalledExactlyOnceWith('capture-1')
    expect(screen.queryByText(/Posting in/)).not.toBeInTheDocument()
    expect(useClipStore.getState().clipping).toBe(false)
  })

  it('closing the countdown toast with its close button cancels too', async () => {
    await startCountdown({ closeButton: true })

    fireEvent.click(screen.getByRole('button', { name: 'Close toast' }))
    await flush(5000)

    expect(api.uploadHighlight).not.toHaveBeenCalled()
    expect(sender).not.toHaveBeenCalled()
    expect(useClipStore.getState().clipping).toBe(false)
  })
})
