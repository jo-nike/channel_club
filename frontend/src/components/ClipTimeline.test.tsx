import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@/test/utils'
import { ClipTimeline } from './ClipTimeline'
import { useClipThumbnails } from '@/hooks/useClipThumbnails'

vi.mock('@/hooks/useClipThumbnails', () => ({ useClipThumbnails: vi.fn() }))

const onChange = vi.fn()
const onSeek = vi.fn()
const onPlaySelection = vi.fn()

function renderTimeline(overrides: Partial<Parameters<typeof ClipTimeline>[0]> = {}) {
  render(<ClipTimeline url="/clip.mp4" duration={60} start={30} end={50} playhead={12} press={50}
    onChange={onChange} onSeek={onSeek} onPlaySelection={onPlaySelection} disabled={false} {...overrides} />)
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
    expect(playhead).toHaveAttribute('aria-valuetext', '12.0 seconds, 38.0 seconds before you pressed')
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
    expect(onChange).toHaveBeenCalledWith(expect.closeTo(30.1, 5), 50, expect.closeTo(30.1, 5))
    expect(onSeek).not.toHaveBeenCalled()
  })

  it('ignores presses and keys while an export is running', () => {
    const playhead = renderTimeline({ disabled: true })
    expect(playhead).not.toHaveAttribute('tabindex')
    expect(playhead).toHaveAttribute('aria-disabled', 'true')
    fireEvent.pointerDown(playhead, { clientX: 250, pointerId: 1, button: 0 })
    fireEvent.keyDown(playhead, { key: 'ArrowRight' })
    fireEvent.keyDown(playhead, { key: 'i' })
    fireEvent.keyDown(playhead, { key: ' ' })
    expect(onSeek).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect(onPlaySelection).not.toHaveBeenCalled()
  })

  it('sets the start with I and the end with O at the playhead, from the playhead or a handle', () => {
    const playhead = renderTimeline({ playhead: 45 })
    fireEvent.keyDown(playhead, { key: 'i' })
    expect(onChange).toHaveBeenLastCalledWith(45, 50, 45)
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Start boundary' }), { key: 'O' })
    expect(onChange).toHaveBeenLastCalledWith(30, 45, 45)
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onSeek).not.toHaveBeenCalled()
  })

  it('pushes the other end along rather than inverting the selection', () => {
    const playhead = renderTimeline({ playhead: 55 })
    fireEvent.keyDown(playhead, { key: 'i' })
    expect(onChange).toHaveBeenLastCalledWith(55, expect.closeTo(55.1, 5), 55)
    cleanup()
    fireEvent.keyDown(renderTimeline({ playhead: 12 }), { key: 'o' })
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(11.9, 5), 12, 12)
  })

  it('plays the selection with Space on the timeline, once per press', () => {
    const playhead = renderTimeline()
    // Handled, so the page does not scroll
    expect(fireEvent.keyDown(playhead, { key: ' ' })).toBe(false)
    fireEvent.keyDown(playhead, { key: ' ', repeat: true })
    expect(onPlaySelection).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByRole('slider', { name: 'End boundary' }), { key: ' ' })
    expect(onPlaySelection).toHaveBeenCalledTimes(2)
    expect(onChange).not.toHaveBeenCalled()
    expect(onSeek).not.toHaveBeenCalled()
  })

  it('leaves I, O and Space alone outside the timeline and with a modifier held', () => {
    render(<>
      <button type="button">Download clip</button>
      <ClipTimeline url="/clip.mp4" duration={60} start={30} end={50} playhead={45} press={50}
        onChange={onChange} onSeek={onSeek} onPlaySelection={onPlaySelection} disabled={false} />
    </>)
    const button = screen.getByRole('button', { name: 'Download clip' })
    for (const key of ['i', 'o', ' ']) expect(fireEvent.keyDown(button, { key })).toBe(true)
    fireEvent.keyDown(document.body, { key: 'i' })
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Playhead' }), { key: 'i', ctrlKey: true })
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Playhead' }), { key: 'o', metaKey: true })
    expect(onChange).not.toHaveBeenCalled()
    expect(onPlaySelection).not.toHaveBeenCalled()
  })

  it('draws the playhead line after the handles so it stays visible over them', () => {
    const playhead = renderTimeline()
    const line = playhead.closest('[dir]')!.lastElementChild as HTMLElement
    expect(line.style.left).toBe('20%')
    const handle = screen.getByRole('slider', { name: 'End boundary' })
    expect(handle.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('widens the handles to a 44px touch target without changing how they look', () => {
    renderTimeline()
    for (const name of ['Start boundary', 'End boundary']) {
      expect(screen.getByRole('slider', { name })).toHaveClass('w-6', 'pointer-coarse:before:absolute', 'pointer-coarse:before:-inset-x-2.5')
    }
  })

  it('shows frames as they arrive and pulses the empty slots while loading', () => {
    vi.mocked(useClipThumbnails).mockReturnValue({ frames: ['data:frame-0', null, ...Array(8).fill(null)], loading: true })
    const { container } = render(<ClipTimeline url="/clip.mp4" duration={60} start={0} end={60} playhead={0} press={60}
      onChange={onChange} onSeek={onSeek} onPlaySelection={onPlaySelection} disabled={false} />)
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(container.querySelectorAll('.motion-safe\\:animate-pulse')).toHaveLength(9)
  })

  it('stops pulsing once generation has finished', () => {
    const { container } = render(<ClipTimeline url="/clip.mp4" duration={60} start={0} end={60} playhead={0} press={60}
      onChange={onChange} onSeek={onSeek} onPlaySelection={onPlaySelection} disabled={false} />)
    expect(container.querySelectorAll('.motion-safe\\:animate-pulse')).toHaveLength(0)
  })

  it('marks where the user pressed and counts the ruler from there', () => {
    renderTimeline()
    const percent = (element: HTMLElement) => parseFloat(element.style.left)
    expect(percent(screen.getByTestId('press-marker'))).toBeCloseTo(50 / 60 * 100)
    expect(percent(screen.getByText('You pressed'))).toBeCloseTo(50 / 60 * 100)
    // 30s before the press is 20s into the capture; the capture ends 10s after it.
    expect(percent(screen.getByText('\u221230 s'))).toBeCloseTo(20 / 60 * 100)
    expect(percent(screen.getByText('\u221250 s'))).toBe(0)
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument()
  })

  it('labels time after the press with a plus and says where the playhead is', () => {
    renderTimeline({ duration: 60, press: 20, playhead: 20 })
    expect(screen.getByText('+30 s')).toBeInTheDocument()
    expect(screen.getByText('\u221220 s')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Playhead' })).toHaveAttribute('aria-valuetext', '20.0 seconds, where you pressed')
  })

  it('counts from the real press when the capture stops short of it', () => {
    // The capture ends 4s before the press.
    renderTimeline({ press: 64, playhead: 60 })
    const percent = (element: HTMLElement) => parseFloat(element.style.left)
    expect(screen.queryByTestId('press-marker')).not.toBeInTheDocument()
    expect(percent(screen.getByText('You pressed 4.0 s after the end'))).toBe(100)
    expect(percent(screen.getByText('\u221220 s'))).toBeCloseTo(44 / 60 * 100)
    expect(percent(screen.getByText('\u221260 s'))).toBeCloseTo(4 / 60 * 100)
    // −10 s would crowd the label at the end.
    expect(screen.queryByText('\u221210 s')).not.toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Playhead' })).toHaveAttribute('aria-valuetext', '60.0 seconds, 4.0 seconds before you pressed')
  })
})
