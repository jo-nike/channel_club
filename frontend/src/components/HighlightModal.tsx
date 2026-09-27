import { useState, useEffect, useRef, useCallback } from 'react'
import { Download, Upload, Play, Pause, RotateCcw, Loader2, Copy, ExternalLink, X } from 'lucide-react'
import { toast } from 'sonner'
import { createHighlightCapture, highlightCaptureUrl, fetchHighlightCapture, deleteHighlightCapture, exportHighlight, uploadHighlight, getHighlightFeatures, type HighlightFormat, type UploadedHighlight } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ClipTimeline } from './ClipTimeline'
import { ClipTimeField } from './ClipTimeField'

export interface HighlightModalProps {
  isOpen: boolean
  onClose: () => void
  channelId: string
  /** Acquire temporary audio suppression; returned cleanup restores it. */
  acquirePreviewAudio?: () => () => void
  container?: HTMLElement | null
}

/** Mounting a fresh session prevents stale frames, selections, and requests leaking across captures. */
export function HighlightModal({ isOpen, ...props }: HighlightModalProps) {
  return isOpen ? <ClipSession key={props.channelId} {...props} /> : null
}

function ClipSession({ channelId, onClose, acquirePreviewAudio, container }: Omit<HighlightModalProps, 'isOpen'>) {
  const [source, setSource] = useState<{ id: string; url: string } | null>(null)
  const [duration, setDuration] = useState(0)
  const [range, setRange] = useState<[number, number]>([0, 0])
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [format, setFormat] = useState<HighlightFormat>('mp4')
  const [stage, setStage] = useState<'preparing' | 'uploading' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [uploaded, setUploaded] = useState<UploadedHighlight | null>(null)
  const [zipline, setZipline] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const video = useRef<HTMLVideoElement>(null)
  const uploadResult = useRef<HTMLDivElement>(null)
  const controller = useRef<AbortController | null>(null)
  const busy = useRef(false)
  const cache = useRef<{ key: string; blob: Blob } | null>(null)
  const [acquireAudio] = useState(() => acquirePreviewAudio)
  const [start, end] = range
  const ready = duration >= 0.1 && source !== null && !captureError

  useEffect(() => acquireAudio?.(), [acquireAudio])
  useEffect(() => { if (uploaded) uploadResult.current?.scrollIntoView?.({ block: 'nearest' }) }, [uploaded])
  useEffect(() => {
    const request = new AbortController()
    controller.current = request
    let captureId: string | undefined
    // The server keeps the snapshot; the video element streams it by range, so the
    // editor appears once the metadata arrives instead of after a full download.
    void createHighlightCapture(channelId, request.signal).then(capture => {
      if (request.signal.aborted) { void deleteHighlightCapture(capture.id); return }
      captureId = capture.id
      setSource({ id: capture.id, url: highlightCaptureUrl(capture.id) })
    }).catch(err => {
      if (!request.signal.aborted) setCaptureError(err instanceof Error ? err.message : 'Could not capture clip')
    })
    void getHighlightFeatures(request.signal).then(features => {
      if (!request.signal.aborted) setZipline(features.ziplineEnabled === true)
    }).catch(() => {})
    return () => { request.abort(); if (captureId) void deleteHighlightCapture(captureId) }
  }, [channelId, attempt])

  const seek = useCallback((time: number) => {
    const player = video.current
    if (!player) return
    player.pause()
    player.currentTime = Math.max(0, Math.min(duration, time))
    setPlayhead(player.currentTime)
    setPlaying(false)
  }, [duration])

  function select(nextStart: number, nextEnd: number, boundary = nextStart) {
    if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd)) return
    const safeStart = Math.max(0, Math.min(duration - 0.1, nextStart))
    const safeEnd = Math.min(duration, Math.max(safeStart + 0.1, nextEnd))
    setRange([safeStart, safeEnd])
    setUploaded(null)
    setError(null)
    seek(Math.max(safeStart, Math.min(safeEnd, boundary)))
  }

  // timeupdate is too coarse for short selections; check each animation frame as well.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = () => {
      const player = video.current
      if (!player) return
      if (player.currentTime >= end) {
        player.pause(); player.currentTime = end; setPlaying(false)
      }
      setPlayhead(player.currentTime)
      if (!player.paused) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, end])

  async function playSelection() {
    const player = video.current
    if (!player) return
    if (playing) { player.pause(); return }
    player.currentTime = start
    try { await player.play() } catch { setError('Playback could not start. Try Play selection again.') }
  }

  async function output(destination: 'download' | 'zipline') {
    if (!ready || !source || busy.current) return
    busy.current = true
    setStage('preparing'); setError(null)
    const signal = controller.current!.signal
    const key = `${start}:${end}:${format}`
    try {
      let blob = cache.current?.key === key ? cache.current.blob : null
      if (!blob) {
        const trimmed = start > 0.001 || end < duration - 0.001
        blob = format === 'mp4' && !trimmed ? await fetchHighlightCapture(source.id, signal)
          : await exportHighlight(source.id, format, trimmed ? { startTime: start, endTime: end } : undefined, signal)
        if (signal.aborted) return
        cache.current = { key, blob }
      }
      if (destination === 'zipline') {
        setStage('uploading')
        const result = await uploadHighlight(blob, format, signal)
        if (!signal.aborted) setUploaded(result)
      } else {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `highlight-${channelId}-${new Date().toISOString().replace(/[:.]/g, '-')}.${format}`
        document.body.appendChild(link); link.click(); link.remove()
        // Give the browser time to start consuming the download URL.
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        toast.success(`Download started · ${(end - start).toFixed(1)}s ${format.toUpperCase()}`)
      }
    } catch (err) {
      if (!signal.aborted) setError(err instanceof Error ? err.message : 'Export failed. Please try again.')
    } finally {
      busy.current = false
      if (!signal.aborted) setStage(null)
    }
  }

  function retryCapture() {
    setSource(null); setCaptureError(null); setDuration(0); setRange([0, 0])
    setPlayhead(0); setPlaying(false); cache.current = null
    setAttempt(value => value + 1)
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent container={container} showCloseButton={false} className="max-h-[92dvh] max-w-[min(48rem,calc(100%-2rem))] overflow-y-auto" onKeyDown={event => event.stopPropagation()}
        // Radix sees Escape on the document before a field does; let the field revert its draft instead.
        onEscapeKeyDown={event => { if ((event.target as HTMLElement | null)?.closest?.('input,select,textarea')) event.preventDefault() }}
        // Closing deletes the capture, so a stray press outside must not discard a ready one.
        onInteractOutside={event => { if (ready) event.preventDefault() }}>
        <DialogHeader className="sticky -top-6 z-20 -mx-6 -mt-6 border-b bg-background p-6 pr-14">
          <Button variant="ghost" size="icon" aria-label="Close editor" onClick={onClose} className="absolute right-3 top-3"><X /></Button>
          <DialogTitle>Create clip</DialogTitle>
          <DialogDescription>Choose the moment to keep, preview your selection, then export it.</DialogDescription>
        </DialogHeader>
        {captureError ? <div role="alert" className="space-y-3 py-8 text-center">
          <p>{captureError}</p><Button variant="outline" onClick={retryCapture}>Capture again</Button>
        </div> : !source ? <div role="status" className="flex items-center justify-center gap-3 py-16"><Loader2 className="animate-spin" />Capturing recent footage…</div> : (
          <video ref={video} src={source.url} playsInline preload="auto" aria-label="Highlight preview"
            className="max-h-[28dvh] w-full rounded-lg bg-black object-contain"
            onLoadedMetadata={() => {
              const length = video.current?.duration ?? 0
              if (!Number.isFinite(length) || length < 0.1) { setCaptureError('This capture has no usable duration. Capture again once more footage is available.'); return }
              setDuration(length); setRange([0, length])
            }}
            onError={() => setCaptureError('This capture could not be played. Capture again to retry.')}
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
            onTimeUpdate={() => {
              const player = video.current
              if (!player) return
              if (!player.paused && player.currentTime >= end) { player.pause(); player.currentTime = end }
              setPlayhead(player.currentTime)
            }} />
        )}
        {ready && source && <>
          <fieldset disabled={stage !== null} className="min-w-0 space-y-4 disabled:opacity-70">
            <legend className="sr-only">Clip selection</legend>
            <div className="flex flex-wrap items-center gap-2">
              {[10, 15, 30].map(seconds => <Button key={seconds} type="button" variant="outline" size="sm"
                onClick={() => select(Math.max(0, duration - seconds), duration)}>Last {seconds}s</Button>)}
              <Button type="button" variant="outline" size="sm" onClick={() => select(0, duration)}>Full clip</Button>
              <span className="ml-auto text-sm text-muted-foreground">{duration.toFixed(1)}s captured</span>
            </div>
            <ClipTimeline url={source.url} duration={duration} start={start} end={end} playhead={playhead}
              onChange={select} onSeek={seek} disabled={stage !== null} />
            <div className="flex flex-wrap items-end gap-3">
              <ClipTimeField label="Start (seconds)" value={start} min={0} max={end - 0.1}
                onCommit={value => select(value, end)} />
              <ClipTimeField label="End (seconds)" value={end} min={start + 0.1} max={duration}
                onCommit={value => select(start, value, value)} />
              <Button variant="ghost" onClick={() => select(0, duration)}><RotateCcw />Reset</Button>
              <span className="ml-auto pb-2 text-sm font-semibold tabular-nums">Selected: {(end - start).toFixed(1)}s</span>
            </div>
            <Button variant="outline" onClick={() => void playSelection()}>{playing ? <Pause /> : <Play />}{playing ? 'Pause preview' : 'Play selection'}</Button>
          </fieldset>
          <div className="flex flex-wrap items-end gap-3 border-t pt-4">
            <label className="flex flex-col gap-1 text-sm">Format
              <select value={format} disabled={stage !== null} onChange={e => { setFormat(e.target.value as HighlightFormat); setUploaded(null) }} className="h-10 rounded-md border bg-background px-3">
                <option value="mp4">MP4</option><option value="webm">WebM</option>
              </select>
            </label>
            <Button disabled={stage !== null} onClick={() => void output('download')}><Download />Download clip</Button>
            {zipline && <Button variant="outline" disabled={stage !== null || uploaded !== null} onClick={() => void output('zipline')}><Upload />{uploaded ? 'Uploaded to Zipline' : 'Upload to Zipline'}</Button>}
          </div>
        </>}
        {stage && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />{stage === 'preparing' ? 'Preparing your clip…' : 'Uploading to Zipline…'}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {uploaded && <div ref={uploadResult} className="space-y-2 rounded-lg border p-3" role="status">
          <p className="text-sm font-medium">Uploaded to Zipline</p>
          <input readOnly aria-label="Uploaded clip link" value={uploaded.url} className="w-full rounded border bg-background p-2 text-sm" onFocus={e => e.target.select()} />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={async () => {
              try { await navigator.clipboard.writeText(uploaded.url); toast.success('Link copied') }
              catch { setError('Could not copy automatically. Select and copy the link above.') }
            }}><Copy />Copy link</Button>
            <Button variant="outline" size="sm" asChild><a href={uploaded.url} target="_blank" rel="noopener noreferrer"><ExternalLink />Open</a></Button>
          </div>
        </div>}
      </DialogContent>
    </Dialog>
  )
}
