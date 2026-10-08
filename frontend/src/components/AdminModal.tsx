import { useState, type CSSProperties, type RefObject } from 'react'
import { APP_NAME, APP_VERSION } from '@/lib/appInfo'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ChannelList } from '@/components/ChannelList'
import { ChatTab } from '@/components/admin/ChatTab'
import { OnAirCard } from '@/components/admin/OnAirCard'
import { NHLGamesTab } from '@/components/admin/NHLGamesTab'
import { PeopleTab } from '@/components/admin/PeopleTab'
import { StatusTab } from '@/components/admin/StatusTab'
import { ServerTab } from '@/components/admin/server/ServerTab'
import { serverTabReturn } from '@/components/admin/server/serverStash'
import { cn } from '@/lib/utils'
import { useNhlEnabled } from '@/hooks/useNhlEnabled'
import { useSources } from '@/hooks/useSources'
import { useReturnFocus } from '@/hooks/useReturnFocus'

type TabType = 'channels' | 'people' | 'chat' | 'nhl' | 'status' | 'server'

interface AdminModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Where focus goes on close when the element that opened it has gone (the
      account menu's item unmounts with the menu) */
  returnFocusTo?: RefObject<HTMLElement | null>
}

const tabs: { id: TabType; label: string }[] = [
  { id: 'channels', label: 'Channels' },
  { id: 'people', label: 'People' },
  { id: 'chat', label: 'Chat' },
  { id: 'nhl', label: 'NHL' },
  { id: 'status', label: 'Status' },
  { id: 'server', label: 'Server' },
]

/**
 * The On-air card sticks to the top of the tab's scroll container, over the
 * channel list. Browsers scroll a newly focused row to the scrollport's edge
 * and ignore sticky overlays, so every element in the list gets a scroll
 * margin of the card's measured height (it changes with the programme, count
 * and recents rows). Keyboard and d-pad focus then lands below the card, not
 * under it. The margin sits on the list only: the card's own buttons stay
 * where they are when focused.
 */
function ChannelsTab() {
  const [onAirHeight, setOnAirHeight] = useState(0)

  return (
    <>
      <OnAirCard onHeightChange={setOnAirHeight} />
      <div
        className="**:scroll-mt-(--on-air-height)"
        style={{ '--on-air-height': `${onAirHeight}px` } as CSSProperties}
      >
        <ChannelList />
      </div>
    </>
  )
}

export function AdminModal({ open, onOpenChange, returnFocusTo }: AdminModalProps) {
  // Back from a Plex sign-in the Server tab started: open on it again
  const [activeTab, setActiveTab] = useState<TabType>(() => (serverTabReturn() ? 'server' : 'channels'))
  // The Server tab stays mounted once opened, until the panel closes: its
  // unsaved changes survive a look at another tab
  const [serverKept, setServerKept] = useState(false)
  const keepServer = serverKept || activeTab === 'server'
  // Opened by state (the Host button, the account menu), not a trigger Radix
  // could return focus to
  const returnFocus = useReturnFocus(returnFocusTo)
  // Channels (putting a channel on Live) only with Dispatcharr, NHL only while
  // the server has NHL scores on. A tab that goes while open leaves the panel
  // on the first one left.
  const nhlEnabled = useNhlEnabled()
  const liveOn = useSources().dispatcharr
  const shownTabs = tabs.filter((tab) => (tab.id !== 'nhl' || nhlEnabled) && (tab.id !== 'channels' || liveOn))
  const shownTab = shownTabs.some((tab) => tab.id === activeTab) ? activeTab : shownTabs[0].id

  const renderTabContent = (tabId: TabType) => {
    switch (tabId) {
      case 'channels':
        return <ChannelsTab />
      case 'people':
        return <PeopleTab />
      case 'chat':
        return <ChatTab />
      case 'nhl':
        return <NHLGamesTab />
      case 'status':
        return <StatusTab />
      case 'server':
        return <ServerTab />
      default:
        return null
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setServerKept(false)
        onOpenChange(next)
      }}
    >
      {/* Fixed height, anchored near the top: the title and tab bar stay put when tabs change */}
      <DialogContent
        className="top-4 sm:top-[5dvh] translate-y-0 h-[min(88dvh,780px)] w-[95vw] sm:w-[85vw] md:w-[75vw] max-w-5xl overflow-hidden flex flex-col"
        aria-describedby={undefined}
        {...returnFocus}
      >
        <DialogHeader>
          <DialogTitle>Admin Panel</DialogTitle>
          <p className="text-sm text-muted-foreground">{APP_NAME} v{APP_VERSION}</p>
        </DialogHeader>

        {/* Manual activation: arrowing (or a TV remote's d-pad) only moves focus, so
            passing over a tab doesn't mount it and start its fetches; Enter/Space opens it */}
        <Tabs
          value={shownTab}
          onValueChange={(value) => {
            if (keepServer) setServerKept(true)
            setActiveTab(value as TabType)
          }}
          activationMode="manual"
          className="min-h-0 flex-1 gap-4"
        >
          {/* Tab navigation - horizontal scroll for mobile, enhanced focus for TV */}
          <TabsList
            aria-label="Admin sections"
            className="flex h-auto w-full justify-start gap-0 rounded-none bg-transparent p-0 border-b overflow-x-auto scrollbar-hide shrink-0"
          >
            {shownTabs.map(tab => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className={cn(
                  'flex-none h-auto rounded-none border-0 border-b-2 border-transparent px-4 py-3 text-base font-normal transition-colors whitespace-nowrap shrink-0 min-h-[44px]',
                  // Focus shows only the global outline: an underline on a focused tab would
                  // read as "selected" before Enter opens it
                  'focus-visible:-outline-offset-2 focus-visible:border-transparent',
                  'xl:text-lg xl:px-6 xl:py-4 xl:min-h-[56px]',
                  'text-muted-foreground dark:text-muted-foreground hover:text-foreground',
                  'data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:font-medium data-[state=active]:bg-transparent data-[state=active]:shadow-none',
                  'dark:data-[state=active]:border-primary dark:data-[state=active]:text-primary dark:data-[state=active]:bg-transparent'
                )}
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Tab content panel - scroll container for all tab content */}
          {shownTabs.map(tab => (
            <TabsContent
              key={tab.id}
              value={tab.id}
              forceMount={tab.id === 'server' && keepServer ? true : undefined}
              className={cn(
                'epg-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-none focus-visible:-outline-offset-2',
                // Kept mounted, so hidden by hand; its Save rows stick to the bottom,
                // so a control taking focus scrolls clear of them (WCAG 2.4.12)
                tab.id === 'server' && 'scroll-pb-22 data-[state=inactive]:hidden'
              )}
            >
              {renderTabContent(tab.id)}
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
