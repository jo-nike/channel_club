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
  return (
    <div className="space-y-3">
      <div className="relative px-3 pt-6">
        <Slider.Root value={[start, end]} min={0} max={duration} step={0.1} minStepsBetweenThumbs={1}
          disabled={disabled} onValueChange={([nextStart, nextEnd]) => onChange(nextStart, nextEnd, nextStart !== start ? nextStart : nextEnd)}
          className="relative flex h-20 w-full touch-none select-none items-center">
          <Slider.Track className="relative h-20 grow overflow-hidden rounded-md bg-muted">
            <div className="absolute inset-0 flex" aria-hidden="true">
              {frames.map((src, i) => src ? <img key={i} src={src} alt="" className="h-full min-w-0 flex-1 object-cover opacity-60" />
                : <div key={i} className={`h-full min-w-0 flex-1 bg-muted${loading ? ' motion-safe:animate-pulse' : ''}`} />)}
            </div>
            <Slider.Range className="absolute h-full border-y-4 border-primary bg-primary/15" />
            <div className="absolute inset-y-0 left-0 bg-black/60" style={{ width: `${start / duration * 100}%` }} />
            <div className="absolute inset-y-0 right-0 bg-black/60" style={{ width: `${(duration - end) / duration * 100}%` }} />
            <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${playhead / duration * 100}%` }} />
          </Slider.Track>
          {['Start', 'End'].map(label => <Slider.Thumb key={label} aria-label={`${label} boundary`}
            className="relative flex h-24 w-6 cursor-ew-resize items-center justify-center rounded-md border-2 border-primary bg-primary text-primary-foreground shadow focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
            <span aria-hidden="true">Ⅱ</span><span className="absolute -top-6 text-xs font-semibold text-foreground">{label}</span>
          </Slider.Thumb>)}
        </Slider.Root>
      </div>
      <label className="flex items-center gap-3 text-sm text-muted-foreground">
        Playhead
        <input aria-label="Playhead" type="range" min={0} max={duration} step={0.1} value={playhead}
          disabled={disabled} onChange={e => onSeek(Number(e.target.value))} className="h-8 min-w-0 flex-1 accent-primary" />
        <span className="w-14 tabular-nums">{playhead.toFixed(1)}s</span>
      </label>
    </div>
  )
}
