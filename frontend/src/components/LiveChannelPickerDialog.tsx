import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ChannelList } from '@/components/ChannelList'

interface LiveChannelPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Channel picker for non-admin users, shown when the admin has enabled
 * user channel selection. Picking a channel changes it for everyone.
 */
export function LiveChannelPickerDialog({ open, onOpenChange }: LiveChannelPickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:w-[85vw] md:w-[75vw] max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Live TV Channel</DialogTitle>
          <DialogDescription>
            Pick a channel to put on for everyone watching.
          </DialogDescription>
        </DialogHeader>

        <div className="epg-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <ChannelList onChannelSelected={() => onOpenChange(false)} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
