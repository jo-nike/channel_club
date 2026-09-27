import { toast } from 'sonner'
import type { ChatSendResult } from '@/hooks/useWebSocket'
import type { Channel } from '@/types'

/**
 * Tell the suggester how their live TV suggestion went. The sheet or popover
 * it came from has closed by then, so this is all they hear of it.
 */
export async function reportSuggestion(channel: Channel, sending: Promise<ChatSendResult>) {
  const result = await sending
  if (result === 'acknowledged') {
    toast.success(`Suggested ${channel.name} in chat`)
  } else if (result === 'not-sent') {
    toast.error(`Could not suggest ${channel.name}`, { description: 'Please try again' })
  } else {
    toast.warning(`Your suggestion of ${channel.name} may not have been posted`, {
      description: 'Check the chat before suggesting it again',
    })
  }
}
