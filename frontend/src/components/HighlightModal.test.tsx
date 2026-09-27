import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@/test/utils'
import { HighlightModal } from './HighlightModal'
import * as api from '@/services/api'
import { useAudioStore } from '@/stores/audioStore'
import { useChatStore, type ChatSender } from '@/stores/chatStore'

vi.mock('@/services/api', () => ({
  createHighlightCapture: vi.fn(), highlightCaptureUrl: vi.fn(), fetchHighlightCapture: vi.fn(), createCaptureDownloadUrl: vi.fn(), deleteHighlightCapture: vi.fn(),
  exportHighlight: vi.fn(), uploadHighlight: vi.fn(), getHighlightFeatures: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const preview = new Blob(['original snapshot'], { type: 'video/mp4' })
const prepared = new Blob(['selected frames'], { type: 'video/mp4' })
// Pressed as the capture's last frame was recorded, so the press is at its end.
const capture = { id: 'capture-1', duration: 60, bytes: 17, expiresAt: 0, pressedAt: 1_000, endsAt: 1_000 }
const props = { isOpen: true, onClose: vi.fn(), channelId: 'channel-1' }

/** The Start or End readout, as shown */
function shown(name: 'Start' | 'End') {
  return within(screen.getByRole('group', { name })).getByText(/^\d+\.\ds$/).textContent
}

/** The exact-time field, opening its popover first */
function exactField(name: 'Start' | 'End') {
  if (!screen.queryByLabelText(`${name} (seconds)`)) fireEvent.click(screen.getByRole('button', { name: 'Type exact times' }))
  return screen.getByLabelText(`${name} (seconds)`)
}

function typeTime(name: 'Start' | 'End', value: string) {
  const field = exactField(name)
  fireEvent.change(field, { target: { value } })
  fireEvent.blur(field)
}

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
  vi.mocked(api.createCaptureDownloadUrl).mockResolvedValue('/api/highlight/download/single-use-token')
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
    fireEvent.click(screen.getByRole('button', { name: '10s' }))
    expect(shown('Start')).toBe('50.0s')
    expect(video.currentTime).toBe(50)
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
    expect(shown('Start')).toBe('40.0s')
    expect(shown('End')).toBe('60.0s')
    expect(video.currentTime).toBe(40)
    expect(screen.getByText('Selected: 20.0s')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Full' }))
    expect(shown('Start')).toBe('0.0s')
    fireEvent.click(screen.getByText('Reset'))
    expect(shown('Start')).toBe('40.0s')
    expect(shown('End')).toBe('60.0s')
  })

  it('selects the 20 seconds ending where the user pressed, not the end of the capture', async () => {
    // The capture waited for the segment being written, so it runs 5s past the press.
    vi.mocked(api.createHighlightCapture).mockResolvedValue({ ...capture, pressedAt: 1_000, endsAt: 1_005 })
    render(<HighlightModal {...props} />)
    const video = await ready()
    expect(shown('Start')).toBe('35.0s')
    expect(shown('End')).toBe('55.0s')
    expect(video.currentTime).toBe(35)
    expect(parseFloat(screen.getByText('You pressed').style.left)).toBeCloseTo(55 / 60 * 100)
    fireEvent.click(screen.getByRole('button', { name: '10s' }))
    expect(shown('Start')).toBe('45.0s')
    expect(shown('End')).toBe('55.0s')
    fireEvent.click(screen.getByRole('button', { name: 'Full' }))
    fireEvent.click(screen.getByText('Reset'))
    expect(shown('Start')).toBe('35.0s')
    expect(shown('End')).toBe('55.0s')
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
    fireEvent.click(screen.getByRole('button', { name: '10s' }))
    expect(shown('Start')).toBe('50.0s')
    fireEvent.click(screen.getByRole('button', { name: 'Include the last few seconds' }))
    const video = await ready()
    expect(video).toHaveAttribute('src', '/api/highlight/capture/capture-2?token=t')
    expect(api.deleteHighlightCapture).toHaveBeenCalledExactlyOnceWith('capture-1')
    // The new capture (946-1006) ends 6s after the original press (not the re-capture's own request
    // time), so the press is at 54s. The selection still starts at 986 (40s in) and, since it ran to
    // the old capture's end, now runs on to the press.
    expect(shown('Start')).toBe('40.0s')
    expect(shown('End')).toBe('54.0s')
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
    typeTime('Start', '30')
    typeTime('End', '40')
    expect(shown('Start')).toBe('30.0s')
    expect(shown('End')).toBe('40.0s')
    fireEvent.click(screen.getByRole('button', { name: 'Include the last few seconds' }))
    await ready()
    // The new capture runs 942-1002, so 958-968 is 16-26.
    expect(shown('Start')).toBe('16.0s')
    expect(shown('End')).toBe('26.0s')
  })

  it('clamps a kept selection that falls outside the new capture', async () => {
    vi.mocked(api.createHighlightCapture)
      .mockResolvedValueOnce({ ...capture, pressedAt: 1_000, endsAt: 998 })
      .mockResolvedValueOnce({ ...capture, id: 'capture-2', pressedAt: 1_020, endsAt: 1_020 })
    render(<HighlightModal {...props} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Full' }))
    fireEvent.click(screen.getByRole('button', { name: 'Include the last few seconds' }))
    await ready()
    // The press is now 40s into the capture; 60s before it has left the buffer.
    expect(shown('Start')).toBe('0.0s')
    expect(shown('End')).toBe('40.0s')
  })

  it('ends the default selection at the capture when it stops short of the press, still counting from the press', async () => {
    // The wait for the segment being written timed out, so the capture ends 4s before the press.
    vi.mocked(api.createHighlightCapture).mockResolvedValue({ ...capture, pressedAt: 1_000, endsAt: 996 })
    render(<HighlightModal {...props} />)
    await ready()
    expect(shown('Start')).toBe('40.0s')
    expect(shown('End')).toBe('60.0s')
    expect(screen.getByText('You pressed 4.0 s after the end')).toBeInTheDocument()
    // 20s before the press is 44s into the capture, not 40s.
    expect(parseFloat(screen.getByText('\u221220 s').style.left)).toBeCloseTo(44 / 60 * 100)
    expect(screen.getByRole('slider', { name: 'Playhead' })).toHaveAttribute('aria-valuetext', '40.0 seconds, 24.0 seconds before you pressed')
    fireEvent.click(screen.getByRole('button', { name: '10s' }))
    expect(shown('Start')).toBe('50.0s')
    expect(shown('End')).toBe('60.0s')
  })

  it('plays the selection with Space and marks the start with I while the timeline has focus', async () => {
    render(<HighlightModal {...props} />)
    const video = await ready()
    const playhead = screen.getByRole('slider', { name: 'Playhead' })
    expect(await screen.findByText('Pause preview')).toBeInTheDocument()
    fireEvent.keyDown(playhead, { key: ' ' })
    expect(video.paused).toBe(true)
    fireEvent.keyDown(playhead, { key: ' ' })
    expect(await screen.findByText('Pause preview')).toBeInTheDocument()
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2)
    expect(video.currentTime).toBe(40)
    for (let i = 0; i < 5; i++) fireEvent.keyDown(playhead, { key: 'ArrowRight', shiftKey: true })
    expect(video.currentTime).toBe(45)
    fireEvent.keyDown(playhead, { key: 'i' })
    expect(shown('Start')).toBe('45.0s')
    expect(shown('End')).toBe('60.0s')
    fireEvent.keyDown(playhead, { key: 'ArrowRight', shiftKey: true })
    fireEvent.keyDown(playhead, { key: 'o' })
    expect(shown('End')).toBe('46.0s')
    // Elsewhere in the editor the letters and Space are left to the focused control
    fireEvent.keyDown(screen.getByRole('button', { name: 'Download clip' }), { key: 'i' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Download clip' }), { key: ' ' })
    expect(shown('Start')).toBe('45.0s')
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2)
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('offers 10, 20, 30 seconds and Full as one control, showing which one the selection is', async () => {
    render(<HighlightModal {...props} />)
    await ready()
    const pressed = () => within(screen.getByRole('group', { name: 'Length' })).getAllByRole('button')
      .filter(button => button.getAttribute('aria-pressed') === 'true').map(button => button.textContent)
    expect(within(screen.getByRole('group', { name: 'Length' })).getAllByRole('button').map(button => button.textContent))
      .toEqual(['10s', '20s', '30s', 'Full'])
    // The default is the 20 seconds ending at the press
    expect(pressed()).toEqual(['20s'])
    fireEvent.click(screen.getByRole('button', { name: '30s' }))
    expect(pressed()).toEqual(['30s'])
    expect(shown('Start')).toBe('30.0s')
    expect(shown('End')).toBe('60.0s')
    fireEvent.click(screen.getByRole('button', { name: 'Full' }))
    expect(pressed()).toEqual(['Full'])
    expect(shown('Start')).toBe('0.0s')
    fireEvent.click(screen.getByRole('button', { name: '10s' }))
    expect(pressed()).toEqual(['10s'])
    // A hand edit is no longer one of the lengths
    fireEvent.click(screen.getByRole('button', { name: 'Start back 0.1 seconds' }))
    expect(pressed()).toEqual([])
    fireEvent.click(screen.getByText('Reset'))
    expect(pressed()).toEqual(['20s'])
  })

  it('shows Full, not a length the capture cannot hold, on a short capture', async () => {
    render(<HighlightModal {...props} />)
    await ready(8)
    const group = screen.getByRole('group', { name: 'Length' })
    fireEvent.click(within(group).getByRole('button', { name: '10s' }))
    expect(shown('Start')).toBe('0.0s')
    expect(shown('End')).toBe('8.0s')
    expect(within(group).getByRole('button', { name: '10s' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(group).getByRole('button', { name: 'Full' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('nudges the start and end by a tenth or a whole second and previews the moved boundary', async () => {
    render(<HighlightModal {...props} />)
    const video = await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Start back 1 second' }))
    expect(shown('Start')).toBe('39.0s')
    expect(video.currentTime).toBe(39)
    fireEvent.click(screen.getByRole('button', { name: 'Start forward 0.1 seconds' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start forward 0.1 seconds' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start forward 0.1 seconds' }))
    // Tenths, without floating-point drift
    expect(shown('Start')).toBe('39.3s')
    expect(video.currentTime).toBe(39.3)
    fireEvent.click(screen.getByRole('button', { name: 'End back 0.1 seconds' }))
    expect(shown('End')).toBe('59.9s')
    expect(video.currentTime).toBe(59.9)
    expect(screen.getByText('Selected: 20.6s')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'End forward 1 second' }))
    expect(shown('End')).toBe('60.0s')
  })

  it('stops a nudge at the capture edges and at the other boundary', async () => {
    render(<HighlightModal {...props} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'End forward 0.1 seconds' }))
    expect(shown('End')).toBe('60.0s')
    typeTime('Start', '59.9')
    fireEvent.click(screen.getByRole('button', { name: 'Start forward 1 second' }))
    fireEvent.click(screen.getByRole('button', { name: 'End back 0.1 seconds' }))
    expect(shown('Start')).toBe('59.9s')
    expect(shown('End')).toBe('60.0s')
    typeTime('Start', '0.4')
    fireEvent.click(screen.getByRole('button', { name: 'Start back 1 second' }))
    expect(shown('Start')).toBe('0.0s')
  })

  it('keeps exact entry in a popover that commits on Enter and keeps focus there', async () => {
    render(<HighlightModal {...props} />)
    await ready()
    // The fields only appear on request
    expect(screen.queryByLabelText('Start (seconds)')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Type exact times' }))
    const start = screen.getByLabelText('Start (seconds)')
    expect(start).toHaveValue(40)
    expect(screen.getByLabelText('End (seconds)')).toHaveValue(60)
    start.focus()
    fireEvent.change(start, { target: { value: '42.5' } })
    fireEvent.keyDown(start, { key: 'Enter' })
    expect(shown('Start')).toBe('42.5s')
    expect(start).toHaveFocus()
    expect(screen.getByText('Selected: 17.5s')).toBeInTheDocument()
  })

  it('supports keyboard boundary adjustment, clamped fields, short buffers and reset', async () => {
    render(<HighlightModal {...props} />)
    const video = await ready(8)
    fireEvent.click(screen.getByRole('button', { name: '30s' }))
    expect(shown('Start')).toBe('0.0s')
    const handle = screen.getByRole('slider', { name: 'Start boundary' })
    fireEvent.focus(handle); fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(video.currentTime).toBeCloseTo(0.1)
    typeTime('End', '0')
    expect(shown('End')).toBe('0.2s')
    fireEvent.click(screen.getByText('Reset'))
    expect(shown('End')).toBe('8.0s')
  })

  it('allows typing a new end time without clamping intermediate digits', async () => {
    render(<HighlightModal {...props} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: '10s' }))
    const field = exactField('End')
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '5' } })
    expect(field).toHaveValue(5)
    fireEvent.change(field, { target: { value: '59.3' } })
    fireEvent.blur(field)
    expect(field).toHaveValue(59.3)
    expect(shown('End')).toBe('59.3s')
    expect(screen.getByText('Selected: 9.3s')).toBeInTheDocument()
  })

  it('retains the prepared clip after an upload error for download or manual retry', async () => {
    vi.mocked(api.getHighlightFeatures).mockResolvedValue({ enabled: true, ziplineEnabled: true })
    vi.mocked(api.uploadHighlight).mockRejectedValueOnce(new Error('Zipline quota exceeded'))
    render(<HighlightModal {...props} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: '10s' }))
    fireEvent.click(screen.getByText('Get share link'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Zipline quota exceeded')
    expect(shown('Start')).toBe('50.0s')
    fireEvent.click(screen.getByText('Download clip'))
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled())
    expect(api.exportHighlight).toHaveBeenCalledTimes(1)
    expect(api.uploadHighlight).toHaveBeenCalledTimes(1)
  })

  it('downloads the original untrimmed snapshot straight from a single-use link, without encoding or fetching it', async () => {
    const saved: (string | null)[] = []
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(function (this: HTMLAnchorElement) { saved.push(this.getAttribute('href')) })
    const { unmount } = render(<HighlightModal {...props} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Full' }))
    fireEvent.click(screen.getByText('Download clip'))
    await waitFor(() => expect(saved).toEqual(['/api/highlight/download/single-use-token']))
    expect(api.createCaptureDownloadUrl).toHaveBeenCalledExactlyOnceWith('capture-1', expect.any(AbortSignal))
    expect(api.exportHighlight).not.toHaveBeenCalled()
    expect(api.fetchHighlightCapture).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    // The session token never goes into the download link
    expect(saved[0]).not.toContain('token=')
    await waitFor(() => expect(screen.getByText('Download clip')).toBeEnabled())
    vi.useFakeTimers()
    try { unmount(); act(() => { vi.runAllTimers() }) } finally { vi.useRealTimers() }
  })

  it('hands over the direct download when Download clip is double-clicked', async () => {
    const { unmount } = render(<HighlightModal {...props} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Full' }))
    const download = screen.getByRole('button', { name: 'Download clip' })
    fireEvent.click(download, { detail: 1 }); fireEvent.click(download, { detail: 2 })
    expect(vi.mocked(api.createCaptureDownloadUrl).mock.calls[0][1]!.aborted).toBe(false)
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1))
    expect(api.createCaptureDownloadUrl).toHaveBeenCalledTimes(1)
    // Run the delete deferred for the download now, so it does not land in a later test
    vi.useFakeTimers()
    try { unmount(); act(() => { vi.runAllTimers() }) } finally { vi.useRealTimers() }
  })

  it('deletes the capture only after the browser has had time to start the direct download', async () => {
    let link!: (url: string) => void
    vi.mocked(api.createCaptureDownloadUrl).mockImplementationOnce(() => new Promise(done => { link = done }))
    const { rerender } = render(<HighlightModal {...props} />)
    await ready()
    vi.useFakeTimers()
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Full' }))
      fireEvent.click(screen.getByText('Download clip'))
      await act(async () => { link('/api/highlight/download/single-use-token') })
      expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1)
      // Delivered, so closing does not ask; the delete waits for the download to reach the server
      fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))
      expect(props.onClose).toHaveBeenCalledTimes(1)
      rerender(<HighlightModal {...props} isOpen={false} />)
      expect(api.deleteHighlightCapture).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(4000) })
      expect(api.deleteHighlightCapture).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(1000) })
      expect(api.deleteHighlightCapture).toHaveBeenCalledExactlyOnceWith('capture-1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('discarding while the download link is requested cancels the download and deletes at once', async () => {
    vi.mocked(api.createCaptureDownloadUrl).mockImplementationOnce(() => new Promise(() => {}))
    const { rerender } = render(<HighlightModal {...props} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Full' }))
    fireEvent.click(screen.getByText('Download clip'))
    const signal = vi.mocked(api.createCaptureDownloadUrl).mock.calls[0][1]!
    rerender(<HighlightModal {...props} isOpen={false} />)
    expect(signal.aborted).toBe(true)
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
    expect(api.deleteHighlightCapture).toHaveBeenCalledExactlyOnceWith('capture-1')
  })

  it('still uploads the untrimmed snapshot bytes to Zipline', async () => {
    vi.mocked(api.getHighlightFeatures).mockResolvedValue({ enabled: true, ziplineEnabled: true })
    render(<HighlightModal {...props} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Full' }))
    fireEvent.click(screen.getByText('Get share link'))
    await waitFor(() => expect(api.uploadHighlight).toHaveBeenCalledExactlyOnceWith(preview, 'mp4', expect.any(AbortSignal)))
    expect(api.createCaptureDownloadUrl).not.toHaveBeenCalled()
  })

  it('shares prepared bytes between download and Zipline and displays its returned link', async () => {
    vi.mocked(api.getHighlightFeatures).mockResolvedValue({ enabled: true, ziplineEnabled: true })
    render(<HighlightModal {...props} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: '10s' }))
    fireEvent.click(screen.getByText('Download clip'))
    await waitFor(() => expect(screen.getByText('Download clip')).not.toBeDisabled())
    fireEvent.click(screen.getByText('Get share link'))
    expect(await screen.findByLabelText('Uploaded clip link')).toHaveValue('https://clips.example/clip.mp4')
    expect(api.exportHighlight).toHaveBeenCalledExactlyOnceWith('capture-1', 'mp4', { startTime: 50, endTime: 60 }, expect.any(AbortSignal))
    expect(api.uploadHighlight).toHaveBeenCalledExactlyOnceWith(prepared, 'mp4', expect.any(AbortSignal))
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', 'https://clips.example/clip.mp4')
  })

  it('offers a share link, naming Zipline only in the tooltip, and says when the link is ready', async () => {
    vi.mocked(api.getHighlightFeatures).mockResolvedValue({ enabled: true, ziplineEnabled: true })
    render(<HighlightModal {...props} />)
    await ready()
    const share = await screen.findByRole('button', { name: 'Get share link' })
    expect(screen.queryByText(/Upload to Zipline/)).not.toBeInTheDocument()
    act(() => { share.focus() })
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Uploads to Zipline')
    fireEvent.click(share)
    expect(await screen.findByLabelText('Uploaded clip link')).toHaveValue('https://clips.example/clip.mp4')
    expect(screen.getByRole('button', { name: 'Share link ready' })).toBeDisabled()
    expect(screen.getByText('Share link ready', { selector: 'p' })).toBeInTheDocument()
  })

  it('shows the share tooltip inside the fullscreen container', async () => {
    vi.mocked(api.getHighlightFeatures).mockResolvedValue({ enabled: true, ziplineEnabled: true })
    const player = document.body.appendChild(document.createElement('div'))
    try {
      render(<HighlightModal {...props} container={player} />)
      await ready()
      const share = await screen.findByRole('button', { name: 'Get share link' })
      act(() => { share.focus() })
      expect(player).toContainElement(await screen.findByRole('tooltip'))
    } finally {
      player.remove()
    }
  })

  it('keeps downloads usable and hides upload when Zipline is disabled', async () => {
    render(<HighlightModal {...props} />)
    await ready()
    expect(screen.queryByText('Get share link')).not.toBeInTheDocument()
    expect(screen.getByText('Download clip')).toBeEnabled()
    expect(api.uploadHighlight).not.toHaveBeenCalled()
  })

  it('retains selection on export failure and prevents duplicate conversions', async () => {
    let reject!: (error: Error) => void
    vi.mocked(api.exportHighlight).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    render(<HighlightModal {...props} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: '30s' }))
    const download = screen.getByRole('button', { name: 'Download clip' })
    fireEvent.click(download); fireEvent.click(download)
    // The button becomes Cancel while the export runs, so it cannot start a second one, and the
    // second click that lands on it straight away does not cancel the first
    expect(screen.queryByText('Download clip')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(api.exportHighlight).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.exportHighlight).mock.calls[0][3]!.aborted).toBe(false)
    reject(new Error('Encoder timed out'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Encoder timed out')
    expect(shown('Start')).toBe('30.0s')
    fireEvent.click(screen.getByText('Download clip'))
    await waitFor(() => expect(api.exportHighlight).toHaveBeenCalledTimes(2))
  })

  it('keeps the actions, progress and errors in the footer outside the scrolling body', async () => {
    let reject!: (error: Error) => void
    vi.mocked(api.exportHighlight).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    render(<HighlightModal {...props} />)
    await ready()
    const footer = screen.getByRole('group', { name: 'Export' })
    expect(within(footer).getByLabelText('Format')).toBeInTheDocument()
    fireEvent.click(within(footer).getByRole('button', { name: 'Download clip' }))
    expect(within(footer).getByRole('status')).toHaveTextContent('Preparing your clip…')
    // The body scrolls on its own; the footer is not inside it.
    expect(screen.getByLabelText('Highlight preview').parentElement!.contains(footer)).toBe(false)
    reject(new Error('Encoder timed out'))
    expect(await within(footer).findByRole('alert')).toHaveTextContent('Encoder timed out')
  })

  it('counts the seconds on the busy button and Cancel stops only the export', async () => {
    const exports: AbortSignal[] = []
    vi.mocked(api.exportHighlight).mockImplementation((_id, _format, _trim, signal) => new Promise((_, fail) => {
      exports.push(signal!)
      signal!.addEventListener('abort', () => fail(new DOMException('Aborted', 'AbortError')))
    }))
    render(<HighlightModal {...props} />)
    await ready()
    vi.useFakeTimers()
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Download clip' }))
      const cancel = screen.getByRole('button', { name: 'Cancel' })
      expect(cancel).toHaveTextContent('0s')
      act(() => { vi.advanceTimersByTime(3000) })
      expect(cancel).toHaveTextContent('3s')
      act(() => { vi.advanceTimersByTime(1000) })
      expect(cancel).toHaveTextContent('4s')

      fireEvent.click(cancel)
      expect(exports[0].aborted).toBe(true)
      await act(async () => {})
      // The session and its capture are kept: nothing is deleted and the selection stays
      expect(vi.mocked(api.createHighlightCapture).mock.calls[0][1]!.aborted).toBe(false)
      expect(api.deleteHighlightCapture).not.toHaveBeenCalled()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByText('Preparing your clip…')).not.toBeInTheDocument()
      expect(shown('Start')).toBe('40.0s')
      expect(screen.getByRole('button', { name: 'Download clip' })).toBeEnabled()

      // A new export starts its count again
      fireEvent.click(screen.getByRole('button', { name: 'Download clip' }))
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveTextContent('0s')
      expect(exports).toHaveLength(2)
      expect(exports[1].aborted).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('finishes the export a double-click on Download clip started, however slow the double-click', async () => {
    let finish!: (blob: Blob) => void
    vi.mocked(api.exportHighlight).mockImplementationOnce(() => new Promise(done => { finish = done }))
    render(<HighlightModal {...props} />)
    await ready()
    vi.useFakeTimers()
    try {
      fireEvent.click(screen.getByRole('button', { name: '30s' }))
      const download = screen.getByRole('button', { name: 'Download clip' })
      fireEvent.click(download, { detail: 1 })
      // The second click of the pair lands on the same button, now Cancel, after the guard window
      act(() => { vi.advanceTimersByTime(600) })
      expect(download).toHaveAccessibleName(/^Cancel/)
      fireEvent.click(download, { detail: 2 })
      const signal = vi.mocked(api.exportHighlight).mock.calls[0][3]!
      expect(signal.aborted).toBe(false)
      await act(async () => { finish(prepared) })
      expect(URL.createObjectURL).toHaveBeenCalledExactlyOnceWith(prepared)
      expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1)
      expect(api.exportHighlight).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops a running export when the editor closes', async () => {
    vi.mocked(api.exportHighlight).mockImplementationOnce(() => new Promise(() => {}))
    const { rerender } = render(<HighlightModal {...props} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Download clip' }))
    const signal = vi.mocked(api.exportHighlight).mock.calls[0][3]!
    expect(signal.aborted).toBe(false)
    rerender(<HighlightModal {...props} isOpen={false} />)
    expect(signal.aborted).toBe(true)
  })

  it('restores audio, aborts requests and starts a fresh session after reopening', async () => {
    useAudioStore.setState({ previewHolds: 0 })
    const { rerender } = render(<HighlightModal {...props} />)
    expect(useAudioStore.getState().previewHolds).toBe(1)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: '10s' }))
    const signal = vi.mocked(api.createHighlightCapture).mock.calls[0][1]!
    rerender(<HighlightModal {...props} isOpen={false} />)
    expect(signal.aborted).toBe(true)
    expect(useAudioStore.getState().previewHolds).toBe(0)
    expect(api.deleteHighlightCapture).toHaveBeenCalledExactlyOnceWith('capture-1')
    rerender(<HighlightModal {...props} />)
    expect(useAudioStore.getState().previewHolds).toBe(1)
    await ready()
    expect(shown('Start')).toBe('40.0s')
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
    expect(shown('Start')).toBe('40.0s')
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
    fireEvent.click(screen.getByRole('button', { name: '10s' }))
    fireEvent.click(screen.getByText('Download clip'))
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('Download clip')).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '30s' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))
    expect(screen.getByRole('dialog', { name: 'Discard this clip?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    fireEvent.click(screen.getByRole('button', { name: '10s' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))
    expect(props.onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: 'Discard this clip?' })).not.toBeInTheDocument()
  })

  it('lets Escape in a time field revert the typed value, then close the exact times, never the editor', async () => {
    render(<HighlightModal {...props} />)
    await ready()
    const field = exactField('Start')
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '12.5' } })
    expect(field).toHaveValue(12.5)
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(field).toHaveValue(40)
    expect(field).toBeInTheDocument()
    // With nothing typed, Escape closes the exact times and leaves the editor open.
    fireEvent.keyDown(field, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByLabelText('Start (seconds)')).not.toBeInTheDocument())
    expect(screen.queryByRole('dialog', { name: 'Discard this clip?' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Create clip' })).toBeInTheDocument()
    expect(shown('Start')).toBe('40.0s')
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
    typeTime('Start', '1.3')
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'webm' } })
    fireEvent.click(screen.getByText('Download clip'))
    await waitFor(() => expect(api.exportHighlight).toHaveBeenCalledWith('capture-1', 'webm', { startTime: 1.3, endTime: 60 }, expect.any(AbortSignal)))
  })
})

