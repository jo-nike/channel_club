import { Bell, BellRing } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * NotificationToggle component - toggles live channel change notifications
 * Follows the same button styling pattern as ThemePicker
 */
export function NotificationToggle() {
  const notificationsEnabled = useUIStore((s) => s.notificationsEnabled)
  const toggleNotifications = useUIStore((s) => s.toggleNotifications)

  const tooltipText = notificationsEnabled
    ? 'Notifications enabled'
    : 'Notifications disabled'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={toggleNotifications}
          className={`
            h-8 w-8 flex items-center justify-center rounded-md
            focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
            ${
              notificationsEnabled
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }
          `}
          aria-label={
            notificationsEnabled
              ? 'Disable live channel notifications'
              : 'Enable live channel notifications'
          }
          aria-pressed={notificationsEnabled}
        >
          {notificationsEnabled ? (
            <BellRing className="h-4 w-4 shrink-0" />
          ) : (
            <Bell className="h-4 w-4 shrink-0" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  )
}
