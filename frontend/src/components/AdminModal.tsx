import { useState } from 'react'
import { APP_NAME, APP_VERSION } from '@/lib/appInfo'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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

  const handleTabClick = (tabId: TabType) => {
    setActiveTab(tabId)
  }

  const handleTabKeyDown = (e: React.KeyboardEvent, tabId: TabType) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setActiveTab(tabId)
    }
  }

  const renderTabContent = () => {
    switch (activeTab) {
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
      <DialogContent className="w-[95vw] sm:w-[85vw] md:w-[75vw] max-w-5xl max-h-[90vh] overflow-hidden flex flex-col" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Admin Panel</DialogTitle>
          <p className="text-sm text-muted-foreground">{APP_NAME} v{APP_VERSION}</p>
        </DialogHeader>

        {/* Tab navigation - horizontal scroll for mobile, enhanced focus for TV */}
        <div role="tablist" className="flex gap-0 border-b overflow-x-auto scrollbar-hide shrink-0">
          {tabs.map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              tabIndex={0}
              onClick={() => handleTabClick(tab.id)}
              onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
              className={cn(
                'px-4 py-3 border-b-2 transition-colors whitespace-nowrap shrink-0 min-h-[44px]',
                'focus-visible:-outline-offset-2',
                'xl:text-lg xl:px-6 xl:py-4 xl:min-h-[56px]',
                activeTab === tab.id
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content panel - scroll container for all tab content */}
        <div role="tabpanel" className="epg-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {renderTabContent()}
        </div>
      </DialogContent>
    </Dialog>
  )
}
