import { useState } from 'react'
import {
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { FeedbackDialog } from '@/components/FeedbackDialog'
import { AppearancePicker } from '@/components/theme/AppearancePicker'
import { useAuth } from '@/hooks/useAuth'
import { useAppSettings } from '@/hooks/useAppSettings'
import { useFeedbackFeature } from '@/hooks/useFeedbackFeature'
import { useUIStore } from '@/stores/uiStore'

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
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const notificationsEnabled = useUIStore((s) => s.notificationsEnabled)
  const setNotificationsEnabled = useUIStore((s) => s.setNotificationsEnabled)
  const isNHLOverlayVisible = useUIStore((s) => s.isNHLOverlayVisible)
  const setNHLOverlayVisible = useUIStore((s) => s.setNHLOverlayVisible)
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
          <DropdownMenuItem onSelect={() => setAppearanceOpen(true)}>
            <Palette />
            Appearance…
          </DropdownMenuItem>
          {/* 'TV layout' goes here (W3-couch-switch) */}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={logout}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      <Dialog open={appearanceOpen} onOpenChange={setAppearanceOpen}>
        {/* A bottom sheet on phones, scrolling inside the screen; centred from sm */}
        <DialogContent className="max-h-[85dvh] overflow-y-auto max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none max-sm:pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Appearance</DialogTitle>
            <DialogDescription>Choose how Channel Club looks on this device.</DialogDescription>
          </DialogHeader>
          <AppearancePicker />
        </DialogContent>
      </Dialog>
    </>
  )
}
