import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import * as Slider from '@radix-ui/react-slider'
import { useClipThumbnails } from '@/hooks/useClipThumbnails'

interface Props {
  url: string
  duration: number
  start: number
  end: number
  playhead: number
  onChange: (start: number, end: number, boundary: number) => void
  onSeek: (time: number) => void
  disabled: boolean
}

export function ClipTimeline({ url, duration, start, end, playhead, onChange, onSeek, disabled }: Props) {
  const { frames, loading } = useClipThumbnails(url, duration)
  const track = useRef<HTMLSpanElement>(null)
  const dragging = useRef(false)

  function seekTo(clientX: number) {
    const rect = track.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    onSeek(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration)
  }

  // Presses on the strip belong to the playhead: stopping them keeps Radix from moving the closest handle.
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation()
    if (disabled || event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragging.current = true
    seekTo(event.clientX)
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation()
    if (dragging.current) seekTo(event.clientX)
  }

  function pointerEnd(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation()
    dragging.current = false
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 1 : 0.1
    const target = {
      ArrowLeft: playhead - step, ArrowDown: playhead - step, PageDown: playhead - 1,
      ArrowRight: playhead + step, ArrowUp: playhead + step, PageUp: playhead + 1,
      Home: 0, End: duration,
    }[event.key]
    if (target === undefined) return
    // The slider root would otherwise step the last focused handle.
    event.preventDefault(); event.stopPropagation()
    if (!disabled) onSeek(Math.max(0, Math.min(duration, target)))
  }

  return (
    <div className="space-y-3">
      <div className="relative px-3 pt-6">
        <Slider.Root value={[start, end]} min={0} max={duration} step={0.1} minStepsBetweenThumbs={1}
          disabled={disabled} onValueChange={([nextStart, nextEnd]) => onChange(nextStart, nextEnd, nextStart !== start ? nextStart : nextEnd)}
          className="relative flex h-20 w-full touch-none select-none items-center">
          <Slider.Track ref={track} className="relative h-20 grow overflow-hidden rounded-md bg-muted">
            <div className="absolute inset-0 flex" aria-hidden="true">
              {frames.map((src, i) => src ? <img key={i} src={src} alt="" className="h-full min-w-0 flex-1 object-cover opacity-60" />
                : <div key={i} className={`h-full min-w-0 flex-1 bg-muted${loading ? ' motion-safe:animate-pulse' : ''}`} />)}
            </div>
            <Slider.Range className="absolute h-full border-y-4 border-primary bg-primary/15" />
            <div className="absolute inset-y-0 left-0 bg-black/60" style={{ width: `${start / duration * 100}%` }} />
            <div className="absolute inset-y-0 right-0 bg-black/60" style={{ width: `${(duration - end) / duration * 100}%` }} />
            {/* No z-index: the handles come later in the DOM, so they paint above and stay draggable. */}
            <div role="slider" aria-label="Playhead" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={playhead}
              aria-valuetext={`${playhead.toFixed(1)} seconds`} aria-disabled={disabled || undefined} tabIndex={disabled ? undefined : 0}
              onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onKeyDown={keyDown}
              className="absolute inset-0 cursor-pointer rounded-md focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring" />
          </Slider.Track>
          {['Start', 'End'].map(label => <Slider.Thumb key={label} aria-label={`${label} boundary`}
            className="relative flex h-24 w-6 cursor-ew-resize items-center justify-center rounded-md border-2 border-primary bg-primary text-primary-foreground shadow focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
            <span aria-hidden="true">Ⅱ</span><span className="absolute -top-6 text-xs font-semibold text-foreground">{label}</span>
          </Slider.Thumb>)}
          {/* After the handles so the line stays visible over the Start handle at 0s. */}
          <div aria-hidden="true" className="pointer-events-none absolute -inset-y-1.5 w-0.5 -translate-x-1/2 bg-white shadow" style={{ left: `${playhead / duration * 100}%` }}>
            <span className="absolute -top-1 left-1/2 size-3 -translate-x-1/2 rounded-full bg-white shadow" />
          </div>
        </Slider.Root>
      </div>
      <p className="flex items-center gap-3 text-sm text-muted-foreground">
        Playhead <span className="w-14 tabular-nums">{playhead.toFixed(1)}s</span>
      </p>
    </div>
  )
}
