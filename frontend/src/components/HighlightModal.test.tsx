import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@/test/utils'
import { HighlightModal } from './HighlightModal'
import * as api from '@/services/api'

vi.mock('@/services/api', () => ({
  createHighlightCapture: vi.fn(), highlightCaptureUrl: vi.fn(), fetchHighlightCapture: vi.fn(), deleteHighlightCapture: vi.fn(),
  exportHighlight: vi.fn(), uploadHighlight: vi.fn(), getHighlightFeatures: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const preview = new Blob(['original snapshot'], { type: 'video/mp4' })
const prepared = new Blob(['selected frames'], { type: 'video/mp4' })
const capture = { id: 'capture-1', duration: 60, bytes: 17, expiresAt: 0 }
const props = { isOpen: true, onClose: vi.fn(), channelId: 'channel-1' }

async function ready(duration = 60) {
  const video = await screen.findByLabelText('Highlight preview') as HTMLVideoElement
  Object.defineProperty(video, 'duration', { configurable: true, value: duration })
  fireEvent.loadedMetadata(video)
  return video
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.createHighlightCapture).mockResolvedValue(capture)
  vi.mocked(api.highlightCaptureUrl).mockImplementation(id => `/api/highlight/capture/${id}?token=t`)
  vi.mocked(api.fetchHighlightCapture).mockResolvedValue(preview)
  vi.mocked(api.deleteHighlightCapture).mockResolvedValue()
  vi.mocked(api.exportHighlight).mockResolvedValue(prepared)
  vi.mocked(api.getHighlightFeatures).mockResolvedValue({ enabled: true, ziplineEnabled: false })
  vi.mocked(api.uploadHighlight).mockResolvedValue({ url: 'https://clips.example/clip.mp4', name: 'clip.mp4' })
  URL.createObjectURL = vi.fn(() => 'blob:clip')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLVideoElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: true })
    this.dispatchEvent(new Event('pause'))
  })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLVideoElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: false })
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  })
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

