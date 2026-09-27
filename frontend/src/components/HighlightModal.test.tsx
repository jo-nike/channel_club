import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@/test/utils'
import { HighlightModal } from './HighlightModal'
import * as api from '@/services/api'
import { useAudioStore } from '@/stores/audioStore'

vi.mock('@/services/api', () => ({
  createHighlightCapture: vi.fn(), highlightCaptureUrl: vi.fn(), fetchHighlightCapture: vi.fn(), deleteHighlightCapture: vi.fn(),
  exportHighlight: vi.fn(), uploadHighlight: vi.fn(), getHighlightFeatures: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const preview = new Blob(['original snapshot'], { type: 'video/mp4' })
const prepared = new Blob(['selected frames'], { type: 'video/mp4' })
// Pressed as the capture's last frame was recorded, so the press is at its end.
const capture = { id: 'capture-1', duration: 60, bytes: 17, expiresAt: 0, pressedAt: 1_000, endsAt: 1_000 }
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

  it('selects the last 20 seconds by default and Reset returns there', async () => {
    render(<HighlightModal {...props} />)
    const video = await ready()
    expect(screen.getByLabelText('Start (seconds)')).toHaveValue(40)
    expect(screen.getByLabelText('End (seconds)')).toHaveValue(60)
    expect(video.currentTime).toBe(40)
    expect(screen.getByText('Selected: 20.0s')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Full clip'))
    expect(screen.getByLabelText('Start (seconds)')).toHaveValue(0)
    fireEvent.click(screen.getByText('Reset'))
    expect(screen.getByLabelText('Start (seconds)')).toHaveValue(40)
    expect(screen.getByLabelText('End (seconds)')).toHaveValue(60)
  })

  it('selects the 20 seconds ending where the user pressed, not the end of the capture', async () => {
    // The capture waited for the segment being written, so it runs 5s past the press.
    vi.mocked(api.createHighlightCapture).mockResolvedValue({ ...capture, pressedAt: 1_000, endsAt: 1_005 })
    render(<HighlightModal {...props} />)
    const video = await ready()
    expect(screen.getByLabelText('Start (seconds)')).toHaveValue(35)
    expect(screen.getByLabelText('End (seconds)')).toHaveValue(55)
    expect(video.currentTime).toBe(35)
    expect(parseFloat(screen.getByText('You pressed').style.left)).toBeCloseTo(55 / 60 * 100)
    fireEvent.click(screen.getByText('Last 10s'))
    expect(screen.getByLabelText('Start (seconds)')).toHaveValue(45)
    expect(screen.getByLabelText('End (seconds)')).toHaveValue(55)
    fireEvent.click(screen.getByText('Full clip'))
    fireEvent.click(screen.getByText('Reset'))
    expect(screen.getByLabelText('Start (seconds)')).toHaveValue(35)
    expect(screen.getByLabelText('End (seconds)')).toHaveValue(55)
  })

  it('plays the default selection once on open and stops at its end', async () => {
    render(<HighlightModal {...props} />)
    const video = await ready()
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
    expect(video.currentTime).toBe(40)
    expect(await screen.findByText('Pause preview')).toBeInTheDocument()
    video.currentTime = 60
    fireEvent.timeUpdate(video)
    expect(video.paused).toBe(true)
    expect(screen.getByText('Play selection')).toBeInTheDocument()
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
  })

  it('stays paused and ready when the browser refuses to play on open', async () => {
    // iOS Safari rejects play() outside a user gesture; the capture resolves long after the press.
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => Promise.reject(new DOMException('Not allowed', 'NotAllowedError')))
    render(<HighlightModal {...props} />)
    const video = await ready()
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Play selection')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(video.currentTime).toBe(40)
    fireEvent.click(screen.getByText('Play selection'))
    expect(await screen.findByText('Pause preview')).toBeInTheDocument()
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2)
  })

  it('re-captures to include the seconds missing before the press and keeps the selection around the press', async () => {
    // The recorder had not closed the last 4s before the press (the wait for it timed out).
    vi.mocked(api.createHighlightCapture)
      .mockResolvedValueOnce({ ...capture, pressedAt: 1_000, endsAt: 996 })
      .mockResolvedValueOnce({ ...capture, id: 'capture-2', pressedAt: 1_030, endsAt: 1_006 })
    render(<HighlightModal {...props} />)
    await ready()
    expect(screen.getByRole('status')).toHaveTextContent('This capture ends 4.0s before you pressed.')
    // The press is 4s past the capture, so the selection ends at the capture's end: 50-60 is 986-996.
    fireEvent.click(screen.getByText('Last 10s'))
    expect(screen.getByLabelText('Start (seconds)')).toHaveValue(50)
    fireEvent.click(screen.getByRole('button', { name: 'Include the last few seconds' }))
    const video = await ready()
    expect(video).toHaveAttribute('src', '/api/highlight/capture/capture-2?token=t')
    expect(api.deleteHighlightCapture).toHaveBeenCalledExactlyOnceWith('capture-1')
    // The new capture (946-1006) ends 6s after the original press (not the re-capture's own request
    // time), so the press is at 54s. The selection still starts at 986 (40s in) and, since it ran to
    // the old capture's end, now runs on to the press.
    expect(screen.getByLabelText('Start (seconds)')).toHaveValue(40)
    expect(screen.getByLabelText('End (seconds)')).toHaveValue(54)
    expect(video.currentTime).toBe(40)
    expect(parseFloat(screen.getByText('You pressed').style.left)).toBeCloseTo(90)
    expect(screen.queryByText(/before you pressed\./)).not.toBeInTheDocument()
    // Played once on open only; the re-capture does not start playback again.
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
  })

  it('keeps a hand-trimmed selection on the same footage after the re-capture', async () => {
    vi.mocked(api.createHighlightCapture)
      .mockResolvedValueOnce({ ...capture, pressedAt: 1_000, endsAt: 988 })
      .mockResolvedValueOnce({ ...capture, id: 'capture-2', pressedAt: 1_030, endsAt: 1_002 })
    render(<HighlightModal {...props} />)
    await ready()
    // The capture runs 928-988; 30-40 is 958-968, 42-32s before the press.
    fireEvent.change(screen.getByLabelText('Start (seconds)'), { target: { value: '30' } })
    fireEvent.blur(screen.getByLabelText('Start (seconds)'))
    fireEvent.change(screen.getByLabelText('End (seconds)'), { target: { value: '40' } })
    fireEvent.blur(screen.getByLabelText('End (seconds)'))
    expect(screen.getByLabelText('Start (seconds)')).toHaveValue(30)
    expect(screen.getByLabelText('End (seconds)')).toHaveValue(40)
    fireEvent.click(screen.getByRole('button', { name: 'Include the last few seconds' }))
    await ready()
    // The new capture runs 942-1002, so 958-968 is 16-26.
    expect(screen.getByLabelText('Start (seconds)')).toHaveValue(16)
    expect(screen.getByLabelText('End (seconds)')).toHaveValue(26)
  })

  it('clamps a kept selection that falls outside the new capture', async () => {
    vi.mocked(api.createHighlightCapture)
      .mockResolvedValueOnce({ ...capture, pressedAt: 1_000, endsAt: 998 })
      .mockResolvedValueOnce({ ...capture, id: 'capture-2', pressedAt: 1_020, endsAt: 1_020 })
    render(<HighlightModal {...props} />)
    await ready()
    fireEvent.click(screen.getByText('Full clip'))
    fireEvent.click(screen.getByRole('button', { name: 'Include the last few seconds' }))
    await ready()
    // The press is now 40s into the capture; 60s before it has left the buffer.
    expect(screen.getByLabelText('Start (seconds)')).toHaveValue(0)
    expect(screen.getByLabelText('End (seconds)')).toHaveValue(40)
  })

  it('ends the default selection at the capture when it stops short of the press, still counting from the press', async () => {
    // The wait for the segment being written timed out, so the capture ends 4s before the press.
    vi.mocked(api.createHighlightCapture).mockResolvedValue({ ...capture, pressedAt: 1_000, endsAt: 996 })
    render(<HighlightModal {...props} />)
    await ready()
    expect(screen.getByLabelText('Start (seconds)')).toHaveValue(40)
    expect(screen.getByLabelText('End (seconds)')).toHaveValue(60)
    expect(screen.getByText('You pressed 4.0 s after the end')).toBeInTheDocument()
    // 20s before the press is 44s into the capture, not 40s.
    expect(parseFloat(screen.getByText('\u221220 s').style.left)).toBeCloseTo(44 / 60 * 100)
    expect(screen.getByRole('slider', { name: 'Playhead' })).toHaveAttribute('aria-valuetext', '40.0 seconds, 24.0 seconds before you pressed')
    fireEvent.click(screen.getByText('Last 10s'))
    expect(screen.getByLabelText('Start (seconds)')).toHaveValue(50)
    expect(screen.getByLabelText('End (seconds)')).toHaveValue(60)
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
    fireEvent.click(screen.getByText('Full clip'))
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
    useAudioStore.setState({ previewHolds: 0 })
    const { rerender } = render(<HighlightModal {...props} />)
    expect(useAudioStore.getState().previewHolds).toBe(1)
    await ready()
    fireEvent.click(screen.getByText('Last 10s'))
    const signal = vi.mocked(api.createHighlightCapture).mock.calls[0][1]!
    rerender(<HighlightModal {...props} isOpen={false} />)
    expect(signal.aborted).toBe(true)
    expect(useAudioStore.getState().previewHolds).toBe(0)
    expect(api.deleteHighlightCapture).toHaveBeenCalledExactlyOnceWith('capture-1')
    rerender(<HighlightModal {...props} />)
    expect(useAudioStore.getState().previewHolds).toBe(1)
    await ready()
    expect(screen.getByLabelText('Start (seconds)')).toHaveValue(40)
  })

  it('says live TV changed and the clip is kept when another channel is playing', async () => {
    const { rerender } = render(<HighlightModal {...props} channelName="Sportsnet" playingChannel={{ id: 'channel-1', name: 'Sportsnet' }} />)
    await ready()
    expect(screen.queryByText(/Live TV changed/)).not.toBeInTheDocument()

    rerender(<HighlightModal {...props} channelName="Sportsnet" playingChannel={{ id: 'channel-2', name: 'Post-game Show' }} />)

    expect(screen.getByRole('status')).toHaveTextContent('Live TV changed to Post-game Show. Your clip from Sportsnet is kept.')
    // The session stays on the capture's channel: nothing is captured again or deleted
    expect(api.createHighlightCapture).toHaveBeenCalledExactlyOnceWith('channel-1', expect.any(AbortSignal))
    expect(api.deleteHighlightCapture).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Start (seconds)')).toHaveValue(40)
  })

  it('drops the notice when the capture channel is playing again', async () => {
    const { rerender } = render(<HighlightModal {...props} channelName="Sportsnet" playingChannel={{ id: 'channel-2', name: 'TSN' }} />)
    expect(screen.getByText(/Live TV changed to TSN/)).toBeInTheDocument()

    rerender(<HighlightModal {...props} channelName="Sportsnet" playingChannel={{ id: 'channel-1', name: 'Sportsnet' }} />)

    expect(screen.queryByText(/Live TV changed/)).not.toBeInTheDocument()
  })

  it('says live TV stopped and the clip is kept when nothing is playing', () => {
    render(<HighlightModal {...props} channelName="Sportsnet" playingChannel={null} />)
    expect(screen.getByText('Live TV stopped. Your clip from Sportsnet is kept.')).toBeInTheDocument()
  })

  it('says nothing about live TV when the player has no channel to report', () => {
    render(<HighlightModal {...props} channelName="Sportsnet" />)
    expect(screen.queryByText(/Live TV/)).not.toBeInTheDocument()
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

  it('offers capture retry on invalid metadata and asks before Escape discards the retried capture', async () => {
    render(<HighlightModal {...props} />)
    await ready(Infinity)
    expect(screen.getByRole('alert')).toHaveTextContent('no usable duration')
    fireEvent.click(screen.getByText('Capture again'))
    await ready()
    expect(api.createHighlightCapture).toHaveBeenCalledTimes(2)
    expect(api.deleteHighlightCapture).toHaveBeenCalledExactlyOnceWith('capture-1')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'Discard this clip?' })).toBeInTheDocument()
    expect(props.onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('closes without asking while the capture is still being made', async () => {
    vi.mocked(api.createHighlightCapture).mockImplementationOnce(() => new Promise(() => {}))
    render(<HighlightModal {...props} />)
    expect(await screen.findByText('Capturing recent footage…')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))
    expect(props.onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: 'Discard this clip?' })).not.toBeInTheDocument()
  })

  it('asks before X discards a ready capture; Keep editing keeps it and Discard closes', async () => {
    render(<HighlightModal {...props} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))
    const confirm = screen.getByRole('dialog', { name: 'Discard this clip?' })
    expect(confirm).toHaveTextContent("Once it leaves the 60-second buffer it can't be captured again.")
    expect(screen.getByRole('button', { name: 'Keep editing' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('dialog', { name: 'Discard this clip?' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Create clip' })).toBeInTheDocument()
    // With focus on <body>, the live player's window shortcuts would take the next key.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close editor' })).toHaveFocus())
    expect(props.onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('opens the confirm on Escape from the dialog body, and Escape there only closes the confirm', async () => {
    render(<HighlightModal {...props} />)
    await ready()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Download clip' }), { key: 'Escape' })
    const confirm = screen.getByRole('dialog', { name: 'Discard this clip?' })
    fireEvent.keyDown(confirm, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Discard this clip?' })).not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: 'Create clip' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close editor' })).toHaveFocus())
    expect(props.onClose).not.toHaveBeenCalled()
    expect(api.deleteHighlightCapture).not.toHaveBeenCalled()
  })

  it('closes directly after the current selection was downloaded, and asks again once it changes', async () => {
    render(<HighlightModal {...props} />)
    await ready()
    fireEvent.click(screen.getByText('Last 10s'))
    fireEvent.click(screen.getByText('Download clip'))
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('Download clip')).toBeEnabled())
    fireEvent.click(screen.getByText('Last 15s'))
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))
    expect(screen.getByRole('dialog', { name: 'Discard this clip?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    fireEvent.click(screen.getByText('Last 10s'))
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))
    expect(props.onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: 'Discard this clip?' })).not.toBeInTheDocument()
  })

  it('lets Escape in a time field revert the typed value without closing or deleting the capture', async () => {
    render(<HighlightModal {...props} />)
    await ready()
    const field = screen.getByLabelText('Start (seconds)')
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '12.5' } })
    expect(field).toHaveValue(12.5)
    fireEvent.keyDown(field, { key: 'Escape' })
    // Without the field guard, Escape would open the confirm, which also keeps onClose uncalled.
    expect(screen.queryByRole('dialog', { name: 'Discard this clip?' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Create clip' })).toBeInTheDocument()
    expect(field).toHaveValue(40)
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
