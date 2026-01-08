import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { saveHighlight, getHighlightStatus, type HighlightFormat } from '@/services/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { isWebMSupported } from '@/lib/utils'

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
  const [maxBufferSeconds, setMaxBufferSeconds] = useState(60)
  const videoRef = useRef<HTMLVideoElement>(null)
  const blobRef = useRef<Blob | null>(null)

  // Check WebM support once on mount
  const webmSupported = useMemo(() => isWebMSupported(), [])

  // Fetch highlight when modal opens
  useEffect(() => {
    if (!isOpen || !channelId) return

    const fetchHighlight = async () => {
      setIsLoading(true)
      setError(null)

      try {
        // First get buffer status for toast message later
        try {
          const status = await getHighlightStatus(channelId)
          setBufferSeconds(status.bufferSeconds)
          setMaxBufferSeconds(status.maxBufferSeconds)
        } catch {
          // Status is informational, continue even if it fails
        }

        // Fetch the highlight video
        const blob = await saveHighlight(channelId)
        blobRef.current = blob
        const url = URL.createObjectURL(blob)
        setHighlightBlobUrl(url)

        // Duck background video volume
        onVolumeChange?.(0.2)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load highlight'
        setError(message)
        toast.error('Failed to load highlight', { description: message })
      } finally {
        setIsLoading(false)
      }
    }

    fetchHighlight()
  }, [isOpen, channelId, onVolumeChange])

  // Cleanup blob URL when modal closes
  useEffect(() => {
    return () => {
      if (highlightBlobUrl) {
        URL.revokeObjectURL(highlightBlobUrl)
      }
    }
  }, [highlightBlobUrl])

  // Handle modal close - restore volume
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

    onClose()
  }, [onClose, onVolumeChange, previousVolume, highlightBlobUrl])

  // Handle download for a specific format
  const handleDownload = useCallback(
    async (format: HighlightFormat) => {
      // For MP4, use the already-fetched blob
      // For WebM, we need to fetch from the server with the format parameter
      setIsDownloading(format)

      try {
        let blob: Blob
        if (format === 'mp4' && blobRef.current) {
          blob = blobRef.current
        } else {
          // Fetch the highlight in the requested format
          blob = await saveHighlight(channelId, format)
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

        // Show success toast
        const seconds = Math.round(bufferSeconds)
        const formatLabel = format.toUpperCase()
        if (seconds < maxBufferSeconds) {
          toast.info(`Saved ${seconds}s ${formatLabel} highlight (partial capture)`, {
            description: filename,
          })
        } else {
          toast.success(`Saved ${maxBufferSeconds}s ${formatLabel} highlight`, {
            description: filename,
          })
        }
      } catch {
        toast.error(`Failed to download ${format.toUpperCase()} highlight`)
      } finally {
        setIsDownloading(null)
      }
    },
    [channelId, bufferSeconds, maxBufferSeconds]
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
              className="w-full rounded-lg"
              aria-label="Highlight preview"
            />
          )}
        </div>

        {highlightBlobUrl && !isLoading && !error && (
          <DialogFooter className="flex gap-2 sm:gap-2">
            <Button onClick={handleDownloadMP4} disabled={isDownloading !== null}>
              {isDownloading === 'mp4' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Download MP4
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
                Download WebM (Slow)
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
