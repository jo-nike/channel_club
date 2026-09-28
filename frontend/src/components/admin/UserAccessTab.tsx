import { useId, useState } from 'react'
import { Eye, Tv } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useAppSettings } from '@/hooks/useAppSettings'
import { useSettingsStore } from '@/stores/settingsStore'
import { updateAppSettings } from '@/services/api'
import { logger } from '@/lib/logger'

type SettingKey = 'userChannelSelection' | 'presenceVisible'

export function UserAccessTab() {
  const { userChannelSelection, presenceVisible } = useAppSettings()
  const setUserChannelSelection = useSettingsStore((s) => s.setUserChannelSelection)
  const setPresenceVisible = useSettingsStore((s) => s.setPresenceVisible)
  // The setting waiting on the server, and the last one that failed
  const [saving, setSaving] = useState<SettingKey | null>(null)
  const [error, setError] = useState<{ key: SettingKey; message: string } | null>(null)
  const labelId = useId()
  const descriptionId = useId()
  const presenceLabelId = useId()
  const presenceDescriptionId = useId()

  const handleToggle = async (key: SettingKey, next: boolean, apply: (value: boolean) => void) => {
    // Optimistic - the WebSocket broadcast confirms it for every client
    apply(next)
    setSaving(key)
    setError(null)

    try {
      await updateAppSettings({ [key]: next })
      logger.info('Admin', `${key} set to ${next}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      apply(!next)
      setError({ key, message })
      logger.error('Admin', `Failed to update ${key}: ${message}`)
    } finally {
      setSaving(null)
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
            everyone. Clearing the channel stays admin-only. This setting is kept when the
            server restarts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error?.key === 'userChannelSelection' && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error.message}
            </div>
          )}

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p id={labelId} className="font-medium">Users can set the live channel</p>
              <p id={descriptionId} className="text-sm text-muted-foreground">
                {userChannelSelection
                  ? 'Anyone watching can change the channel'
                  : 'Only admins can change the channel'}
              </p>
            </div>
            <Switch
              checked={userChannelSelection}
              onCheckedChange={() =>
                handleToggle('userChannelSelection', !userChannelSelection, setUserChannelSelection)
              }
              disabled={saving !== null}
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
            />
          </div>
        </CardContent>
      </Card>

      {/* Presence card: ships off; turning it on is the group's call */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Who's Watching What
          </CardTitle>
          <CardDescription>
            Let everyone see which channel and programme each person is watching. Ask the
            group before turning this on. While it is off, people see only who is online.
            Anyone who picks "Hide what I'm watching" is shown by name only. Admins still see
            everything in Active Users. This setting is kept when the server restarts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error?.key === 'presenceVisible' && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error.message}
            </div>
          )}

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p id={presenceLabelId} className="font-medium">Show what everyone is watching</p>
              <p id={presenceDescriptionId} className="text-sm text-muted-foreground">
                {presenceVisible
                  ? 'Everyone can see who is watching what'
                  : 'Others see only who is online'}
              </p>
            </div>
            <Switch
              checked={presenceVisible}
              onCheckedChange={() => handleToggle('presenceVisible', !presenceVisible, setPresenceVisible)}
              disabled={saving !== null}
              aria-labelledby={presenceLabelId}
              aria-describedby={presenceDescriptionId}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
