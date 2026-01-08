import { useState, useEffect } from 'react'
import { ImageIcon } from 'lucide-react'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { getGifFeatureEnabled } from '@/services/gifApi'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { GifPicker } from './GifPicker'
import { logger } from '@/lib/logger'

// Check if GIF feature is enabled via env var (build-time)
const GIF_FEATURE_ENABLED = import.meta.env.VITE_GIF_ENABLED === 'true'

export interface GifButtonProps {
  onSelect: (gifUrl: string) => void
  disabled?: boolean
}

export function GifButton({ onSelect, disabled }: GifButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [serverEnabled, setServerEnabled] = useState<boolean | null>(null)
  const breakpoint = useBreakpoint()
  const isMobile = breakpoint === 'mobile'

  // Check if server has GIF feature enabled
  useEffect(() => {
    if (!GIF_FEATURE_ENABLED) {
      setServerEnabled(false)
      return
    }

    async function checkFeature() {
      try {
        const enabled = await getGifFeatureEnabled()
        setServerEnabled(enabled)
        logger.debug('GIF', `Server GIF feature enabled: ${enabled}`)
      } catch (err) {
        logger.error('GIF', 'Failed to check GIF feature status')
        setServerEnabled(false)
      }
    }

    checkFeature()
  }, [])

  // Don't render if feature is disabled
  if (!GIF_FEATURE_ENABLED || serverEnabled === false) {
    return null
  }

  // Still loading - don't show yet
  if (serverEnabled === null) {
    return null
  }

  const handleSelect = (gifUrl: string) => {
    onSelect(gifUrl)
    setIsOpen(false)
  }

  const handleClose = () => {
    setIsOpen(false)
  }

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
          className="h-9 w-9 shrink-0"
        >
          <ImageIcon className="h-5 w-5" />
        </Button>
        <DialogContent className="sm:max-w-md max-h-[80vh] p-0 gap-0">
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
          className="h-9 w-9 shrink-0"
        >
          <ImageIcon className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        align="end"
        side="top"
        sideOffset={8}
      >
        <GifPicker onSelect={handleSelect} onClose={handleClose} />
      </PopoverContent>
    </Popover>
  )
}
