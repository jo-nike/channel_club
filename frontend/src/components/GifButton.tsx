import { useState, useEffect } from 'react'
import { ImageIcon } from 'lucide-react'
import { useLayoutMode } from '@/hooks/useLayoutMode'
import { getGifFeatureEnabled } from '@/services/gifApi'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { GifPicker } from './GifPicker'
import { logger } from '@/lib/logger'

// Check if GIF feature is enabled via env var (build-time)
const GIF_FEATURE_ENABLED = import.meta.env.VITE_GIF_ENABLED === 'true'

export interface GifButtonProps {
  onSelect: (gifUrl: string) => boolean | void | Promise<boolean | void>
  disabled?: boolean
  /** Where the picker opens: the player while chat is in it fullscreen */
  container?: HTMLElement | null
}

export function GifButton({ onSelect, disabled, container }: GifButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  // Initialize to false if build-time flag is off, otherwise null (loading)
  const [serverEnabled, setServerEnabled] = useState<boolean | null>(
    GIF_FEATURE_ENABLED ? null : false
  )
  const isMobile = useLayoutMode() === 'phone'

  // Check if server has GIF feature enabled (only if build-time flag is true)
  useEffect(() => {
    if (!GIF_FEATURE_ENABLED) {
      // Already handled by initial state
      return
    }

    let cancelled = false

    async function checkFeature() {
      try {
        const enabled = await getGifFeatureEnabled()
        if (!cancelled) {
          setServerEnabled(enabled)
          logger.debug('GIF', `Server GIF feature enabled: ${enabled}`)
        }
      } catch {
        if (!cancelled) {
          logger.error('GIF', 'Failed to check GIF feature status')
          setServerEnabled(false)
        }
      }
    }

    checkFeature()

    return () => {
      cancelled = true
    }
  }, [])

  // Don't render if feature is disabled
  if (!GIF_FEATURE_ENABLED || serverEnabled === false) {
    return null
  }

  // Still loading - don't show yet
  if (serverEnabled === null) {
    return null
  }

  const handleSelect = async (gifUrl: string) => {
    const sent = await onSelect(gifUrl)
    if (sent !== false) setIsOpen(false)
    return sent
  }

  const handleClose = () => {
    setIsOpen(false)
  }

  // The trigger is a quiet ghost icon, so Send stays the composer's main action.
  // Use Dialog for mobile (bottom sheet style), Popover for desktop
  if (isMobile) {
    return (
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={() => setIsOpen(true)}
          aria-label="Send GIF"
        >
          <ImageIcon className="h-4 w-4" />
        </Button>
        <DialogContent className="sm:max-w-md max-h-[80vh] p-0 gap-0" container={container}>
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>Choose a GIF</DialogTitle>
          </DialogHeader>
          <GifPicker onSelect={handleSelect} onClose={handleClose} />
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label="Send GIF"
        >
          <ImageIcon className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        align="end"
        side="top"
        sideOffset={8}
        container={container}
      >
        <GifPicker onSelect={handleSelect} onClose={handleClose} />
      </PopoverContent>
    </Popover>
  )
}
