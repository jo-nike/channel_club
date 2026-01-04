import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ChannelList } from '@/components/ChannelList'
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
          <div className="max-h-[60vh] overflow-hidden">
            <ChannelList onChannelSelected={() => onOpenChange(false)} />
          </div>
        )
      case 'active-users':
        return (
          <div className="p-4 text-muted-foreground">
            {/* Story 11.6 */}
            Active users will appear here
          </div>
        )
      case 'user-access':
        return (
          <div className="p-4 text-muted-foreground">
            {/* Story 11.7 */}
            User access controls will appear here
          </div>
        )
      case 'plugins':
        return (
          <div className="p-4 text-muted-foreground">
            {/* Story 11.7 */}
            Plugins configuration will appear here
          </div>
        )
      default:
        return null
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" aria-describedby={undefined}>
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
