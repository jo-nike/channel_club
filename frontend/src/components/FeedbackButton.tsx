import { useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FeedbackDialog } from '@/components/FeedbackDialog'
import { useFeedbackFeature } from '@/hooks/useFeedbackFeature'

export function FeedbackButton() {
  const { isEnabled } = useFeedbackFeature()
  const [open, setOpen] = useState(false)

  // Don't render until the server confirms feedback is configured
  if (!isEnabled) {
    return null
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Send feedback"
            className="h-8 w-8 flex items-center justify-center bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <MessageSquarePlus className="h-4 w-4 shrink-0" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Send feedback</p>
        </TooltipContent>
      </Tooltip>
      <FeedbackDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
