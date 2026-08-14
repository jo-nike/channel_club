import { useState } from 'react'
import { Tv, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useAppSettings } from '@/hooks/useAppSettings'
import { useSettingsStore } from '@/stores/settingsStore'
import { updateAppSettings } from '@/services/api'
import { logger } from '@/lib/logger'

export function UserAccessTab() {
  const { userChannelSelection } = useAppSettings()
  const setUserChannelSelection = useSettingsStore((s) => s.setUserChannelSelection)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleToggle = async () => {
    const next = !userChannelSelection

    // Optimistic - the WebSocket broadcast confirms it for every client
    setUserChannelSelection(next)
    setIsLoading(true)
    setError(null)

    try {
      await updateAppSettings({ userChannelSelection: next })
      logger.info('Admin', `User channel selection set to ${next}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setUserChannelSelection(!next)
      setError(message)
      logger.error('Admin', `Failed to update user channel selection: ${message}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6 p-4">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">User Access</h2>
        <p className="text-sm text-muted-foreground">
          Control what non-admin users are allowed to do
        </p>
      </div>

      {/* Channel selection card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Tv className="h-5 w-5" />
            Live Channel Selection
          </CardTitle>
          <CardDescription>
            Let any signed-in user browse the channel lineup and change the live channel for
            everyone. Clearing the channel stays admin-only. This setting resets when the
            server restarts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium">Users can set the live channel</p>
              <p className="text-sm text-muted-foreground">
                {userChannelSelection
                  ? 'Anyone watching can change the channel'
                  : 'Only admins can change the channel'}
              </p>
            </div>
            <Button
              variant={userChannelSelection ? 'default' : 'outline'}
              disabled={isLoading}
              onClick={handleToggle}
              aria-pressed={userChannelSelection}
              className="gap-2 shrink-0"
            >
              {userChannelSelection && <Check className="h-4 w-4" />}
              {userChannelSelection ? 'Enabled' : 'Disabled'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
