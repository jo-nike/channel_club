import { useState } from 'react'
import { APP_NAME, APP_VERSION } from '@/lib/appInfo'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ChannelList } from '@/components/ChannelList'
import { ActiveUsersTab } from '@/components/admin/ActiveUsersTab'
import { ChatTab } from '@/components/admin/ChatTab'
import { NHLGamesTab } from '@/components/admin/NHLGamesTab'
import { StatusTab } from '@/components/admin/StatusTab'
import { UserAccessTab } from '@/components/admin/UserAccessTab'
import { cn } from '@/lib/utils'

type TabType = 'channels' | 'active-users' | 'user-access' | 'chat' | 'nhl' | 'status'

interface AdminModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const tabs: { id: TabType; label: string }[] = [
  { id: 'channels', label: 'Channels' },
  { id: 'active-users', label: 'Active Users' },
  { id: 'user-access', label: 'User Access' },
  { id: 'chat', label: 'Chat' },
  { id: 'nhl', label: 'NHL' },
  { id: 'status', label: 'Status' },
]

export function AdminModal({ open, onOpenChange }: AdminModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('channels')

  const renderTabContent = (tabId: TabType) => {
    switch (tabId) {
      case 'channels':
        return <ChannelList />
      case 'active-users':
        return <ActiveUsersTab />
      case 'user-access':
        return <UserAccessTab />
      case 'chat':
        return <ChatTab />
      case 'nhl':
        return <NHLGamesTab />
      case 'status':
        return <StatusTab />
      default:
        return null
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Fixed height, anchored near the top: the title and tab bar stay put when tabs change */}
      <DialogContent
        className="top-4 sm:top-[5dvh] translate-y-0 h-[min(88dvh,780px)] w-[95vw] sm:w-[85vw] md:w-[75vw] max-w-5xl overflow-hidden flex flex-col"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>Admin Panel</DialogTitle>
          <p className="text-sm text-muted-foreground">{APP_NAME} v{APP_VERSION}</p>
        </DialogHeader>

        {/* Manual activation: arrowing (or a TV remote's d-pad) only moves focus, so
            passing over a tab doesn't mount it and start its fetches; Enter/Space opens it */}
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as TabType)}
          activationMode="manual"
          className="min-h-0 flex-1 gap-4"
        >
          {/* Tab navigation - horizontal scroll for mobile, enhanced focus for TV */}
          <TabsList
            aria-label="Admin sections"
            className="flex h-auto w-full justify-start gap-0 rounded-none bg-transparent p-0 border-b overflow-x-auto scrollbar-hide shrink-0"
          >
            {tabs.map(tab => (
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
          {tabs.map(tab => (
            <TabsContent
              key={tab.id}
              value={tab.id}
              className="epg-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-none focus-visible:-outline-offset-2"
            >
              {renderTabContent(tab.id)}
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
