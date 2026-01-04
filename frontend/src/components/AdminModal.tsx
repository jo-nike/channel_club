import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ChannelList } from '@/components/ChannelList'
import { ActiveUsersTab } from '@/components/admin/ActiveUsersTab'
import { PlaceholderTab } from '@/components/admin/PlaceholderTab'
import { cn } from '@/lib/utils'

type TabType = 'channels' | 'active-users' | 'user-access' | 'plugins'

interface AdminModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const tabs: { id: TabType; label: string }[] = [
  { id: 'channels', label: 'Channels' },
  { id: 'active-users', label: 'Active Users' },
  { id: 'user-access', label: 'User Access' },
  { id: 'plugins', label: 'Plugins' },
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
        return (
          <div className="epg-scroll max-h-[70vh] overflow-y-auto">
            <ChannelList onChannelSelected={() => onOpenChange(false)} />
          </div>
        )
      case 'active-users':
        return (
          <div className="epg-scroll max-h-[70vh] overflow-y-auto">
            <ActiveUsersTab />
          </div>
        )
      case 'user-access':
        return (
          <PlaceholderTab
            title="User Access"
            message="User access management coming soon"
            description="Manage user permissions, invite new users, and control access levels."
          />
        )
      case 'plugins':
        return (
          <PlaceholderTab
            title="Plugins"
            message="Plugins management coming soon"
            description="Extend functionality with third-party integrations and custom features."
          />
        )
      default:
        return null
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:w-[85vw] md:w-[75vw] max-w-5xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Admin Panel</DialogTitle>
        </DialogHeader>

        {/* Tab navigation */}
        <div role="tablist" className="flex gap-0 border-b">
          {tabs.map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              tabIndex={0}
              onClick={() => handleTabClick(tab.id)}
              onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
              className={cn(
                'px-4 py-2 border-b-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                activeTab === tab.id
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content panel */}
        <div role="tabpanel" className="min-h-[200px]">
          {renderTabContent()}
        </div>
      </DialogContent>
    </Dialog>
  )
}
