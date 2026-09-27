import { useLayoutEffect, useRef, useState } from 'react'
import { Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IosInstallDialog } from '@/components/IosInstallDialog'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'
import { useChatStore } from '@/stores/chatStore'
import { APP_NAME } from '@/lib/appInfo'

export function InstallPrompt() {
  const { shouldPromote, variant, install, dismiss } = useInstallPrompt()
  // Never over the conversation (on phones, the Chat tab)
  const isChatOpen = useChatStore((s) => s.isOpen)
  const [iosHelpOpen, setIosHelpOpen] = useState(false)
  const isIOS = variant === 'ios'
  const visible = shouldPromote && !isChatOpen
  const bannerRef = useRef<HTMLDivElement>(null)

  // While the banner shows, publish the room it takes at the bottom of the
  // screen (its height plus its offset) as --install-prompt-h on <html>, so
  // the phone channel list can scroll its last row clear of it. The offset is
  // read from the computed style, not the class: a portrait tablet gets the
  // phone list together with the raised md+ offset. (The computed bottom is
  // unaffected by the slide-in transform, unlike getBoundingClientRect.)
  useLayoutEffect(() => {
    const banner = bannerRef.current
    if (!visible || !banner) return
    const root = document.documentElement
    const publish = () =>
      root.style.setProperty(
        '--install-prompt-h',
        `calc(${banner.offsetHeight}px + ${getComputedStyle(banner).bottom})`,
      )
    publish()
    // The copy wraps on narrow screens, so follow the banner's height
    const observer = new ResizeObserver(publish)
    observer.observe(banner)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--install-prompt-h')
    }
  }, [visible])

  // iOS has no install dialog to open: show the instructions, and retire the
  // banner (the account menu keeps 'Install app')
  const showIosHelp = () => {
    setIosHelpOpen(true)
    dismiss()
  }

  // From md up the banner is a corner card that can land on the player's
  // control bar (a landscape tablet's player fills the screen), so it sits
  // 4.5rem higher, above the bar's 48px buttons, rather than over Fullscreen
  return (
    <>
      {visible && (
        <div
          ref={bannerRef}
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] md:bottom-[calc(4.5rem+max(1rem,env(safe-area-inset-bottom)))] left-4 right-4 md:left-auto md:right-4 md:w-96
                     bg-card text-card-foreground border border-border rounded-lg shadow-lg p-4
                     flex items-center gap-4 z-40 animate-in slide-in-from-bottom duration-300"
          role="dialog"
          aria-labelledby="install-prompt-title"
        >
          <Download className="h-8 w-8 text-primary flex-shrink-0" />

          <div className="flex-1 min-w-0">
            <h3 id="install-prompt-title" className="font-semibold text-foreground">
              Install app
            </h3>
            <p className="text-sm text-muted-foreground">
              {/* On iOS, what 'Show me' opens: the Add to Home Screen steps */}
              {isIOS ? `Add ${APP_NAME} to your Home Screen` : 'Add to home screen for quick access'}
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
