import { useState } from 'react'
import { Settings, Bell, BellRing, Check, LogOut } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/hooks/useTheme'
import { useUIStore } from '@/stores/uiStore'
import { getThemeCategories, getTheme } from '@/lib/themes'
import type { ThemeId } from '@/types/theme'
import { cn } from '@/lib/utils'

interface UserSettingsMenuProps {
  onLogout: () => void
}

export function UserSettingsMenu({ onLogout }: UserSettingsMenuProps) {
  const [open, setOpen] = useState(false)
  const { themeId, setTheme } = useTheme()
  const categories = getThemeCategories()
  const notificationsEnabled = useUIStore((s) => s.notificationsEnabled)
  const toggleNotifications = useUIStore((s) => s.toggleNotifications)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="toolbar" size="toolbar" aria-label="User settings">
              <Settings />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p>Settings</p>
        </TooltipContent>
      </Tooltip>
      <PopoverContent className="w-64 p-3" align="end">
        <div className="space-y-3">
          {/* Notifications section */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-2">
              Notifications
            </h3>
            <button
              onClick={toggleNotifications}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm',
                'hover:bg-accent hover:text-accent-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1'
              )}
              aria-pressed={notificationsEnabled}
            >
              {notificationsEnabled ? (
                <BellRing className="h-4 w-4 shrink-0" />
              ) : (
                <Bell className="h-4 w-4 shrink-0" />
              )}
              <span className="flex-1 text-left">Pop-up when the live channel changes</span>
              <span
                className={cn(
                  'text-xs px-1.5 py-0.5 rounded',
                  notificationsEnabled
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {notificationsEnabled ? 'On' : 'Off'}
              </span>
            </button>
          </div>

          {/* Separator */}
          <div className="h-px bg-border" />

          {/* Theme section */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-2">
              Theme
            </h3>
            <div className="space-y-3">
              {categories.map((category) => (
                <div key={category.mode}>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 mb-1">
                    {category.label}
                  </h4>
                  <div className="space-y-0.5">
                    {category.themes.map((theme) => (
                      <ThemeOption
                        key={theme.id}
                        id={theme.id}
                        name={theme.name}
                        isSelected={themeId === theme.id}
                        onSelect={setTheme}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Separator */}
          <div className="h-px bg-border" />

          {/* Logout */}
          <button
            onClick={onLogout}
            className={cn(
              'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm',
              'text-destructive hover:bg-destructive/10',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1'
            )}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span>Logout</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface ThemeOptionProps {
  id: ThemeId
  name: string
  isSelected: boolean
  onSelect: (id: ThemeId) => void
}

function ThemeOption({ id, name, isSelected, onSelect }: ThemeOptionProps) {
  const theme = getTheme(id)

  const bgColor = theme.colors.background
  const cardColor = theme.colors.card
  const primaryColor = theme.colors.primary

  return (
    <button
      onClick={() => onSelect(id)}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left',
        'hover:bg-accent hover:text-accent-foreground',
        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
        isSelected && 'bg-accent text-accent-foreground'
      )}
      aria-pressed={isSelected}
    >
      <div className="flex gap-0.5 shrink-0">
        <div
          className="w-3 h-3 rounded-sm border border-border"
          style={{ backgroundColor: bgColor }}
          aria-hidden="true"
        />
        <div
          className="w-3 h-3 rounded-sm border border-border"
          style={{ backgroundColor: cardColor }}
          aria-hidden="true"
        />
        <div
          className="w-3 h-3 rounded-sm border border-border"
          style={{ backgroundColor: primaryColor }}
          aria-hidden="true"
        />
      </div>
      <span className="flex-1 truncate">{name}</span>
      {isSelected && (
        <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      )}
    </button>
  )
}
