import { selectCanInstall, selectShouldPromote, useInstallStore } from '@/stores/installStore'

interface UseInstallPromptResult {
  // The app can be installed now (for the account menu)
  canInstall: boolean
  // Show the install banner
  shouldPromote: boolean
  install: () => Promise<boolean>
  dismiss: () => void
}

/** The shared install state (stores/installStore owns the browser's install offer). */
export function useInstallPrompt(): UseInstallPromptResult {
  const canInstall = useInstallStore(selectCanInstall)
  const shouldPromote = useInstallStore(selectShouldPromote)
  const install = useInstallStore((s) => s.install)
  const dismiss = useInstallStore((s) => s.dismiss)
  return { canInstall, shouldPromote, install, dismiss }
}
