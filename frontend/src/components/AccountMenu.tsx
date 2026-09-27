import { useState } from 'react'
import {
  Check,
  LogOut,
  MessageSquarePlus,
  Palette,
  RefreshCw,
  ShieldCheck,
  Tv,
  User,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { FeedbackDialog } from '@/components/FeedbackDialog'
import { useAuth } from '@/hooks/useAuth'
import { useAppSettings } from '@/hooks/useAppSettings'
import { useFeedbackFeature } from '@/hooks/useFeedbackFeature'
import { activeThemeId, useThemeStore } from '@/stores/themeStore'
import { useUIStore } from '@/stores/uiStore'
import { getThemeCategories, getTheme } from '@/lib/themes'
import type { ThemeId } from '@/types/theme'

interface AccountMenuProps {
  // Opens the live channel picker (admins, and viewers the admin allows)
  onOpenChannelPicker: () => void
  onOpenAdmin: () => void
  // Remounts the video player
  onReload: () => void
  // Phones have no NHL toggle in the header, so the menu carries it
  isMobile: boolean
}

/** First character of the username, uppercased; null when there is none. */
function initialOf(username: string | null): string | null {
  const first = Array.from(username?.trim() ?? '')[0]
  return first ? first.toUpperCase() : null
}

export function AccountMenu({ onOpenChannelPicker, onOpenAdmin, onReload, isMobile }: AccountMenuProps) {
  const { username, isAdmin, logout } = useAuth()
  const { userChannelSelection } = useAppSettings()
  const { isEnabled: feedbackEnabled } = useFeedbackFeature()
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const notificationsEnabled = useUIStore((s) => s.notificationsEnabled)
  const setNotificationsEnabled = useUIStore((s) => s.setNotificationsEnabled)
  const isNHLOverlayVisible = useUIStore((s) => s.isNHLOverlayVisible)
  const setNHLOverlayVisible = useUIStore((s) => s.setNHLOverlayVisible)
  const themeId = useThemeStore(activeThemeId)
  const setTheme = useThemeStore((s) => s.setTheme)
  const initial = initialOf(username)
  const canChangeLive = isAdmin || userChannelSelection

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="toolbar" size="toolbar" aria-label="Account menu">
                <span
                  aria-hidden="true"
                  className="grid size-8 place-items-center rounded-full bg-primary text-sm font-bold leading-none text-primary-foreground md:size-7"
                >
                  {initial ?? <User className="size-4" />}
                </span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>Account menu</p>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-64">
          {username && (
            <>
              <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
                Signed in as <span className="font-medium text-foreground">{username}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          )}
          {canChangeLive && (
            <DropdownMenuItem onSelect={onOpenChannelPicker}>
              <Tv />
              Change live channel…
            </DropdownMenuItem>
          )}
          {isAdmin && (
            <DropdownMenuItem onSelect={onOpenAdmin}>
              <ShieldCheck />
              Admin panel
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onReload}>
            <RefreshCw />
            Reload stream
          </DropdownMenuItem>
          {isMobile && (
            <DropdownMenuCheckboxItem checked={isNHLOverlayVisible} onCheckedChange={setNHLOverlayVisible}>
              NHL scores
            </DropdownMenuCheckboxItem>
          )}
          {/* Only once the server confirms feedback is configured */}
          {feedbackEnabled && (
            <DropdownMenuItem onSelect={() => setFeedbackOpen(true)}>
              <MessageSquarePlus />
              Send feedback
            </DropdownMenuItem>
          )}
          {/* 'Install app' goes here (W2-install-engagement) */}
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={notificationsEnabled}
            onCheckedChange={setNotificationsEnabled}
          >
            Pop-up when the live channel changes
          </DropdownMenuCheckboxItem>
          {/* 'Chat previews' (W3) and 'Hide what I'm watching' (W3-presence-client) go here */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Palette />
              Theme
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-60">
              {getThemeCategories().map((category) => (
                <DropdownMenuRadioGroup
                  key={category.mode}
                  aria-label={category.label}
                  value={themeId}
                  onValueChange={(id) => setTheme(id as ThemeId)}
                >
                  <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {category.label}
                  </DropdownMenuLabel>
                  {category.themes.map((theme) => (
                    <ThemeItem key={theme.id} id={theme.id} name={theme.name} isSelected={themeId === theme.id} />
                  ))}
                </DropdownMenuRadioGroup>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {/* 'TV layout' goes here (W3-couch-switch) */}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={logout}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  )
}

interface ThemeItemProps {
  id: ThemeId
  name: string
  isSelected: boolean
}

function ThemeItem({ id, name, isSelected }: ThemeItemProps) {
  const { colors } = getTheme(id)

  return (
    <DropdownMenuRadioItem
      value={id}
      // The row carries its own swatches and primary check, so the primitive's
      // radio dot (its first child) is hidden and the gutter it needs dropped
      className="pl-2 data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground [&>span:first-child]:hidden"
    >
      <span className="flex shrink-0 gap-0.5" aria-hidden="true">
        {[colors.background, colors.card, colors.primary].map((color, index) => (
          <span
            key={index}
            className="size-3 rounded-sm border border-border"
            style={{ backgroundColor: color }}
          />
        ))}
      </span>
      <span className="flex-1 truncate">{name}</span>
      {isSelected && <Check className="text-primary" aria-hidden="true" />}
    </DropdownMenuRadioItem>
  )
}
