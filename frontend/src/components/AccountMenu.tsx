import { useId, useState } from 'react'
import {
  Download,
  Lightbulb,
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
import { IosInstallDialog } from '@/components/IosInstallDialog'
import { AppearancePicker } from '@/components/theme/AppearancePicker'
import { useAuth } from '@/hooks/useAuth'
import { useAppSettings } from '@/hooks/useAppSettings'
import { useChatEnabled } from '@/hooks/useChatEnabled'
import { useFeedbackFeature } from '@/hooks/useFeedbackFeature'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'
import { readTVModeOverride, setTVModeOverride, useTVMode, type TVModeOverride } from '@/hooks/useTVMode'
import { useUIStore } from '@/stores/uiStore'

interface AccountMenuProps {
  // Opens the Live TV switcher: Change live channel for admins and viewers the
  // admin allows, Suggest a channel for other viewers while chat is on
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
  const chatEnabled = useChatEnabled()
  const { isEnabled: feedbackEnabled } = useFeedbackFeature()
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  // Always offered here when installable, whether or not the banner is showing or snoozed
  const { canInstall, variant: installVariant, install } = useInstallPrompt()
  const [iosInstallOpen, setIosInstallOpen] = useState(false)
  // Only this menu (and a ?tv= link before the app starts) changes the stored choice
  const [tvLayout, setTvLayout] = useState(readTVModeOverride)
  const tvLayoutLabelId = useId()
  const notificationsEnabled = useUIStore((s) => s.notificationsEnabled)
  const setNotificationsEnabled = useUIStore((s) => s.setNotificationsEnabled)
  const hideMyActivity = useUIStore((s) => s.hideMyActivity)
  const setHideMyActivity = useUIStore((s) => s.setHideMyActivity)
  const hideActivityLabelId = useId()
  const hideActivityHintId = useId()
  const chatPreviews = useUIStore((s) => s.chatPreviews)
  const setChatPreviews = useUIStore((s) => s.setChatPreviews)
  // Only where there is chat over the video: not without chat (chatEnabled), nor on the TV layout
  const isTVMode = useTVMode()
  const isNHLOverlayVisible = useUIStore((s) => s.isNHLOverlayVisible)
  const setNHLOverlayVisible = useUIStore((s) => s.setNHLOverlayVisible)
  const initial = initialOf(username)
  const canChangeLive = isAdmin || userChannelSelection
  // Everyone else may suggest a channel in chat, while chat is on
  const canSuggestLive = !canChangeLive && chatEnabled

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
          {canSuggestLive && (
            <DropdownMenuItem onSelect={onOpenChannelPicker}>
              <Lightbulb />
              Suggest a channel…
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
          {/* On iOS it opens the Add to Home Screen steps; elsewhere the browser's dialog */}
          {canInstall && (
            <DropdownMenuItem
              onSelect={() => (installVariant === 'ios' ? setIosInstallOpen(true) : void install())}
            >
              <Download />
              Install app
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={notificationsEnabled}
            onCheckedChange={setNotificationsEnabled}
          >
            Pop-up when the live channel changes
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={hideMyActivity}
            onCheckedChange={setHideMyActivity}
            aria-labelledby={hideActivityLabelId}
            aria-describedby={hideActivityHintId}
          >
            <span className="flex flex-col">
              <span id={hideActivityLabelId}>Hide what I'm watching</span>
              <span id={hideActivityHintId} className="text-xs text-muted-foreground">
                Others see only your name. Admins still see it.
              </span>
            </span>
          </DropdownMenuCheckboxItem>
          {chatEnabled && !isTVMode && (
            <DropdownMenuCheckboxItem checked={chatPreviews} onCheckedChange={setChatPreviews}>
              Show chat over the video
            </DropdownMenuCheckboxItem>
          )}
          <DropdownMenuItem onSelect={() => setAppearanceOpen(true)}>
            <Palette />
            Appearance…
          </DropdownMenuItem>
          <DropdownMenuLabel id={tvLayoutLabelId}>TV layout (10-foot)</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            aria-labelledby={tvLayoutLabelId}
            value={tvLayout}
            onValueChange={(value) => {
              const mode = value as TVModeOverride
              setTVModeOverride(mode)
              setTvLayout(mode)
            }}
          >
            {/* Auto: on for webOS and Tizen TV browsers, off everywhere else */}
            <DropdownMenuRadioItem value="auto">Auto</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="on">On</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="off">Off</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={logout}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      {installVariant === 'ios' && <IosInstallDialog open={iosInstallOpen} onOpenChange={setIosInstallOpen} />}
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
