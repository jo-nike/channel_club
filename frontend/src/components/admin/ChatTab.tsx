import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Trash2, MessageSquare, CheckCircle } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { fetchWithAuth } from '@/services/api'
import { logger } from '@/lib/logger'

export function ChatTab() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const clearMessages = useChatStore((state) => state.clearMessages)

  const handleClearHistory = async () => {
    setConfirmOpen(false)
    setIsLoading(true)
    setError(null)
    setSuccess(false)

    try {
      const response = await fetchWithAuth('/admin/chat-history', {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to clear chat history')
      }

      // Clear frontend store as well
      clearMessages()
      setSuccess(true)
      logger.info('Admin', 'Chat history cleared')

      // Reset success message after a few seconds
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(message)
      logger.error('Admin', `Failed to clear chat history: ${message}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6 p-4">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">Chat Management</h2>
        <p className="text-sm text-muted-foreground">
          Manage chat settings and history
        </p>
      </div>

      {/* Clear History Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Chat History
          </CardTitle>
          <CardDescription>
            Clear all chat messages from the server. This affects all users.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-md bg-green-600/10 p-3 text-sm text-green-600 flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              Chat history cleared successfully
            </div>
          )}

          <Button
            variant="destructive"
            disabled={isLoading}
            className="gap-2"
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            {isLoading ? 'Clearing...' : 'Clear Chat History'}
          </Button>

          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Clear chat history?</DialogTitle>
                <DialogDescription>
                  This will permanently delete all chat messages from the server.
                  This action cannot be undone and affects all users.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleClearHistory}>
                  Clear History
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  )
}