describe('Post to chat', () => {
  const link = 'https://clips.example/clip.mp4'
  let unregister: () => void = () => {}

  beforeEach(() => {
    vi.stubEnv('VITE_CHAT_ENABLED', 'true')
    vi.mocked(api.getHighlightFeatures).mockResolvedValue({ enabled: true, ziplineEnabled: true })
  })
  afterEach(() => {
    unregister()
    vi.unstubAllEnvs()
  })

  /** Stands in for the chat socket TVView registers, answering each send in turn */
  function registerSender(...results: Awaited<ReturnType<ChatSender>>[]) {
    const sender = vi.fn<ChatSender>(() => Promise.resolve(results.length > 1 ? results.shift()! : results[0] ?? 'acknowledged'))
    unregister = useChatStore.getState().registerSender(sender)
    return sender
  }

  const post = () => screen.findByRole('button', { name: 'Post to chat' })

  it('exports once, uploads once and posts the link with the caption as the primary action', async () => {
    const sender = registerSender('acknowledged')
    render(<HighlightModal {...props} channelName="TSN 5" />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: '10s' }))
    fireEvent.change(screen.getByLabelText('Caption (optional)'), { target: { value: '  What a goal  ' } })
    // Download steps back once there is a club to show the clip to
    expect(screen.getByRole('button', { name: 'Download clip' })).toHaveAttribute('data-variant', 'outline')
    expect(await post()).toHaveAttribute('data-variant', 'default')
    fireEvent.click(await post())
    expect(await screen.findByText('Posted to chat.')).toBeInTheDocument()
    expect(api.exportHighlight).toHaveBeenCalledExactlyOnceWith('capture-1', 'mp4', { startTime: 50, endTime: 60 }, expect.any(AbortSignal))
    expect(api.uploadHighlight).toHaveBeenCalledExactlyOnceWith(prepared, 'mp4', expect.any(AbortSignal))
    expect(sender).toHaveBeenCalledExactlyOnceWith(`Clip from TSN 5 (10s): What a goal ${link}`, expect.any(String))
    expect(screen.getByRole('button', { name: 'Posted to chat' })).toBeDisabled()
    // The link is there to copy as well
    expect(screen.getByLabelText('Uploaded clip link')).toHaveValue(link)
  })

  it('posts without a caption, with the selected length to a tenth', async () => {
    const sender = registerSender('acknowledged')
    render(<HighlightModal {...props} channelName="TSN 5" />)
    await ready()
    typeTime('Start', '50.7')
    fireEvent.click(await post())
    await waitFor(() => expect(sender).toHaveBeenCalledExactlyOnceWith(`Clip from TSN 5 (9.3s) ${link}`, expect.any(String)))
  })

  it('posts the link Get share link already made instead of uploading again', async () => {
    const sender = registerSender('acknowledged')
    render(<HighlightModal {...props} channelName="TSN 5" />)
    await ready()
    fireEvent.click(await screen.findByRole('button', { name: 'Get share link' }))
    expect(await screen.findByLabelText('Uploaded clip link')).toHaveValue(link)
    fireEvent.click(await post())
    expect(await screen.findByText('Posted to chat.')).toBeInTheDocument()
    expect(api.uploadHighlight).toHaveBeenCalledTimes(1)
    expect(api.exportHighlight).toHaveBeenCalledTimes(1)
    expect(sender).toHaveBeenCalledExactlyOnceWith(`Clip from TSN 5 (20s) ${link}`, expect.any(String))
  })

  it('says a post was not sent, keeps the link, and posts it again without another upload', async () => {
    const sender = registerSender('not-sent', 'acknowledged')
    render(<HighlightModal {...props} channelName="TSN 5" />)
    await ready()
    fireEvent.click(await post())
    expect(await screen.findByRole('alert')).toHaveTextContent("Not posted. You're offline or reconnecting.")
    expect(screen.getByLabelText('Uploaded clip link')).toHaveValue(link)
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
    fireEvent.click(await post())
    expect(await screen.findByText('Posted to chat.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(api.exportHighlight).toHaveBeenCalledTimes(1)
    expect(api.uploadHighlight).toHaveBeenCalledTimes(1)
    // The same message under the same id, so the server confirms rather than posts a duplicate
    expect(sender).toHaveBeenCalledTimes(2)
    expect(sender.mock.calls[1]).toEqual(sender.mock.calls[0])
  })

  it('says when chat could not confirm the post', async () => {
    registerSender('unconfirmed')
    render(<HighlightModal {...props} />)
    await ready()
    fireEvent.click(await post())
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't confirm it was posted.")
    expect(screen.getByLabelText('Uploaded clip link')).toHaveValue(link)
    expect(await post()).toBeEnabled()
  })

  it('reports not sent when no chat is there to post to, and keeps the link', async () => {
    render(<HighlightModal {...props} />)
    await ready()
    fireEvent.click(await post())
    expect(await screen.findByRole('alert')).toHaveTextContent('Not posted.')
    expect(screen.getByLabelText('Uploaded clip link')).toHaveValue(link)
  })

  it('leaves the post undone and keeps the selection when the upload fails', async () => {
    const sender = registerSender('acknowledged')
    vi.mocked(api.uploadHighlight).mockRejectedValueOnce(new Error('Zipline quota exceeded'))
    render(<HighlightModal {...props} />)
    await ready()
    fireEvent.click(await post())
    expect(await screen.findByRole('alert')).toHaveTextContent('Zipline quota exceeded')
    expect(sender).not.toHaveBeenCalled()
    expect(shown('Start')).toBe('40.0s')
  })

  it('offers to post again once the selection changes', async () => {
    registerSender('acknowledged')
    render(<HighlightModal {...props} />)
    await ready()
    fireEvent.click(await post())
    expect(await screen.findByRole('button', { name: 'Posted to chat' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '10s' }))
    expect(await post()).toBeEnabled()
    expect(screen.queryByText('Posted to chat.')).not.toBeInTheDocument()
  })

  it('is absent without chat, leaving Download as the primary action', async () => {
    vi.stubEnv('VITE_CHAT_ENABLED', 'false')
    render(<HighlightModal {...props} />)
    await ready()
    expect(await screen.findByRole('button', { name: 'Get share link' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Post to chat' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Caption (optional)')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download clip' })).toHaveAttribute('data-variant', 'default')
  })

  it('is absent without Zipline to host the clip', async () => {
    vi.mocked(api.getHighlightFeatures).mockResolvedValue({ enabled: true, ziplineEnabled: false })
    render(<HighlightModal {...props} />)
    await ready()
    // Let the feature check settle, so the button is not merely still waiting for it
    await act(async () => { await vi.mocked(api.getHighlightFeatures).mock.results[0].value })
    expect(screen.queryByRole('button', { name: 'Post to chat' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Caption (optional)')).not.toBeInTheDocument()
  })
})
