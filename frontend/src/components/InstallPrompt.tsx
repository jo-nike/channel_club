import { Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'

export function InstallPrompt() {
  const { canInstall, install, dismiss } = useInstallPrompt()

  if (!canInstall) return null

  return (
    <div
      className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96
                 bg-slate-800 border border-slate-700 rounded-lg shadow-lg p-4
                 flex items-center gap-4 z-40 animate-in slide-in-from-bottom duration-300"
      role="dialog"
      aria-labelledby="install-prompt-title"
    >
      <Download className="h-8 w-8 text-blue-400 flex-shrink-0" />

      <div className="flex-1 min-w-0">
        <h3 id="install-prompt-title" className="font-semibold text-white">
          Install App
        </h3>
        <p className="text-sm text-slate-400 truncate">
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
          onClick={install}
          className="bg-blue-600 hover:bg-blue-700 min-w-11 min-h-11"
        >
          Install
        </Button>
      </div>
    </div>
  )
}