describe('Clip editor', () => {
  it('captures once, selects recent footage and previews only the selection', async () => {
    render(<HighlightModal {...props} />)
    const video = await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Last 15s' }))
    expect(screen.getByLabelText('Start (seconds)')).toHaveValue(45)
    expect(video.currentTime).toBe(45)
    fireEvent.click(screen.getByRole('button', { name: 'Play selection' }))
    await waitFor(() => expect(screen.getByText('Pause preview')).toBeInTheDocument())
    video.currentTime = 60
    fireEvent.timeUpdate(video)
    expect(video.paused).toBe(true)
    expect(api.createHighlightCapture).toHaveBeenCalledTimes(1)
    expect(video).toHaveAttribute('src', '/api/highlight/capture/capture-1?token=t')
  })

  it('supports keyboard boundary adjustment, clamped fields, short buffers and reset', async () => {
    render(<HighlightModal {...props} />)
    const video = await ready(8)
    fireEvent.click(screen.getByText('Last 30s'))
    expect(screen.getByLabelText('Start (seconds)')).toHaveValue(0)
    const handle = screen.getByRole('slider', { name: 'Start boundary' })
    fireEvent.focus(handle); fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(video.currentTime).toBeCloseTo(0.1)
    fireEvent.change(screen.getByLabelText('End (seconds)'), { target: { value: '0' } })
    fireEvent.blur(screen.getByLabelText('End (seconds)'))
    expect(screen.getByLabelText('End (seconds)')).toHaveValue(0.2)
    fireEvent.click(screen.getByText('Reset'))
    expect(screen.getByLabelText('End (seconds)')).toHaveValue(8)
  })

  it('allows typing a new end time without clamping intermediate digits', async () => {
    render(<HighlightModal {...props} />)
    await ready()
    fireEvent.click(screen.getByText('Last 10s'))
    const field = screen.getByLabelText('End (seconds)')
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '5' } })
    expect(field).toHaveValue(5)
    fireEvent.change(field, { target: { value: '59.3' } })
    fireEvent.blur(field)
    expect(field).toHaveValue(59.3)
    expect(screen.getByText('Selected: 9.3s')).toBeInTheDocument()
  })

  it('retains the prepared clip after an upload error for download or manual retry', async () => {
    vi.mocked(api.getHighlightFeatures).mockResolvedValue({ enabled: true, ziplineEnabled: true })
    vi.mocked(api.uploadHighlight).mockRejectedValueOnce(new Error('Zipline quota exceeded'))
    render(<HighlightModal {...props} />)
    await ready()
    fireEvent.click(screen.getByText('Last 10s'))
    fireEvent.click(screen.getByText('Upload to Zipline'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Zipline quota exceeded')
    expect(screen.getByLabelText('Start (seconds)')).toHaveValue(50)
    fireEvent.click(screen.getByText('Download clip'))
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled())
    expect(api.exportHighlight).toHaveBeenCalledTimes(1)
    expect(api.uploadHighlight).toHaveBeenCalledTimes(1)
  })

  it('downloads the original untrimmed snapshot without encoding', async () => {
    render(<HighlightModal {...props} />)
    await ready()
    fireEvent.click(screen.getByText('Download clip'))
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled())
    expect(api.exportHighlight).not.toHaveBeenCalled()
    expect(api.fetchHighlightCapture).toHaveBeenCalledExactlyOnceWith('capture-1', expect.any(AbortSignal))
    expect(URL.createObjectURL).toHaveBeenCalledWith(preview)
  })

  it('shares prepared bytes between download and Zipline and displays its returned link', async () => {
    vi.mocked(api.getHighlightFeatures).mockResolvedValue({ enabled: true, ziplineEnabled: true })
    render(<HighlightModal {...props} />)
    await ready()
    fireEvent.click(screen.getByText('Last 10s'))
    fireEvent.click(screen.getByText('Download clip'))
    await waitFor(() => expect(screen.getByText('Download clip')).not.toBeDisabled())
    fireEvent.click(screen.getByText('Upload to Zipline'))
    expect(await screen.findByLabelText('Uploaded clip link')).toHaveValue('https://clips.example/clip.mp4')
    expect(api.exportHighlight).toHaveBeenCalledExactlyOnceWith('capture-1', 'mp4', { startTime: 50, endTime: 60 }, expect.any(AbortSignal))
    expect(api.uploadHighlight).toHaveBeenCalledExactlyOnceWith(prepared, 'mp4', expect.any(AbortSignal))
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', 'https://clips.example/clip.mp4')
  })

  it('keeps downloads usable and hides upload when Zipline is disabled', async () => {
    render(<HighlightModal {...props} />)
    await ready()
    expect(screen.queryByText('Upload to Zipline')).not.toBeInTheDocument()
    expect(screen.getByText('Download clip')).toBeEnabled()
    expect(api.uploadHighlight).not.toHaveBeenCalled()
  })

  it('retains selection on export failure and prevents duplicate conversions', async () => {
    let reject!: (error: Error) => void
    vi.mocked(api.exportHighlight).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    render(<HighlightModal {...props} />)
    await ready()
    fireEvent.click(screen.getByText('Last 15s'))
    fireEvent.click(screen.getByText('Download clip')); fireEvent.click(screen.getByText('Download clip'))
    expect(api.exportHighlight).toHaveBeenCalledTimes(1)
    reject(new Error('Encoder timed out'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Encoder timed out')
    expect(screen.getByLabelText('Start (seconds)')).toHaveValue(45)
    fireEvent.click(screen.getByText('Download clip'))
    await waitFor(() => expect(api.exportHighlight).toHaveBeenCalledTimes(2))
  })

  it('restores audio, aborts requests and starts a fresh session after reopening', async () => {
    const restore = vi.fn()
    const acquirePreviewAudio = vi.fn(() => restore)
    const { rerender } = render(<HighlightModal {...props} acquirePreviewAudio={acquirePreviewAudio} />)
    await ready()
    fireEvent.click(screen.getByText('Last 10s'))
    const signal = vi.mocked(api.createHighlightCapture).mock.calls[0][1]!
    rerender(<HighlightModal {...props} isOpen={false} acquirePreviewAudio={acquirePreviewAudio} />)
    expect(signal.aborted).toBe(true)
    expect(restore).toHaveBeenCalledTimes(1)
    expect(api.deleteHighlightCapture).toHaveBeenCalledExactlyOnceWith('capture-1')
    rerender(<HighlightModal {...props} acquirePreviewAudio={acquirePreviewAudio} />)
    await ready()
    expect(screen.getByLabelText('Start (seconds)')).toHaveValue(0)
  })

  it('ignores a late capture response after switching channels', async () => {
    let resolve!: (capture: api.HighlightCapture) => void
    vi.mocked(api.createHighlightCapture).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const { rerender } = render(<HighlightModal {...props} />)
    rerender(<HighlightModal {...props} channelId="channel-2" />)
    const video = await ready()
    resolve({ ...capture, id: 'stale-capture' })
    await waitFor(() => expect(api.deleteHighlightCapture).toHaveBeenCalledExactlyOnceWith('stale-capture'))
    expect(video).toHaveAttribute('src', '/api/highlight/capture/capture-1?token=t')
  })

  it('offers capture retry on invalid metadata and closes on Escape', async () => {
    render(<HighlightModal {...props} />)
    await ready(Infinity)
    expect(screen.getByRole('alert')).toHaveTextContent('no usable duration')
    fireEvent.click(screen.getByText('Capture again'))
    await ready()
    expect(api.createHighlightCapture).toHaveBeenCalledTimes(2)
    expect(api.deleteHighlightCapture).toHaveBeenCalledExactlyOnceWith('capture-1')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalled()
  })

  it('lets Escape in a time field revert the typed value without closing or deleting the capture', async () => {
    render(<HighlightModal {...props} />)
    await ready()
    const field = screen.getByLabelText('Start (seconds)')
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '12.5' } })
    expect(field).toHaveValue(12.5)
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(field).toHaveValue(0)
    expect(props.onClose).not.toHaveBeenCalled()
    expect(api.deleteHighlightCapture).not.toHaveBeenCalled()
  })

  it('ignores a pointer press on the overlay once the capture is ready', async () => {
    render(<HighlightModal {...props} />)
    await ready()
    const overlay = document.querySelector('[data-slot="dialog-overlay"]')!
    // Radix registers its outside-press listener on the next tick.
    await new Promise(resolve => setTimeout(resolve, 0))
    fireEvent.pointerDown(overlay)
    fireEvent.click(overlay)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(props.onClose).not.toHaveBeenCalled()
    expect(api.deleteHighlightCapture).not.toHaveBeenCalled()
  })

  it('converts WebM with the same fractional selection', async () => {
    render(<HighlightModal {...props} />)
    await ready()
    fireEvent.change(screen.getByLabelText('Start (seconds)'), { target: { value: '1.3' } })
    fireEvent.blur(screen.getByLabelText('Start (seconds)'))
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'webm' } })
    fireEvent.click(screen.getByText('Download clip'))
    await waitFor(() => expect(api.exportHighlight).toHaveBeenCalledWith('capture-1', 'webm', { startTime: 1.3, endTime: 60 }, expect.any(AbortSignal)))
  })
})
