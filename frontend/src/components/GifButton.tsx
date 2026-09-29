import { useState } from 'react'
import { ImageIcon } from 'lucide-react'
import { useLayoutMode } from '@/hooks/useLayoutMode'
import { useSettingsStore } from '@/stores/settingsStore'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { GifPicker } from './GifPicker'

export interface GifButtonProps {
  onSelect: (gifUrl: string) => boolean | void | Promise<boolean | void>
  disabled?: boolean
  /** Where the picker opens: the player while chat is in it fullscreen */
  container?: HTMLElement | null
}

export function GifButton({ onSelect, disabled, container }: GifButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  // Whether the server has GIFs on, from connection_ack; undefined until it says
  const serverEnabled = useSettingsStore((s) => s.serverFeatures?.gif)
  const isMobile = useLayoutMode() === 'phone'

  // Shown only once the server says GIFs are on
  if (serverEnabled !== true) {
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
          className="pointer-coarse:size-11"
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
          className="pointer-coarse:size-11"
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
