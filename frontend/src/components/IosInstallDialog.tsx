import { Share, SquarePlus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { APP_NAME } from '@/lib/appInfo'

interface IosInstallDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * How to install on iPhone and iPad, where browsers never offer installation
 * themselves: Share, then Add to Home Screen. Instructions only, so the X is
 * the only control.
 */
export function IosInstallDialog({ open, onOpenChange }: IosInstallDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A bottom sheet on phones, near Safari's toolbar; centred from sm */}
      <DialogContent className="max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none max-sm:pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add {APP_NAME} to your Home Screen</DialogTitle>
          <DialogDescription>It opens full screen, like an app.</DialogDescription>
        </DialogHeader>
        <ol className="space-y-3 text-sm text-foreground">
          <li className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-primary">
              <Share aria-hidden="true" className="size-5" />
            </span>
            <span>
              Tap <strong className="font-semibold">Share</strong> in the browser toolbar.
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-primary">
              <SquarePlus aria-hidden="true" className="size-5" />
            </span>
            <span>
              Then tap <strong className="font-semibold">Add to Home Screen</strong>.
            </span>
          </li>
        </ol>
      </DialogContent>
    </Dialog>
  )
}
