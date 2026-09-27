import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
import { ClipTimeline } from './ClipTimeline'
import { useClipThumbnails } from '@/hooks/useClipThumbnails'

vi.mock('@/hooks/useClipThumbnails', () => ({ useClipThumbnails: vi.fn() }))

const onChange = vi.fn()
const onSeek = vi.fn()

function renderTimeline(overrides: Partial<Parameters<typeof ClipTimeline>[0]> = {}) {
  render(<ClipTimeline url="/clip.mp4" duration={60} start={40} end={60} playhead={12}
    onChange={onChange} onSeek={onSeek} disabled={false} {...overrides} />)
  return screen.getByRole('slider', { name: 'Playhead' })
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  // jsdom has no layout or pointer capture. Give the slider and its strip the same 600px box at x=100,
  // so Radix would move the closest handle if a strip press ever reached it.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    { left: 100, right: 700, width: 600, top: 0, bottom: 80, height: 80, x: 100, y: 0, toJSON: () => ({}) })
  const captured = new Set<number>()
  Object.assign(Element.prototype, {
    setPointerCapture: (id: number) => { captured.add(id) },
    releasePointerCapture: (id: number) => { captured.delete(id) },
    hasPointerCapture: (id: number) => captured.has(id),
  })
  vi.mocked(useClipThumbnails).mockReturnValue({ frames: Array(10).fill(null), loading: false })
})

describe('ClipTimeline', () => {
  it('exposes the playhead as an accessible slider', () => {
    const playhead = renderTimeline()
    expect(playhead).toHaveAttribute('aria-valuemin', '0')
    expect(playhead).toHaveAttribute('aria-valuemax', '60')
    expect(playhead).toHaveAttribute('aria-valuenow', '12')
    expect(playhead).toHaveAttribute('aria-valuetext', '12.0 seconds')
    expect(playhead).toHaveAttribute('tabindex', '0')
    expect(screen.getByText('12.0s')).toBeInTheDocument()
  })

  it('pressing the strip seeks the playhead and never re-trims', () => {
    const playhead = renderTimeline()
    fireEvent.pointerDown(playhead, { clientX: 250, pointerId: 1, button: 0 })
    expect(onSeek).toHaveBeenLastCalledWith(15)
    fireEvent.pointerMove(playhead, { clientX: 400, pointerId: 1 })
    expect(onSeek).toHaveBeenLastCalledWith(30)
    fireEvent.pointerMove(playhead, { clientX: 900, pointerId: 1 })
    expect(onSeek).toHaveBeenLastCalledWith(60)
    fireEvent.pointerUp(playhead, { clientX: 900, pointerId: 1 })
    fireEvent.pointerMove(playhead, { clientX: 250, pointerId: 1 })
    expect(onSeek).toHaveBeenCalledTimes(3)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('moves the playhead from the keyboard without touching the handles', () => {
    const playhead = renderTimeline()
    fireEvent.keyDown(playhead, { key: 'ArrowRight' })
    expect(onSeek).toHaveBeenLastCalledWith(expect.closeTo(12.1, 5))
    fireEvent.keyDown(playhead, { key: 'ArrowLeft', shiftKey: true })
    expect(onSeek).toHaveBeenLastCalledWith(11)
    fireEvent.keyDown(playhead, { key: 'Home' })
    expect(onSeek).toHaveBeenLastCalledWith(0)
    fireEvent.keyDown(playhead, { key: 'End' })
    expect(onSeek).toHaveBeenLastCalledWith(60)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('still trims with the handles', () => {
    renderTimeline()
    const handle = screen.getByRole('slider', { name: 'Start boundary' })
    fireEvent.focus(handle)
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith(expect.closeTo(40.1, 5), 60, expect.closeTo(40.1, 5))
    expect(onSeek).not.toHaveBeenCalled()
  })

  it('ignores presses and keys while an export is running', () => {
    const playhead = renderTimeline({ disabled: true })
    expect(playhead).not.toHaveAttribute('tabindex')
    expect(playhead).toHaveAttribute('aria-disabled', 'true')
    fireEvent.pointerDown(playhead, { clientX: 250, pointerId: 1, button: 0 })
    fireEvent.keyDown(playhead, { key: 'ArrowRight' })
    expect(onSeek).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('draws the playhead line after the handles so it stays visible over them', () => {
    const playhead = renderTimeline()
    const line = playhead.closest('[dir]')!.lastElementChild as HTMLElement
    expect(line.style.left).toBe('20%')
    const handle = screen.getByRole('slider', { name: 'End boundary' })
    expect(handle.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows frames as they arrive and pulses the empty slots while loading', () => {
    vi.mocked(useClipThumbnails).mockReturnValue({ frames: ['data:frame-0', null, ...Array(8).fill(null)], loading: true })
    const { container } = render(<ClipTimeline url="/clip.mp4" duration={60} start={0} end={60} playhead={0}
      onChange={onChange} onSeek={onSeek} disabled={false} />)
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(container.querySelectorAll('.motion-safe\\:animate-pulse')).toHaveLength(9)
  })

  it('stops pulsing once generation has finished', () => {
    const { container } = render(<ClipTimeline url="/clip.mp4" duration={60} start={0} end={60} playhead={0}
      onChange={onChange} onSeek={onSeek} disabled={false} />)
    expect(container.querySelectorAll('.motion-safe\\:animate-pulse')).toHaveLength(0)
  })
})
