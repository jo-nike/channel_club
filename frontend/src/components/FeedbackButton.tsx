import { useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { HeaderAction } from '@/components/HeaderAction'
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
      <HeaderAction
        icon={<MessageSquarePlus />}
        label="Send feedback"
        onClick={() => setOpen(true)}
      />
      <FeedbackDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
