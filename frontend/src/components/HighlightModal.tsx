import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Download, Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { saveHighlight, exportHighlight, getHighlightStatus, type HighlightFormat, type TrimOptions } from '@/services/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'
import { isWebMSupported } from '@/lib/utils'

/** Format seconds as MM:SS */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export interface HighlightModalProps {
  isOpen: boolean
  onClose: () => void
  channelId: string
  onVolumeChange?: (volume: number) => void
  previousVolume?: number
}

export function HighlightModal({
  isOpen,
  onClose,
  channelId,
  onVolumeChange,
  previousVolume = 1,
}: HighlightModalProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isDownloading, setIsDownloading] = useState<HighlightFormat | null>(null)
  const [highlightBlobUrl, setHighlightBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bufferSeconds, setBufferSeconds] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const blobRef = useRef<Blob | null>(null)

  // Check WebM support once on mount
  const webmSupported = useMemo(() => isWebMSupported(), [])

  // Fetch highlight when modal opens
  useEffect(() => {
    if (!isOpen || !channelId) return

    let cancelled = false

    const fetchHighlight = async () => {
      setIsLoading(true)
      setError(null)

      try {
        // First get buffer status for toast message later
        try {
          const status = await getHighlightStatus(channelId)
          if (!cancelled) setBufferSeconds(status.bufferSeconds)
        } catch {
          // Status is informational, continue even if it fails
        }

        if (cancelled) return

        // Fetch the highlight video
        const blob = await saveHighlight(channelId)
        if (cancelled) return
        blobRef.current = blob
        const url = URL.createObjectURL(blob)
        setHighlightBlobUrl(url)

        // Duck background video volume
        onVolumeChange?.(0.2)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Failed to load highlight'
        setError(message)
        toast.error('Failed to load highlight', { description: message })
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    fetchHighlight()

    return () => {
      cancelled = true
    }
  }, [isOpen, channelId, onVolumeChange])

  // Cleanup blob URL when modal closes
  useEffect(() => {
    return () => {
      if (highlightBlobUrl) {
        URL.revokeObjectURL(highlightBlobUrl)
      }
    }
  }, [highlightBlobUrl])

  // Handle video metadata loaded - initialize trim values
  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      const duration = videoRef.current.duration
      setVideoDuration(duration)
      setTrimStart(0)
      setTrimEnd(duration)
    }
  }, [])

  // Handle modal close - restore volume and reset state
  const handleClose = useCallback(() => {
    // Restore previous volume
    onVolumeChange?.(previousVolume)

    // Cleanup blob URL
    if (highlightBlobUrl) {
      URL.revokeObjectURL(highlightBlobUrl)
      setHighlightBlobUrl(null)
    }
    blobRef.current = null
    setError(null)
    setVideoDuration(0)
    setTrimStart(0)
    setTrimEnd(0)

    onClose()
  }, [onClose, onVolumeChange, previousVolume, highlightBlobUrl])

  // Check if user has applied any trimming
  const hasTrimming = videoDuration > 0 && (trimStart > 0.1 || trimEnd < videoDuration - 0.1)
  const trimmedDuration = trimEnd - trimStart

  // Handle slider value changes
  const handleSliderChange = useCallback((values: number[]) => {
    if (values.length === 2) {
      setTrimStart(values[0])
      setTrimEnd(values[1])
    }
  }, [])

  // Reset trim to full duration
  const handleResetTrim = useCallback(() => {
    setTrimStart(0)
    setTrimEnd(videoDuration)
  }, [videoDuration])

  // Handle download for a specific format
  const handleDownload = useCallback(
    async (format: HighlightFormat) => {
      setIsDownloading(format)

      try {
        // Build trim options if user has trimmed
        const trimOptions: TrimOptions | undefined = hasTrimming
          ? { startTime: trimStart, endTime: trimEnd }
          : undefined

        let blob: Blob
        // Use cached blob only for MP4 without trimming
        if (format === 'mp4' && !hasTrimming && blobRef.current) {
          blob = blobRef.current
        } else {
          if (!blobRef.current) throw new Error('Preview is not available')
          blob = await exportHighlight(blobRef.current, format, trimOptions)
        }

        // Generate filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const filename = `highlight-${channelId}-${timestamp}.${format}`

        // Download the file
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        // Show success toast with actual duration
        const duration = hasTrimming ? Math.round(trimmedDuration) : Math.round(bufferSeconds)
        const formatLabel = format.toUpperCase()
        toast.success(`Saved ${duration}s ${formatLabel} highlight`, {
          description: filename,
        })
      } catch {
        toast.error(`Failed to download ${format.toUpperCase()} highlight`)
      } finally {
        setIsDownloading(null)
      }
    },
    [channelId, bufferSeconds, hasTrimming, trimStart, trimEnd, trimmedDuration]
  )

  // Convenience handlers for each format
  const handleDownloadMP4 = useCallback(() => handleDownload('mp4'), [handleDownload])
  const handleDownloadWebM = useCallback(() => handleDownload('webm'), [handleDownload])

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Highlight Preview</DialogTitle>
        </DialogHeader>

        <div className="relative min-h-[200px]">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-3 text-muted-foreground">Loading highlight...</span>
            </div>
          )}

          {error && !isLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-destructive">{error}</p>
              <Button variant="outline" onClick={handleClose} className="mt-4">
                Close
              </Button>
            </div>
          )}

          {highlightBlobUrl && !isLoading && !error && (
            <video
              ref={videoRef}
              src={highlightBlobUrl}
              controls
              autoPlay
              onLoadedMetadata={handleLoadedMetadata}
              className="w-full rounded-lg"
              aria-label="Highlight preview"
            />
          )}
        </div>

        {/* Trim controls */}
        {highlightBlobUrl && !isLoading && !error && videoDuration > 0 && (
          <div className="space-y-3 px-1">
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground w-14 text-right">
                {formatTime(trimStart)}
              </span>
              <Slider
                value={[trimStart, trimEnd]}
                min={0}
                max={videoDuration}
                step={0.1}
                onValueChange={handleSliderChange}
                className="flex-1"
              />
              <span className="text-sm text-muted-foreground w-14">
                {formatTime(trimEnd)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Duration: <span className="text-foreground font-medium">{formatTime(trimmedDuration)}</span>
                {hasTrimming && (
                  <span className="text-muted-foreground ml-1">
                    (trimmed from {formatTime(videoDuration)})
                  </span>
                )}
              </span>
              {hasTrimming && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResetTrim}
                  className="h-7 px-2"
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reset
                </Button>
              )}
            </div>
          </div>
        )}

        {highlightBlobUrl && !isLoading && !error && (
          <DialogFooter className="flex gap-2 sm:gap-2">
            <Button onClick={handleDownloadMP4} disabled={isDownloading !== null}>
              {isDownloading === 'mp4' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Download MP4 {hasTrimming && `(${formatTime(trimmedDuration)})`}
            </Button>
            {webmSupported && (
              <Button
                onClick={handleDownloadWebM}
                variant="outline"
                disabled={isDownloading !== null}
              >
                {isDownloading === 'webm' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Download WebM (Slow) {hasTrimming && `(${formatTime(trimmedDuration)})`}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
