import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { ErsatzTVProgramme, ErsatzTVChannel } from '@/types'

interface ProgrammeDetailsModalProps {
  programme: ErsatzTVProgramme | null
  channel: ErsatzTVChannel | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onWatch: (channel: ErsatzTVChannel) => void
}

export function ProgrammeDetailsModal({
  programme,
  channel,
  open,
  onOpenChange,
  onWatch,
}: ProgrammeDetailsModalProps) {
  if (!programme || !channel) return null

  const startTime = new Date(programme.start)
  const endTime = new Date(programme.stop)
  const duration = Math.round(
    (endTime.getTime() - startTime.getTime()) / (1000 * 60)
  )

  const handleWatch = () => {
    onWatch(channel)
    onOpenChange(false)
  }

  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl">{programme.title}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1">
              <p className="text-muted-foreground">
                {formatTime(startTime)} - {formatTime(endTime)} ({duration} min)
              </p>
              <p className="text-sm text-muted-foreground">
                on {channel.name}
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {programme.category && programme.category.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {programme.category.map((cat, i) => (
                <Badge key={i} variant="secondary">
                  {cat}
                </Badge>
              ))}
            </div>
          )}

          {programme.description ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <p>{programme.description}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No description available
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={handleWatch}>Watch Now</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
