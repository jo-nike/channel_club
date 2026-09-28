import { useActiveUsers } from '@/hooks/useActiveUsers'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface StopLiveTVDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  channelName: string
  onConfirm: () => void
}

const UNTIL = 'until someone picks a channel.'

/**
 * Confirms stopping the shared live channel for everyone. The body names how
 * many people are watching, so it is only mounted while the dialog is open:
 * the active-users endpoint is admin-only and polls while mounted.
 */
export function StopLiveTVDialog({ open, onOpenChange, channelName, onConfirm }: StopLiveTVDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stop live TV for everyone?</DialogTitle>
          <AffectedViewers channelName={channelName} />
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" autoFocus onClick={() => onOpenChange(false)}>
            Keep it on
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Stop live TV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AffectedViewers({ channelName }: { channelName: string }) {
  const { data, loading, error } = useActiveUsers()
  const me = useAuthStore((s) => s.username)

  // Only people following the Live slot are affected, not those on a channel of
  // their own. Presence lists sessions, not people: one person with two tabs
  // counts once. The admin pressing Stop is not one of the people it affects.
  const people = data && !loading && !error
    ? new Set(data.liveUsers.filter((u) => u.onLive).map((u) => u.username).filter((name) => name !== me)).size
    : null

  let text: string
  if (people === null) {
    text = `Everyone watching ${channelName} will see "No live broadcast" ${UNTIL}`
  } else if (people === 0) {
    text = `Nobody else is watching ${channelName}. Live TV will show "No live broadcast" ${UNTIL}`
  } else {
    const who = people === 1 ? '1 person is' : `${people} people are`
    text = `${who} watching ${channelName}. Their screens will show "No live broadcast" ${UNTIL}`
  }

  return <DialogDescription>{text}</DialogDescription>
}
