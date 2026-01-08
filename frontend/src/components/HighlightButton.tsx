import { useState, useEffect, useCallback } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { saveHighlight, getHighlightStatus } from '@/services/api'

export interface HighlightButtonProps {
  channelId: string
  isVisible: boolean
}

export function HighlightButton({ channelId, isVisible }: HighlightButtonProps) {
  const [isSaving, setIsSaving] = useState(false)
  const [bufferSeconds, setBufferSeconds] = useState(0)
  const [maxBufferSeconds, setMaxBufferSeconds] = useState(60)
  const [isRecording, setIsRecording] = useState(false)

  // Poll for buffer status every 5 seconds when visible
  useEffect(() => {
    if (!isVisible || !channelId) return

    const fetchStatus = async () => {
      try {
        const status = await getHighlightStatus(channelId)
        setIsRecording(status.recording)
        setBufferSeconds(status.bufferSeconds)
        setMaxBufferSeconds(status.maxBufferSeconds)
      } catch {
        // Silently fail - status is informational
      }
    }

    // Initial fetch
    fetchStatus()

    // Poll every 5 seconds
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [channelId, isVisible])

  const handleSaveHighlight = useCallback(async () => {
    if (isSaving || !channelId) return

    setIsSaving(true)
    try {
      const blob = await saveHighlight(channelId)

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `highlight-${channelId}-${timestamp}.mp4`

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
      if (seconds < maxBufferSeconds) {
        toast.info(`Saved ${seconds}s highlight (partial capture)`, {
          description: filename,
        })
      } else {
        toast.success(`Saved ${maxBufferSeconds}s highlight`, {
          description: filename,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save highlight'
      toast.error('Highlight capture failed', { description: message })
    } finally {
      setIsSaving(false)
    }
  }, [channelId, isSaving, bufferSeconds, maxBufferSeconds])

  // Hide button if not recording (instead of showing disabled)
  if (!isRecording) {
    return null
  }

  // Build tooltip text
  const seconds = Math.round(bufferSeconds || 0)
  const tooltipText = `Save last ${seconds}s`

  return (
    <button
      type="button"
      tabIndex={isVisible ? 0 : -1}
      onClick={handleSaveHighlight}
      disabled={isSaving}
      aria-label={tooltipText}
      title={tooltipText}
      className="control-button relative flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/80 disabled:opacity-50"
    >
      {isSaving ? (
        <Loader2 className="h-6 w-6 animate-spin text-white" />
      ) : (
        <Download className="h-6 w-6 text-white" />
      )}
    </button>
  )
}
