import { useId, useState, type FormEvent } from 'react'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { submitFeedback, type FeedbackType } from '@/services/feedbackApi'
import { getSessionId } from '@/lib/sessionId'
import { APP_VERSION } from '@/lib/appInfo'

/** Mirrors the backend bound on the message field. */
export const MAX_FEEDBACK_LENGTH = 2000

interface FeedbackDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const [type, setType] = useState<FeedbackType>('bug')
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messageId = useId()

  const canSubmit = message.trim().length > 0 && !isSubmitting

  function handleOpenChange(next: boolean) {
    if (isSubmitting) return
    if (!next) setError(null)
    onOpenChange(next)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return

    setIsSubmitting(true)
    setError(null)
    try {
      await submitFeedback({
        type,
        message: message.trim(),
        contact: contact.trim(),
        context: {
          userAgent: navigator.userAgent,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          path: window.location.pathname,
          sessionId: getSessionId(),
          appVersion: APP_VERSION,
        },
      })
      toast.success('Thanks, your feedback was sent')
      setMessage('')
      setContact('')
      setType('bug')
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send feedback. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[92dvh] w-[95vw] max-w-lg overflow-y-auto"
        onKeyDown={(event) => event.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>
            Found a bug or have an idea? It goes straight to the person running this.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <fieldset disabled={isSubmitting} className="space-y-4 disabled:opacity-70">
            <legend className="sr-only">Feedback details</legend>
            <label className="flex flex-col gap-1 text-sm">
              Type
              <select
                value={type}
                onChange={(event) => setType(event.target.value as FeedbackType)}
                className="h-10 rounded-md border bg-background px-3"
              >
                <option value="bug">Bug report</option>
                <option value="suggestion">Suggestion</option>
                <option value="other">Something else</option>
              </select>
            </label>
            <div className="flex flex-col gap-1 text-sm">
              <label htmlFor={messageId}>Message</label>
              <Textarea
                id={messageId}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={MAX_FEEDBACK_LENGTH}
                placeholder={
                  type === 'bug'
                    ? 'What happened, and what did you expect instead?'
                    : 'What would make this better?'
                }
                required
              />
              <span className="self-end text-xs text-muted-foreground tabular-nums">
                {message.length}/{MAX_FEEDBACK_LENGTH}
              </span>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              How can I reach you? (optional)
              <Input
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                maxLength={200}
                placeholder="Email, handle, or leave blank"
                autoComplete="off"
              />
            </label>
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting ? <Loader2 className="animate-spin" /> : <Send />}
              {isSubmitting ? 'Sending…' : 'Send'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
