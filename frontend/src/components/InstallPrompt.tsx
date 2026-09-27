import { useState } from 'react'
import { Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IosInstallDialog } from '@/components/IosInstallDialog'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'
import { useChatStore } from '@/stores/chatStore'

export function InstallPrompt() {
  const { shouldPromote, variant, install, dismiss } = useInstallPrompt()
  // Never over the conversation (on phones, the Chat tab)
  const isChatOpen = useChatStore((s) => s.isOpen)
  const [iosHelpOpen, setIosHelpOpen] = useState(false)
  const isIOS = variant === 'ios'

  // iOS has no install dialog to open: show the instructions, and retire the
  // banner (the account menu keeps 'Add to Home Screen')
  const showIosHelp = () => {
    setIosHelpOpen(true)
    dismiss()
  }

  return (
    <>
      {shouldPromote && !isChatOpen && (
        <div
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 right-4 md:left-auto md:right-4 md:w-96
                     bg-card text-card-foreground border border-border rounded-lg shadow-lg p-4
                     flex items-center gap-4 z-40 animate-in slide-in-from-bottom duration-300"
          role="dialog"
          aria-labelledby="install-prompt-title"
        >
          <Download className="h-8 w-8 text-primary flex-shrink-0" />

          <div className="flex-1 min-w-0">
            <h3 id="install-prompt-title" className="font-semibold text-foreground">
              Install App
            </h3>
            <p className="text-sm text-muted-foreground">
              Add to home screen for quick access
            </p>
          </div>

          <div className="flex gap-2 flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={dismiss}
              aria-label="Dismiss install prompt"
              className="min-w-11 min-h-11"
            >
              <X className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              onClick={isIOS ? showIosHelp : install}
              className="min-w-11 min-h-11"
            >
              {isIOS ? 'Show me' : 'Install'}
            </Button>
          </div>
        </div>
      )}
      {isIOS && <IosInstallDialog open={iosHelpOpen} onOpenChange={setIosHelpOpen} />}
    </>
  )
}
